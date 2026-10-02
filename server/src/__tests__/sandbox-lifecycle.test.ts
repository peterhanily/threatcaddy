import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
const fixture = vi.hoisted(() => ({ create: vi.fn(), attach: vi.fn(), start: vi.fn(), kill: vi.fn(), wait: vi.fn(), remove: vi.fn() }));
vi.mock('dockerode', () => ({ default: class { createContainer = fixture.create; } }));
import { executeCode } from '../bots/sandbox.js';
describe('sandbox cancellation lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixture.create.mockResolvedValue({ ...fixture, modem: { demuxStream: vi.fn() } });
    fixture.attach.mockResolvedValue(new PassThrough());
    fixture.start.mockResolvedValue(undefined); fixture.kill.mockResolvedValue(undefined); fixture.remove.mockResolvedValue(undefined);
    fixture.wait.mockResolvedValue({ StatusCode: 0 });
  });
  it('does not create a container for an already cancelled run', async () => {
    await expect(executeCode('nodejs', 'console.log("ordinary fixture")', { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it('removes an unstarted container if cancellation occurs while attaching', async () => {
    const controller = new AbortController();
    fixture.attach.mockImplementation(async () => { controller.abort(); return new PassThrough(); });
    await expect(executeCode('nodejs', 'console.log("ordinary fixture")', { signal: controller.signal })).rejects.toThrow();
    expect(fixture.start).not.toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledWith({ force: true });
  });
  it('observes cancellation arriving during container startup', async () => {
    const controller = new AbortController();
    fixture.start.mockImplementation(async () => { controller.abort(); });
    expect(await executeCode('nodejs', 'console.log("ordinary fixture")', { signal: controller.signal })).toMatchObject({ timedOut: true });
    expect(fixture.kill).toHaveBeenCalledOnce();
  });
});
