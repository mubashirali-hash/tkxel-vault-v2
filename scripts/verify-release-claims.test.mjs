import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOverallStatus,
  verifyReleaseClaims,
} from './verify-release-claims.mjs';

test('extracts only the explicit overall status line', () => {
  const report = [
    '**Overall status:** Remediation required — production sign-off withdrawn',
    '',
    'Do not claim fully compliant until evidence exists.',
  ].join('\n');

  assert.equal(
    extractOverallStatus(report),
    'Remediation required — production sign-off withdrawn',
  );
});

test('allows an explicitly remediating report without a production evidence manifest', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Remediation required — production sign-off withdrawn',
    manifest: null,
    manifestExists: false,
  });

  assert.deepEqual(result, { claimsProductionApproval: false, errors: [] });
});

test('rejects a production-ready claim when the evidence manifest is missing', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-ready',
    manifest: null,
    manifestExists: false,
  });

  assert.equal(result.claimsProductionApproval, true);
  assert.match(result.errors[0], /requires .*release-evidence\.json/);
});

test('rejects incomplete, mock, and missing production evidence', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: 'a'.repeat(40),
      criteria: [
        {
          id: 'AC-1',
          status: 'passed',
          evidence: [{ kind: 'mock', path: 'does-not-exist.json' }],
        },
      ],
    },
    fileExists: () => false,
    root: '/repository',
  });

  assert.ok(result.errors.some((error) => error.includes('disallowed')));
  assert.ok(result.errors.some((error) => error.includes('does not exist')));
  assert.ok(result.errors.some((error) => error.startsWith('AC-10 must be present')));
});

test('rejects evidence manifest when commit does not match current commit', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      criteria: [],
    },
    currentCommit: '2'.repeat(40),
    fileExists: () => true,
    root: '/repository',
  });

  assert.ok(result.errors.some((error) => error.includes('does not match current commit')));
});

test('rejects evidence when artifact JSON status is not passed', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      environment: 'test-env',
      criteria: Array.from({ length: 10 }, (_, i) => ({
        id: `AC-${i + 1}`,
        status: 'passed',
        evidence: [{ kind: 'integration', path: `docs/acceptance-evidence/ac-${i + 1}.json` }],
      })),
    },
    currentCommit: '1'.repeat(40),
    fileExists: () => true,
    readFile: (filePath) => {
      if (filePath.includes('ac-1.json')) {
        return JSON.stringify({ criterion: 'AC-1', status: 'failed' });
      }
      return JSON.stringify({ criterion: 'AC-2', status: 'passed' });
    },
    root: '/repository',
  });

  assert.ok(result.errors.some((error) => error.includes('status is "failed", expected "passed"')));
});

test('rejects production approval when linked JSON evidence identifies a contract-test double', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      environment: 'test-env',
      criteria: Array.from({ length: 10 }, (_, i) => ({
        id: `AC-${i + 1}`,
        status: 'passed',
        evidence: [{ kind: 'integration', path: `docs/acceptance-evidence/ac-${i + 1}.json` }],
      })),
    },
    currentCommit: '1'.repeat(40),
    fileExists: () => true,
    readFile: (filePath) =>
      JSON.stringify({
        criterion: filePath.includes('ac-1.json') ? 'AC-1' : undefined,
        status: 'passed',
        provider: filePath.includes('ac-1.json') ? 'contract-test double' : 'cloud provider',
      }),
    root: '/repository',
  });

  assert.ok(result.errors.some((error) => error.includes('identifies a test double')));
});

test('rejects log evidence when Failed checks: 0 is missing or non-zero', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      environment: 'test-env',
      criteria: Array.from({ length: 10 }, (_, i) => ({
        id: `AC-${i + 1}`,
        status: 'passed',
        evidence: [
          {
            kind: 'acceptance',
            path: i === 3 ? 'docs/acceptance-evidence/gate-3.log' : `docs/acceptance-evidence/ac-${i + 1}.json`,
          },
        ],
      })),
    },
    currentCommit: '1'.repeat(40),
    fileExists: () => true,
    readFile: (filePath) => {
      if (filePath.endsWith('.log')) {
        return 'Passed checks: 25\nFailed checks: 1\n';
      }
      return JSON.stringify({ status: 'passed' });
    },
    root: '/repository',
  });

  assert.ok(result.errors.some((error) => error.includes('does not confirm 25 passed and 0 failed')));
});

test('accepts log evidence when 25 passed and 0 failed checks are confirmed', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Production-approved',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      environment: 'test-env',
      criteria: Array.from({ length: 10 }, (_, i) => ({
        id: `AC-${i + 1}`,
        status: 'passed',
        evidence: [
          {
            kind: 'acceptance',
            path: i === 3 ? 'docs/acceptance-evidence/gate-3.log' : `docs/acceptance-evidence/ac-${i + 1}.json`,
          },
        ],
      })),
    },
    currentCommit: '1'.repeat(40),
    fileExists: () => true,
    readFile: (filePath) => {
      if (filePath.endsWith('.log')) {
        return 'Passed checks: 25\nFailed checks: 0\n';
      }
      return JSON.stringify({ status: 'passed' });
    },
    root: '/repository',
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.claimsProductionApproval, true);
});

test('rejects manifest claiming production-approved while report is in remediation state', () => {
  const result = verifyReleaseClaims({
    reportText: '**Overall status:** Remediation required — production sign-off withdrawn',
    manifestExists: true,
    manifest: {
      status: 'production-approved',
      commit: '1'.repeat(40),
      criteria: [],
    },
  });

  assert.equal(result.claimsProductionApproval, false);
  assert.ok(result.errors.some((e) => e.includes('remains in remediation state')));
});
