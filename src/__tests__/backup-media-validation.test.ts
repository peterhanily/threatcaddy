import { describe, expect, it } from 'vitest';
import { validateBackupMedia, validateBackupURL } from '../lib/backup-media-validation';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';

describe('portable backup media contracts', () => {
  it('validates image records without changing their bytes or metadata', () => {
    const evidence = { imageData: pixel, imageDataMimeType: 'image/png' };
    const board = { files: JSON.stringify({ pixel: { id: 'pixel', mimeType: 'image/png', dataURL: `data:image/png;base64,${pixel}`, created: 1, lastRetrieved: 2, version: 3 } }) };
    const chat = { messages: [{ attachments: [{ type: 'image', mimeType: 'image/png', data: pixel, name: 'pixel.png' }] }] };
    const before = JSON.stringify([evidence, board, chat]);
    validateBackupMedia('evidenceItems', evidence);
    validateBackupMedia('whiteboards', board);
    validateBackupMedia('chatThreads', chat);
    expect(JSON.stringify([evidence, board, chat])).toBe(before);
  });

  it.each([
    { imageData: pixel },
    { imageData: pixel, imageDataMimeType: 'text/plain' },
    { imageData: 'not base64', imageDataMimeType: 'image/png' },
    { imageData: 'A'.repeat(4_250_004), imageDataMimeType: 'image/png' },
  ])('rejects malformed or unsupported evidence without silently stripping it', value => {
    expect(() => validateBackupMedia('evidenceItems', value)).toThrow('Invalid backup media');
  });

  it('rejects remote whiteboard image references without fetching them', () => {
    const board = { files: JSON.stringify({ pixel: { id: 'pixel', mimeType: 'image/png', dataURL: 'https://example.test/pixel.png', created: 1 } }) };
    expect(() => validateBackupMedia('whiteboards', board)).toThrow('Invalid backup media');
  });

  it('requires matching whiteboard file identity and image MIME', () => {
    for (const changes of [{ id: 'other' }, { mimeType: 'image/jpeg' }, { created: 'yesterday' }]) {
      const board = { files: JSON.stringify({ pixel: { id: 'pixel', mimeType: 'image/png', dataURL: `data:image/png;base64,${pixel}`, created: 1, ...changes } }) };
      expect(() => validateBackupMedia('whiteboards', board)).toThrow('Invalid backup media');
    }
  });

  it('accepts empty optional media collections', () => {
    expect(() => validateBackupMedia('whiteboards', { files: '{}' })).not.toThrow();
    expect(() => validateBackupMedia('chatThreads', { messages: [{ attachments: [] }] })).not.toThrow();
    expect(() => validateBackupMedia('evidenceItems', {})).not.toThrow();
    expect(() => validateBackupMedia('evidenceItems', { imageDataMimeType: 'image/png', extractionStatus: 'metadata-only' })).not.toThrow();
  });

  it('retains supported Excalidraw SVG bytes as image data, without inserting markup or changing metadata', () => {
    const drawing = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="blue"/></svg>');
    const board = { files: JSON.stringify({ shape: { id: 'shape', mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${drawing}`, created: 1, version: 2 } }) };
    const before = board.files;
    expect(() => validateBackupMedia('whiteboards', board)).not.toThrow();
    expect(board.files).toBe(before);
    const chat = { messages: [{ attachments: [{ type: 'image', data: drawing, mimeType: 'image/svg+xml' }] }] };
    expect(() => validateBackupMedia('chatThreads', chat)).not.toThrow();
  });
});

describe('portable quick-link URLs', () => {
  it.each(['https://example.test/path?q=value#section', 'http://localhost:1234/'])('preserves supported HTTP(S) links', url => {
    expect(() => validateBackupURL(url)).not.toThrow();
  });
  it.each(['file:///synthetic-report.txt', 'mailto:analyst@example.test', 'not a URL'])('rejects unsupported links before restoring', url => {
    expect(() => validateBackupURL(url)).toThrow('HTTP(S)');
  });
});
