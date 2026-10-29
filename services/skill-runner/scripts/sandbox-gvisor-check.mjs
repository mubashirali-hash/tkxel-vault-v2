// Real-runtime check of the skill sandbox: isolation properties and start-up cost under gVisor (runsc).
// Opt-in: run `node scripts/sandbox-gvisor-check.mjs` from services/skill-runner (after `pnpm build`) on a
// Linux host whose Docker daemon has the runsc runtime. Needs the python:3.12-alpine image.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { SandboxRunner } from '../dist/sandbox/runner.js';

process.env.NODE_ENV = 'production';
const runner = new SandboxRunner();
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
const py = (code, options = {}) => runner.execute('python', ['-c', code], { useDocker: true, ...options });
const pct = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

console.log(`host kernel ${os.release()}  runsc available: ${await SandboxRunner.isRuntimeAvailable('runsc')}`);

const probe = await py(`
import os, socket, subprocess
print("uid", os.getuid(), "gid", os.getgid())
print("kernel", os.uname().release)
try:
    open("/root_write_test", "w").write("x"); print("rootfs writable")
except Exception as e: print("rootfs", type(e).__name__)
try:
    open("/tmp/ok.txt", "w").write("x"); print("tmp writable")
except Exception as e: print("tmp", type(e).__name__)
try:
    open("/tmp/run.sh", "w").write("#!/bin/sh\\necho ran\\n"); os.chmod("/tmp/run.sh", 0o755)
    print("tmp exec", subprocess.run(["/tmp/run.sh"], capture_output=True).returncode)
except Exception as e: print("tmp exec", type(e).__name__)
try:
    socket.create_connection(("1.1.1.1", 53), timeout=3); print("network reachable")
except Exception as e: print("network", type(e).__name__)
print("ifaces", sorted(os.listdir("/sys/class/net")) if os.path.isdir("/sys/class/net") else "none")
print("env", sorted(k for k in os.environ if k not in ("PATH", "HOME", "LANG", "NODE_ENV", "HOSTNAME", "PYTHON_VERSION", "PYTHON_SHA256", "GPG_KEY")))
`);
const out = probe.stdout;
console.log(out.trim().split('\n').map((l) => `    ${l}`).join('\n'));
if (probe.stderr.trim()) console.log(`    stderr: ${probe.stderr.trim().slice(0, 300)}`);
check('container ran under the sandbox', probe.exitCode === 0, `exit ${probe.exitCode}`);
check('non-root user 10001', /uid 10001 gid 10001/.test(out));
const sandboxKernel = /kernel (\S+)/.exec(out)?.[1];
check('guest kernel differs from the host kernel (gVisor user-space kernel)', Boolean(sandboxKernel) && sandboxKernel !== os.release(), `guest ${sandboxKernel}`);
check('root filesystem is read-only', /rootfs (OSError|PermissionError)/.test(out));
check('/tmp is writable', /tmp writable/.test(out));
check('/tmp is not executable', /tmp exec (PermissionError|OSError)/.test(out) || /tmp exec 126/.test(out));
check('no network egress', /network (OSError|TimeoutError|ConnectionRefusedError|gaierror)/.test(out) && !/network reachable/.test(out));
check('no host variables leak into the sandbox', /env \[\]/.test(out));

const before = execFileSync('docker', ['ps', '-q']).toString().split('\n').filter(Boolean).length;
const slow = await py('import time; time.sleep(60)', { timeoutMs: 4000 });
check('hard timeout stops the run', slow.timedOut === true, `${slow.durationMs} ms`);
await new Promise((r) => setTimeout(r, 6000));
const after = execFileSync('docker', ['ps', '-q']).toString().split('\n').filter(Boolean).length;
check('no container is left running after a timeout', after <= before, `containers before ${before}, after ${after}`);

// Every page is written, so the memory is really used and not just reserved
const memory = await py(`
x = bytearray(900 * 1024 * 1024)
for i in range(0, len(x), 4096):
    x[i] = 1
print("allocated")
`);
check('memory limit (512 MB) is enforced', !/allocated/.test(memory.stdout), `exit ${memory.exitCode}`);

const RUNS = Number(process.env.SANDBOX_RUNS || 20);
for (const runtime of ['runsc', 'runc']) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await py('print(1)', { runtime });
    if (r.exitCode !== 0) { console.log(`  ${runtime} run failed: ${r.stderr.slice(0, 200)}`); break; }
    times.push(r.durationMs);
  }
  if (times.length) {
    console.log(`START-UP ${runtime}: n=${times.length} p50=${pct(times, 0.5)} ms p95=${pct(times, 0.95)} ms max=${Math.max(...times)} ms`);
    if (runtime === 'runsc') check('NFR-12: sandbox start-up p95 under 2 s (gVisor)', pct(times, 0.95) < 2000, `p95 ${pct(times, 0.95)} ms`);
  }
}
console.log(`RESULT ${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
