/**
 * Static scan applied to every uploaded skill before it is stored or published (NFR-07).
 *
 * It looks for three things the SRS names: malicious script behaviour, unauthorized network calls,
 * and prompt-injection patterns. Helper scripts run in a sandbox with no network and a minimal
 * environment, so any attempt to reach the network, spawn processes or read host secrets has no
 * legitimate purpose there and blocks the upload outright.
 *
 * This is a deny-list scan: it raises the cost of smuggling hostile content into a vault and gives
 * Owners a reviewable report. It does not replace the sandbox, which remains the enforcement boundary.
 */
export type ScanSeverity = 'block' | 'warn';

export interface ScanFinding {
  rule: string;
  severity: ScanSeverity;
  /** `SKILL.md`, `tool.json`, or the package-relative path of a companion file. */
  file: string;
  line: number;
  message: string;
}

export interface SkillScanReport {
  passed: boolean;
  findings: ScanFinding[];
  scanned_files: number;
}

interface Rule {
  id: string;
  severity: ScanSeverity;
  message: string;
  pattern: RegExp;
}

const SCRIPT_RULES: Rule[] = [
  // Unauthorized network calls
  { id: 'network.http_client', severity: 'block', message: 'Script makes an HTTP request', pattern: /\b(fetch\s*\(|axios\b|XMLHttpRequest|urllib\.request|urlopen\s*\(|requests\.(get|post|put|delete|patch|request|Session)\b|httpx\.|aiohttp\.|http\.client|https?\.(request|get)\s*\()/ },
  { id: 'network.module', severity: 'block', message: 'Script loads a networking module', pattern: /(require\s*\(\s*['"](node:)?(https?|net|dgram|tls|dns|http2)['"]\s*\)|from\s+['"](node:)?(https?|net|dgram|tls|dns|http2)['"]|^\s*(import|from)\s+(socket|ftplib|smtplib|telnetlib|paramiko)\b)/m },
  { id: 'network.cli', severity: 'block', message: 'Script invokes a network command-line tool', pattern: /(^|[\s;|&`$(])(curl|wget|nc|ncat|netcat|telnet|ssh|scp|sftp|ftp|rsync|nslookup|dig)\s+[-\w./:@]/m },
  { id: 'network.raw_socket', severity: 'block', message: 'Script opens a raw socket', pattern: /(\bsocket\.socket\s*\(|\/dev\/(tcp|udp)\/|new\s+WebSocket\s*\()/ },

  // Process and code execution
  { id: 'exec.process_spawn', severity: 'block', message: 'Script spawns another process', pattern: /(child_process|\bexecSync\s*\(|\bspawnSync\s*\(|\bspawn\s*\(|subprocess\.|os\.system\s*\(|os\.popen\s*\(|pty\.spawn|Runtime\.getRuntime\(\)\.exec)/ },
  { id: 'exec.dynamic_code', severity: 'block', message: 'Script evaluates dynamically built code', pattern: /(\beval\s*\(|new\s+Function\s*\(|\bexec\s*\(\s*(compile|base64|bytes|codecs|__import__)|__import__\s*\(|\bvm\.(runIn|Script)|marshal\.loads|pickle\.loads)/ },
  { id: 'exec.encoded_payload', severity: 'block', message: 'Script decodes and executes an encoded payload', pattern: /(base64\s+(-d|--decode)[^\n]*\|\s*(ba)?sh|atob\s*\([^)]*\)[^\n]*(eval|Function)|b64decode\s*\([^)]*\)[^\n]*exec)/ },
  { id: 'exec.shell_pipe', severity: 'block', message: 'Script pipes downloaded or generated content into a shell', pattern: /\|\s*(ba|z|k)?sh\b/ },

  // Host secrets and filesystem escape
  { id: 'secrets.environment', severity: 'block', message: 'Script reads host environment variables other than its declared input', pattern: /(process\.env\b(?!\.TKXEL_SKILL_INPUT\b)|os\.environ\b(?!\s*(\.get\s*\(|\[)\s*['"]TKXEL_SKILL_INPUT['"])|os\.getenv\s*\((?!\s*['"]TKXEL_SKILL_INPUT['"])|\bprintenv\b|(^|[\s;|&])env\s*($|[|>]))/m },
  { id: 'secrets.credential_paths', severity: 'block', message: 'Script references credential or system files', pattern: /(\/etc\/(passwd|shadow|sudoers)|\.ssh\/|\.aws\/credentials|\/proc\/(self|\d+)\/environ|\/var\/run\/docker\.sock|169\.254\.169\.254|metadata\.google\.internal)/ },
  { id: 'fs.path_traversal', severity: 'warn', message: 'Script uses a parent-directory path', pattern: /\.\.\/\.\.\// },
  { id: 'fs.destructive', severity: 'block', message: 'Script runs a destructive filesystem command', pattern: /(\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{\s*:\|:&\s*\};:)/ },
];

const INSTRUCTION_RULES: Rule[] = [
  // Prompt-injection and exfiltration patterns embedded in instructions
  { id: 'prompt.override', severity: 'block', message: 'Instructions tell the model to disregard its safeguards', pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|all|system|safety|security)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|mandates?|guardrails?|policies)\b/i },
  { id: 'prompt.reveal', severity: 'block', message: 'Instructions tell the model to disclose protected content', pattern: /\b(reveal|print|output|repeat|disclose|leak|dump|exfiltrate)\b[^.\n]{0,40}\b(system prompt|these instructions|your instructions|SKILL\.md|source files?|api keys?|secrets?|credentials?)\b/i },
  { id: 'prompt.jailbreak', severity: 'block', message: 'Instructions contain a known jailbreak phrase', pattern: /\b(DAN mode|developer mode enabled|do anything now|jailbreak(ed)?|no restrictions apply)\b/i },
  { id: 'prompt.exfil_channel', severity: 'block', message: 'Instructions direct output to an external destination', pattern: /\b(send|post|upload|forward|email|transmit)\b[^.\n]{0,60}\b(to|at)\b[^.\n]{0,20}(https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+)/i },
  { id: 'prompt.hidden_text', severity: 'warn', message: 'Instructions contain invisible or bidirectional control characters', pattern: /[​-‏‪-‮⁠-⁤﻿]/ },
  { id: 'prompt.external_url', severity: 'warn', message: 'Instructions reference an external URL', pattern: /https?:\/\/(?!example\.(com|org)\b)[\w.-]+\.[a-z]{2,}/i },
];

const MAX_FINDINGS = 50;

function scanText(file: string, text: string, rules: Rule[], findings: ScanFinding[]): void {
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    // Multi-line anchored rules are evaluated per line as well, so every hit has a line number
    for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
      if (rule.pattern.test(lines[i])) {
        findings.push({ rule: rule.id, severity: rule.severity, file, line: i + 1, message: rule.message });
      }
    }
  }
}

export function scanSkillPackage(input: {
  skillMd: string;
  toolJson?: unknown;
  files?: Record<string, string>;
}): SkillScanReport {
  const findings: ScanFinding[] = [];
  let scanned = 1;

  scanText('SKILL.md', input.skillMd, INSTRUCTION_RULES, findings);

  if (input.toolJson !== undefined && input.toolJson !== null) {
    scanned++;
    // Descriptions in tool.json are shown to the model, so they are scanned like instructions
    scanText('tool.json', JSON.stringify(input.toolJson, null, 2), INSTRUCTION_RULES.filter((r) => r.severity === 'block'), findings);
  }

  for (const [path, content] of Object.entries(input.files || {})) {
    scanned++;
    if (typeof content !== 'string') continue;
    const isMarkdown = /\.(md|markdown|txt)$/i.test(path);
    scanText(path, content, isMarkdown ? INSTRUCTION_RULES : SCRIPT_RULES, findings);
    if (!isMarkdown && /[\u0000-\u0008\u000E-\u001F]/.test(content)) {
      findings.push({ rule: 'file.binary', severity: 'block', file: path, line: 1, message: 'Companion file contains binary data' });
    }
  }

  return {
    passed: !findings.some((f) => f.severity === 'block'),
    findings,
    scanned_files: scanned,
  };
}
