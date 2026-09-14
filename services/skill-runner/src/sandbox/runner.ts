import { spawn } from 'node:child_process';
import path from 'node:path';
import { OutputSanitizer } from './sanitizer.js';

export interface SandboxOptions {
  timeoutMs?: number; // Hard execution limit, default 120,000ms (FR-74)
  allowedEnvVars?: string[];
  workingDirectory?: string;
  useDocker?: boolean;
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

/**
 * Isolated Ephemeral Sandbox Runner (FR-73, FR-74).
 * Enforces defense-in-depth isolation constraints:
 * - Sanitized environment (no host secrets or database credentials).
 * - Hard execution timeout (120 seconds default).
 * - Immediate process termination and teardown.
 */
export class SandboxRunner {
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 120000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Executes a command within an isolated execution context.
   */
  public async execute(
    command: string,
    args: string[],
    options?: SandboxOptions
  ): Promise<SandboxExecutionResult> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const startTime = Date.now();

    // Sanitize environment variables (no host AWS/Azure KMS keys or database credentials)
    const sanitizedEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      LANG: 'en_US.UTF-8',
      NODE_ENV: 'production',
    };

    if (options?.allowedEnvVars) {
      for (const varName of options.allowedEnvVars) {
        if (process.env[varName] !== undefined) {
          sanitizedEnv[varName] = process.env[varName]!;
        }
      }
    }

    const isHostBinary = path.isAbsolute(command) || command.endsWith('.exe') || command === process.execPath;
    const useDocker = options?.useDocker ?? (process.env.USE_DOCKER_SANDBOX === 'true' && !isHostBinary);

    return new Promise((resolve, reject) => {
      let timedOut = false;

      let child: ReturnType<typeof spawn>;

      if (useDocker) {
        // Construct Docker arguments for strict container sandboxing (FR-73)
        const dockerArgs = [
          'run',
          '--rm',                     // Auto-remove container on exit
          '--network', 'none',        // No network access by default
          '--read-only',              // Root filesystem is read-only
          '--tmpfs', '/tmp',          // Ephemeral tmpfs for working storage
          '--memory', '256m',         // Memory limit
          '--cpus', '1.0',            // CPU limit
          '--user', '1000:1000',      // Non-root execution
        ];

        // Add sanitized env vars
        for (const [key, value] of Object.entries(sanitizedEnv)) {
          dockerArgs.push('-e', `${key}=${value}`);
        }
        
        const imageMap: Record<string, string> = {
          'python': 'python:3.12-alpine',
          'python3': 'python:3.12-alpine',
          'node': 'node:20-alpine',
        };
        
        const image = imageMap[command] || 'alpine:latest';
        dockerArgs.push(image);
        dockerArgs.push(command);
        dockerArgs.push(...args);

        child = spawn('docker', dockerArgs, {
          cwd: options?.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // Ephemeral isolated host process execution (sanitized environment & hard timeout)
        child = spawn(command, args, {
          env: sanitizedEnv,
          cwd: options?.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      if (child.stdout) child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      if (child.stderr) child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

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
