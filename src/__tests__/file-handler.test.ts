import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatBytes, installFileHandler } from '../lib/file-handler';
import type { FileOpenDetail } from '../lib/file-handler';

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2560)).toBe('2.5 KB');
    expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
  });
});

describe('installFileHandler', () => {
  beforeEach(() => {
    // Clear any previous launchQueue
    delete (window as unknown as Record<string, unknown>).launchQueue;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).launchQueue;
  });

  it('does nothing when launchQueue is not available', () => {
    // Should not throw
    installFileHandler();
  });

  it('sets a consumer on the launchQueue', () => {
    const setConsumer = vi.fn();
    (window as unknown as Record<string, unknown>).launchQueue = { setConsumer };

    installFileHandler();

    expect(setConsumer).toHaveBeenCalledOnce();
    expect(typeof setConsumer.mock.calls[0][0]).toBe('function');
  });

  it('dispatches threatcaddy:file-open event for each file', async () => {
    const setConsumer = vi.fn();
    (window as unknown as Record<string, unknown>).launchQueue = { setConsumer };

    installFileHandler();

    const consumer = setConsumer.mock.calls[0][0];

    const received: FileOpenDetail[] = [];
    const listener = (e: Event) => {
      received.push((e as CustomEvent<FileOpenDetail>).detail);
    };
    window.addEventListener('threatcaddy:file-open', listener);

    // Simulate a file handle
    const mockFile = new File(['# Threat Report\n\nIOC: 1.2.3.4'], 'report.md', {
      type: 'text/markdown',
      lastModified: 1700000000000,
    });

    const mockHandle = {
      getFile: vi.fn().mockResolvedValue(mockFile),
    };

    await consumer({ files: [mockHandle] });

    window.removeEventListener('threatcaddy:file-open', listener);

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('report.md');
    expect(received[0].content).toBe('# Threat Report\n\nIOC: 1.2.3.4');
    expect(received[0].size).toBe(mockFile.size);
    expect(received[0].lastModified).toBe(1700000000000);
  });

  it('handles file read errors gracefully', async () => {
    const setConsumer = vi.fn();
    (window as unknown as Record<string, unknown>).launchQueue = { setConsumer };

    installFileHandler();

    const consumer = setConsumer.mock.calls[0][0];
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockHandle = {
      getFile: vi.fn().mockRejectedValue(new Error('Permission denied')),
    };

    // Should not throw
    await consumer({ files: [mockHandle] });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to read launched file:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});
