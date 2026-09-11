import { spawn } from 'node:child_process';

export interface SandboxOptions {
  timeoutMs?: number; // Hard execution limit, default 120,000ms (FR-74)
  allowedEnvVars?: string[];
  workingDirectory?: string;
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

    return new Promise((resolve, reject) => {
      let timedOut = false;

      const child = spawn(command, args, {
        env: sanitizedEnv,
        cwd: options?.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

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
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');

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
