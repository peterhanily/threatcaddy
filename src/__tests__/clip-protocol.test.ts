import { describe, expect, it } from 'vitest';
import { CLIP_LIMITS, clipReceiptKey, createClipRevision, fingerprintClip,
  serializeClipContent, validateClip, validateClipContent, type ClipContent } from '../lib/clip-protocol';

const fixture: ClipContent = { id: 'clip-example', revision: 1, title: 'Synthetic café',
  content: 'A fictional research note.', sourceUrl: 'https://example.com/research', sourceTitle: 'Example',
  entityType: 'note', folderName: 'Clips', clsLevel: 'TLP:CLEAR', createdAt: 1_700_000_000_000 };

describe('extension clip protocol v2', () => {
  it('uses the extension-compatible fixed-key UTF8 SHA256 vector, independent of object key order', async () => {
    expect(await fingerprintClip(fixture)).toBe('97493d328cfb2bf4cae5d13b07ba6e99ad6c3818bf11dd44505f69175f40450e');
    const reordered = Object.fromEntries(Object.entries(fixture).reverse()) as unknown as ClipContent;
    expect(serializeClipContent(reordered)).toBe(serializeClipContent(fixture));
    expect(await validateClip(await createClipRevision(reordered))).toMatchObject(fixture);
  });

  it('binds revision, identity and exact content bytes without trimming or coercion', async () => {
    const original = await createClipRevision(fixture);
    for (const patch of [{ title: `${fixture.title} ` }, { id: 'another' }, { revision: 2 }, { content: 'Changed' }]) {
      await expect(validateClip({ ...original, ...patch })).rejects.toThrow(/fingerprint/);
    }
    expect(clipReceiptKey('installation-one', fixture)).not.toBe(clipReceiptKey('installation-two', fixture));
  });

  it.each([
    { id: '' }, { revision: 0 }, { revision: 1.5 }, { createdAt: Infinity }, { createdAt: -1 },
    { createdAt: 8_640_000_000_000_001 }, { title: 3 }, { entityType: 'unknown' }, { entityType: ['note'] }, { content: {} }, { sent: false },
  ])('rejects malformed fields without silently normalizing v2: %j', patch => {
    expect(() => validateClipContent({ ...fixture, ...patch })).toThrow();
  });

  it('bounds UTF8 bytes rather than character count and refuses loss instead of truncating', () => {
    const value = { ...fixture, content: 'ééé' };
    expect(validateClipContent(value, { ...CLIP_LIMITS, contentBytes: 6 }).content).toBe('ééé');
    expect(() => validateClipContent(value, { ...CLIP_LIMITS, contentBytes: 5 })).toThrow(/limit/);
    expect(() => validateClipContent(fixture, { ...CLIP_LIMITS, clipBytes: 10 })).toThrow(/full-clip/);
  });

  it('requires a fingerprint before import', async () => {
    await expect(validateClip(fixture)).rejects.toThrow(/fingerprint/);
  });
});
