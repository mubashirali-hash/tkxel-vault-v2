#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..');
const REPORT_PATH = resolve(REPOSITORY_ROOT, 'srs_compliance_report.md');
const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  'docs',
  'acceptance-evidence',
  'release-evidence.json',
);

const REQUIRED_CRITERIA = Array.from({ length: 10 }, (_, index) => `AC-${index + 1}`);
const PRODUCTION_STATUS = /\b(?:production[- ]approved|production[- ]ready|fully compliant|10\s*\/\s*10\s+pass)\b/i;
const DISALLOWED_EVIDENCE_KINDS = new Set(['mock', 'source-inspection', 'unit']);
const TEST_DOUBLE_MARKER = /\b(?:mock|contract[- ]test double|test double)\b/i;

function containsTestDoubleMarker(value) {
  if (typeof value === 'string') return TEST_DOUBLE_MARKER.test(value);
  if (Array.isArray(value)) return value.some(containsTestDoubleMarker);
  if (value && typeof value === 'object') return Object.values(value).some(containsTestDoubleMarker);
  return false;
}

export function extractOverallStatus(reportText) {
  const match = reportText.match(/^\*\*Overall status:\*\*\s*(.+)$/im);
  return match?.[1]?.trim() ?? '';
}

export function validateProductionEvidence(
  manifest,
  fileExists = existsSync,
  root = REPOSITORY_ROOT,
  options = {}
) {
  const { currentCommit, readFile } = options;
  const errors = [];

  if (manifest?.status !== 'production-approved') {
    errors.push('Evidence manifest status must be "production-approved".');
  }

  if (!/^[a-f0-9]{40}$/i.test(manifest?.commit ?? '')) {
    errors.push('Evidence manifest must identify the exact 40-character Git commit.');
  } else if (currentCommit && manifest.commit.toLowerCase() !== currentCommit.toLowerCase()) {
    errors.push(
      `Evidence manifest commit (${manifest.commit}) does not match current commit (${currentCommit}).`
    );
  }

  if (!manifest?.environment) {
    errors.push('Evidence manifest must specify runtime environment.');
  }

  const criteria = Array.isArray(manifest?.criteria) ? manifest.criteria : [];
  for (const criterionId of REQUIRED_CRITERIA) {
    const criterion = criteria.find((entry) => entry?.id === criterionId);
    if (!criterion || criterion.status !== 'passed') {
      errors.push(`${criterionId} must be present with status "passed".`);
      continue;
    }

    if (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0) {
      errors.push(`${criterionId} must link at least one evidence artifact.`);
      continue;
    }

    for (const evidence of criterion.evidence) {
      if (!evidence?.path || typeof evidence.path !== 'string') {
        errors.push(`${criterionId} contains an evidence entry without a path.`);
        continue;
      }
      if (DISALLOWED_EVIDENCE_KINDS.has(evidence.kind)) {
        errors.push(`${criterionId} uses disallowed acceptance evidence kind "${evidence.kind}".`);
      }
      const targetPath = resolve(root, evidence.path);
      if (!fileExists(targetPath)) {
        errors.push(`${criterionId} evidence file does not exist: ${evidence.path}`);
        continue;
      }

      // Inspect artifact contents if reader function is available
      const readFn = readFile ?? (root === REPOSITORY_ROOT ? readFileSync : null);
      if (typeof readFn === 'function') {
        try {
          const content = readFn(targetPath, 'utf8');
          if (evidence.path.endsWith('.json')) {
            const parsed = JSON.parse(content);
            if (parsed.status !== 'passed') {
              errors.push(`${criterionId} evidence artifact ${evidence.path} status is "${parsed.status}", expected "passed".`);
            }
            if (parsed.criterion && parsed.criterion !== criterionId) {
              errors.push(`${criterionId} evidence artifact ${evidence.path} criterion mismatch: expected "${criterionId}", found "${parsed.criterion}".`);
            }
            if (containsTestDoubleMarker(parsed)) {
              errors.push(
                `${criterionId} evidence artifact ${evidence.path} identifies a test double and cannot support a production-approved claim.`
              );
            }
          } else if (evidence.path.endsWith('.log')) {
            const hasPassed = /Passed checks:\s*25/i.test(content) || content.includes('25 passed');
            const hasZeroFailed = /Failed checks:\s*0/i.test(content) || content.includes('0 failed');
            if (!content || !hasPassed || !hasZeroFailed) {
              errors.push(`${criterionId} log evidence ${evidence.path} does not confirm 25 passed and 0 failed acceptance checks.`);
            }
          }
        } catch (err) {
          errors.push(`${criterionId} evidence file ${evidence.path} failed content validation: ${err.message}`);
        }
      }
    }
  }

  return errors;
}

export function verifyReleaseClaims({
  reportText,
  manifest,
  manifestExists,
  fileExists = existsSync,
  root = REPOSITORY_ROOT,
  currentCommit,
  readFile,
  forceValidateManifest = false,
}) {
  const overallStatus = extractOverallStatus(reportText);
  const claimsProductionApproval = PRODUCTION_STATUS.test(overallStatus);

  if (!claimsProductionApproval && !forceValidateManifest) {
    if (manifest?.status === 'production-approved') {
      return {
        claimsProductionApproval: false,
        manifestInconsistent: true,
        errors: [
          'Evidence manifest status is "production-approved" but SRS compliance report remains in remediation state (production sign-off withdrawn). Manifest status must be "in-remediation" or "pending-approval" until Gate 7 sign-off is granted.',
        ],
      };
    }
    return { claimsProductionApproval: false, errors: [] };
  }

  if (!manifestExists) {
    return {
      claimsProductionApproval: true,
      errors: ['Production approval requires docs/acceptance-evidence/release-evidence.json.'],
    };
  }

  return {
    claimsProductionApproval: true,
    errors: validateProductionEvidence(manifest, fileExists, root, { currentCommit, readFile }),
  };
}

function main() {
  const reportText = readFileSync(REPORT_PATH, 'utf8');
  const manifestExists = existsSync(MANIFEST_PATH);
  let manifest = null;

  if (manifestExists) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (error) {
      console.error(`Release-claim guard failed: invalid evidence manifest JSON: ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  let currentCommit;
  try {
    currentCommit = execSync('git rev-parse HEAD', { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).trim();
  } catch {}

  const forceValidateManifest = process.argv.includes('--check-manifest');

  const result = verifyReleaseClaims({
    reportText,
    manifest,
    manifestExists,
    fileExists: existsSync,
    root: REPOSITORY_ROOT,
    currentCommit,
    forceValidateManifest,
  });

  if (result.errors.length > 0) {
    console.error('Release-claim guard failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  if (result.claimsProductionApproval || forceValidateManifest) {
    console.log('Release-claim guard passed: production approval has complete linked evidence.');
  } else {
    console.log('Release-claim guard passed: compliance report remains in remediation state.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
