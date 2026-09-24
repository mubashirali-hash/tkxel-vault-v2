import { spawn } from 'node:child_process';
import path from 'node:path';
import { OutputSanitizer } from './sanitizer.js';

export interface ContainerSecurityPolicy {
  user: string;
  readOnly: boolean;
  tmpfs: string;
  capDrop: string[];
  securityOpt: string[];
  network: string;
  cpus: string;
  memory: string;
  pidsLimit: number;
  timeoutMs: number;
  runtime?: string;
}

export interface SandboxOptions {
  timeoutMs?: number; // Hard execution limit, default 120,000ms (FR-74)
  allowedEnvVars?: string[];
  workingDirectory?: string;
  useDocker?: boolean;
  runtime?: 'runsc' | 'firecracker' | string;
  policy?: Partial<ContainerSecurityPolicy>;
  stdin?: string | Buffer;
}

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class SandboxTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxTimeoutError';
  }
}
export class SandboxPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPolicyError';
  }
}

/**
 * Isolated Ephemeral Sandbox Runner (FR-73, FR-74).
 * Enforces defense-in-depth isolation constraints:
 * - Mandatory container isolation in production (no host process fallback).
 * - Non-root execution (10001:10001).
 * - Read-only root filesystem with no-exec tmpfs.
 * - All Linux capabilities dropped (cap-drop ALL).
 * - No-new-privileges flag.
 * - Default-deny network egress (--network none).
 * - CPU (1.0), memory (512m), and PID (100) limits.
 * - Hard execution timeout (120 seconds default).
 * - gVisor (runsc) or Firecracker isolation runtime.
 */
export class SandboxRunner {
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 120000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Returns the hardened container security policy enforced in production.
   */
  public static getProductionPolicy(runtime?: string): ContainerSecurityPolicy {
    return {
      user: '10001:10001',
      readOnly: true,
      tmpfs: '/tmp:rw,noexec,nosuid,size=64m',
      capDrop: ['ALL'],
      securityOpt: ['no-new-privileges:true'],
      network: 'none',
      cpus: '1.0',
      memory: '512m',
      pidsLimit: 100,
      timeoutMs: 120000,
      runtime: runtime || process.env.SANDBOX_RUNTIME || 'runsc',
    };
  }

