// Each route gets a disposable 512 MiB worker and an external deadline (ten
// seconds, twenty for eight wide-object rounds). No live or retained database is
// used. A blocked worker cannot prevent its parent from killing the process group.
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const scenarios = process.argv.slice(2);
if (scenarios.some(value => !['sync', 'sync-wide', 'steps', 'outputs', 'triggers'].includes(value))) throw new Error('Unknown resource scenario');
if (process.platform === 'win32') throw new Error('Resource isolation requires POSIX process groups (Linux or macOS)');
let failed = false;
for (const scenario of scenarios.length ? scenarios : ['sync', 'sync-wide', 'steps', 'outputs', 'triggers']) {
  // Hosted Linux measured ~1.2 seconds per wide-object request, before GC and
  // fixture startup. Allow all eight rounds; keep the external hard kill.
  const deadlineMs = scenario === 'sync-wide' ? 20_000 : 10_000;
  const started = performance.now();
  const reports = [];
  let output = '', pending = '', workerPid, sampledPeakRssBytes = 0, timedOut = false, sampling = false, samplingAvailable = true;
  const child = spawn(process.execPath, ['--max-old-space-size=512', 'node_modules/vitest/vitest.mjs',
    'run', '--config', 'vitest.resource.config.ts', '--reporter=dot'], {
    cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.fromEntries(Object.entries({
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      SystemRoot: process.env.SystemRoot, CI: 'true', NO_COLOR: '1', RESOURCE_SCENARIO: scenario,
    }).filter(([, value]) => value !== undefined)),
  });
  function consume(chunk) {
    const text = chunk.toString();
    output = (output + text).slice(-16 * 1024);
    pending += text;
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) break;
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      const marker = line.indexOf('RESOURCE_REPORT ');
      if (marker < 0) continue;
      try {
        const report = JSON.parse(line.slice(marker + 'RESOURCE_REPORT '.length));
        reports.push(report);
        if (report.kind === 'start') workerPid = report.pid;
      } catch { /* Non-report diagnostics are retained in bounded output. */ }
    }
    if (pending.length > 32 * 1024) pending = pending.slice(-32 * 1024);
  }
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const samplingTimer = setInterval(() => {
    if (!workerPid || sampling || !samplingAvailable) return;
    sampling = true;
    try {
      execFile('ps', ['-o', 'rss=', '-p', String(workerPid)], { timeout: 500 }, (error, stdout) => {
        sampling = false;
        if (error && ['EPERM', 'EACCES', 'ENOENT'].includes(error.code)) samplingAvailable = false;
        const rss = Number(stdout.trim()) * 1024;
        if (Number.isFinite(rss)) sampledPeakRssBytes = Math.max(sampledPeakRssBytes, rss);
      });
    } catch (error) {
      sampling = false; samplingAvailable = false;
      if (!['EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
    }
  }, 100);
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }, deadlineMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout); clearInterval(samplingTimer);
  // Also remove any worker left behind when the Vitest coordinator exits early.
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const complete = reports.find(value => value.kind === 'complete');
  const pass = result.code === 0 && !timedOut && complete?.survives === true;
  const heapExhausted = /heap out of memory|Reached heap limit|Ineffective mark-compacts/i.test(output);
  const requestsCompleted = reports.filter(value => value.kind === 'request').length;
  console.log(JSON.stringify({ scenario, pass, ...result, timedOut, requestsCompleted,
    workerSurvived: result.code === 0 && !heapExhausted && !timedOut && !result.signal && complete?.survives === true,
    completedSequence: Boolean(complete?.survives), heapExhausted,
    deadlineMs, elapsedMs: Math.round(performance.now() - started), samplingAvailable, sampledPeakRssBytes, reports }));
  if (!pass) { failed = true; console.error(output); }
}
if (failed) process.exitCode = 1;
