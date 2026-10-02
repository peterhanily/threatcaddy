import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { logger } from '../lib/logger.js';

const docker = new Docker();

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;

const LANGUAGE_IMAGES: Record<string, { image: string; cmd: (code: string) => string[] }> = {
  python: {
    image: process.env.SANDBOX_PYTHON_IMAGE || 'python:3.12-slim',
    cmd: (code) => ['python3', '-c', code],
  },
  nodejs: {
    image: process.env.SANDBOX_NODE_IMAGE || 'node:22-alpine',
    cmd: (code) => ['node', '-e', code],
  },
  bash: {
    image: process.env.SANDBOX_BASH_IMAGE || 'alpine:3.19',
    cmd: (code) => ['sh', '-c', code],
  },
};

export interface CodeExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
}

/**
 * Execute code in an ephemeral Docker container with strict isolation.
 *
 * Security controls:
 * - No network access (NetworkMode: 'none')
 * - Read-only root filesystem
 * - tmpfs workspace (50MB) and /tmp (10MB)
 * - Drop all Linux capabilities
 * - No privilege escalation
 * - Run as nobody (65534)
 * - PID limit of 64 (prevents fork bombs)
 * - 128MB memory limit, 0.5 CPU
 * - Container auto-removed on exit
 */
export async function executeCode(
  language: string,
  code: string,
  opts?: { timeout?: number; stdin?: string; signal?: AbortSignal },
): Promise<CodeExecutionResult> {
  opts?.signal?.throwIfAborted();
  const langConfig = LANGUAGE_IMAGES[language];
  if (!langConfig) {
    throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_IMAGES).join(', ')}`);
  }

  const timeoutS = Math.min(Math.max(opts?.timeout || DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S);
  const startTime = Date.now();

  const container = await docker.createContainer({
    Image: langConfig.image,
    Cmd: langConfig.cmd(code),
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: !!opts?.stdin,
    OpenStdin: !!opts?.stdin,
    StdinOnce: true,
    NetworkDisabled: true,
    WorkingDir: '/sandbox',
    User: '65534:65534', // nobody
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Tmpfs: {
        '/sandbox': 'rw,noexec,nosuid,size=50m',
        '/tmp': 'rw,noexec,nosuid,size=10m',
      },
      Memory: 128 * 1024 * 1024,       // 128MB
      MemorySwap: 128 * 1024 * 1024,    // same as Memory (no swap)
      NanoCpus: 500_000_000,            // 0.5 CPU
      PidsLimit: 64,
      SecurityOpt: ['no-new-privileges'],
      CapDrop: ['ALL'],
      AutoRemove: true,
    },
  });

  let timedOut = false;
  let truncated = false;
  let stdoutBuf = '';
  let stderrBuf = '';
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    timedOut = true;
    void container.kill().catch(() => { /* already stopped */ });
  };

  try {
    // Attach to streams before starting
    const stream = await container.attach({ stream: true, stdout: true, stderr: true, stdin: !!opts?.stdin });
    opts?.signal?.throwIfAborted();

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    container.modem.demuxStream(stream, stdout, stderr);

    stdout.on('data', (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
        stdoutBuf += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdoutBuf.length);
      } else {
        truncated = true;
      }
    });

    stderr.on('data', (chunk: Buffer) => {
      if (stderrBuf.length < MAX_OUTPUT_BYTES) {
        stderrBuf += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stderrBuf.length);
      } else {
        truncated = true;
      }
    });

    // Send stdin if provided
    if (opts?.stdin) {
      stream.write(opts.stdin);
      stream.end();
    }

    await container.start();

    // Timeout killer
    killTimer = setTimeout(async () => {
      timedOut = true;
      try { await container.kill(); } catch { /* already dead */ }
    }, timeoutS * 1000);

    // Abort signal integration
    if (opts?.signal) {
      opts.signal.addEventListener('abort', onAbort as EventListener, { once: true });
      if (opts.signal.aborted) onAbort();
    }

    // Wait for container to finish
    const waitResult = await container.wait();

    // Give streams a moment to flush
    await new Promise(r => setTimeout(r, 100));

    return {
      exitCode: waitResult.StatusCode,
      stdout: stdoutBuf,
      stderr: stderrBuf,
      timedOut,
      durationMs: Date.now() - startTime,
      truncated,
    };
  } catch (err) {
    // Try to clean up on error (AutoRemove may have already done it)
    try { await container.remove({ force: true }); } catch { /* noop */ }

    if (timedOut) {
      return {
        exitCode: 137,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        timedOut: true,
        durationMs: Date.now() - startTime,
        truncated,
      };
    }
    throw err;
  } finally {
    clearTimeout(killTimer);
    opts?.signal?.removeEventListener('abort', onAbort as EventListener);
  }
}

/**
 * Pre-pull sandbox images at server startup.
 * Errors are logged but don't prevent startup.
 */
export async function prePullSandboxImages(): Promise<void> {
  for (const [lang, config] of Object.entries(LANGUAGE_IMAGES)) {
    try {
      await new Promise<void>((resolve, reject) => {
        docker.pull(config.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) { reject(err); return; }
          docker.modem.followProgress(stream, (err2: Error | null) => {
            if (err2) reject(err2); else resolve();
          });
        });
      });
      logger.info(`Sandbox image pulled: ${config.image} (${lang})`);
    } catch (err) {
      logger.warn(`Failed to pull sandbox image ${config.image} (${lang}): ${err}`);
    }
  }
}