  /**
   * Builds the Docker/gVisor invocation argument vector for container isolation.
   */
  public static buildDockerArgs(
    command: string,
    args: string[],
    policy: ContainerSecurityPolicy,
    sanitizedEnv: Record<string, string>
  ): string[] {
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      `--user=${policy.user}`,
      '--read-only',
      `--tmpfs=${policy.tmpfs}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      `--network=${policy.network}`,
      `--cpus=${policy.cpus}`,
      `--memory=${policy.memory}`,
      `--pids-limit=${policy.pidsLimit}`,
    ];

    if (policy.runtime) {
      dockerArgs.push(`--runtime=${policy.runtime}`);
    }

    for (const [key, value] of Object.entries(sanitizedEnv)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    const imageMap: Record<string, string> = {
      python: 'python:3.12-alpine',
      python3: 'python:3.12-alpine',
      node: 'node:20-alpine',
      bash: 'bash:5.2-alpine',
    };

    const image = imageMap[command] || 'alpine:latest';
    dockerArgs.push(image);
    dockerArgs.push(command);
    dockerArgs.push(...args);

    return dockerArgs;
  }

  /**
   * Probes the container daemon to verify whether an isolation runtime (runsc or firecracker) is genuinely installed.
   */
  public static async isRuntimeAvailable(runtime: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('docker', ['info', '--format', '{{json .Runtimes}}'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      if (child.stdout) {
        child.stdout.on('data', (d) => {
          out += d.toString();
        });
      }
      child.on('error', () => resolve(false));
      child.on('close', (code) => {
        if (code !== 0) return resolve(false);
        try {
          const runtimes = JSON.parse(out);
          resolve(Boolean(runtimes && runtimes[runtime]));
        } catch {
          resolve(false);
        }
      });
    });
  }

  /**
   * Executes a command within an isolated execution context.
   */
  public async execute(
    command: string,
    args: string[],
    options?: SandboxOptions
  ): Promise<SandboxExecutionResult> {
    const isProduction = process.env.NODE_ENV === 'production';
    const allowDevHost = !isProduction && process.env.ALLOW_DEV_HOST_SANDBOX === 'true';

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const startTime = Date.now();

    const isHostBinary = path.isAbsolute(command) || command.endsWith('.exe') || command === process.execPath;
    const useDocker = options?.useDocker ?? (process.env.USE_DOCKER_SANDBOX === 'true' && !isHostBinary);

    // Sanitize environment variables (no host AWS/Azure KMS keys or database credentials)
    const sanitizedEnv: Record<string, string> = {
      LANG: 'en_US.UTF-8',
      NODE_ENV: 'production',
    };

    if (!useDocker) {
      sanitizedEnv.PATH = process.env.PATH || '';
    }

    if (options?.allowedEnvVars) {
      for (const varName of options.allowedEnvVars) {
        if (process.env[varName] !== undefined) {
          sanitizedEnv[varName] = process.env[varName]!;
        }
      }
    }

    // Production enforcement: Container sandbox is mandatory; host process fallback is strictly forbidden
    if (isProduction && !useDocker) {
      throw new SandboxPolicyError(
        'Sandbox container execution is mandatory in production mode. Host process execution fallback is forbidden.'
      );
    }
    if (!isProduction && !useDocker && !allowDevHost && process.env.NODE_ENV !== 'test') {
      throw new SandboxPolicyError(
        'Host execution requires ALLOW_DEV_HOST_SANDBOX=true in non-production environments.'
      );
    }

    const policy: ContainerSecurityPolicy = {
      ...SandboxRunner.getProductionPolicy(options?.runtime),
      ...(options?.policy || {}),
    };

    if (useDocker && isProduction) {
      const isRuntimePresent = await SandboxRunner.isRuntimeAvailable(policy.runtime || 'runsc');
      if (!isRuntimePresent) {
        throw new SandboxPolicyError(
          `Configured sandbox runtime '${policy.runtime || 'runsc'}' is unavailable in Docker daemon. Helper execution is unsupported and blocked in production mode.`
        );
      }
    }

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let child: ReturnType<typeof spawn>;

      if (useDocker) {
        const dockerArgs = SandboxRunner.buildDockerArgs(command, args, policy, sanitizedEnv);

        child = spawn('docker', dockerArgs, {
          cwd: options?.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // Ephemeral host process execution (sanitized environment & hard timeout - dev/test only)
        child = spawn(command, args, {
          env: sanitizedEnv,
          cwd: options?.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const MAX_OUTPUT_SIZE = 64 * 1024;
      let stdoutBytes = 0;
      let stderrBytes = 0;

      if (child.stdout) child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= MAX_OUTPUT_SIZE) return;
        const remaining = MAX_OUTPUT_SIZE - stdoutBytes;
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      });
      if (child.stderr) child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_OUTPUT_SIZE) return;
        const remaining = MAX_OUTPUT_SIZE - stderrBytes;
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      });

      if (child.stdin) {
        child.stdin.end(options?.stdin);
      }

      // Hard timeout enforcement (FR-74)
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');

        const stdout = OutputSanitizer.sanitize(rawStdout);
        const stderr = OutputSanitizer.sanitize(rawStderr);

        if (timedOut) {
          resolve({
            exitCode: -1,
            stdout,
            stderr: `${stderr}\nExecution exceeded hard timeout limit of ${timeoutMs}ms.`,
            durationMs,
            timedOut: true,
          });
          return;
        }

        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs,
          timedOut: false,
        });
      });
    });
  }
}
