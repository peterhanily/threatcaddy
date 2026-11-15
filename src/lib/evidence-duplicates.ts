import type { EvidenceItem } from '../types';

export function evidenceFileKeyFromFile(file: File): string {
  return evidenceFileIdentityKey({
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified || undefined,
  });
}

export function evidenceFileKeyFromItem(item: Pick<EvidenceItem, 'folderId' | 'fileName' | 'size' | 'lastModified'>): string {
  return `${item.folderId || ''}|${evidenceFileIdentityKey(item)}`;
}

export function evidenceDuplicateGroupKey(item: EvidenceItem): string {
  return [
    evidenceFileKeyFromItem(item),
    item.chunkIndex || 1,
    item.chunkCount || 1,
    hashString(item.content || ''),
  ].join('|');
}

export function findDuplicateEvidenceItemIds(items: EvidenceItem[], folderId?: string): string[] {
  const activeItems = items
    .filter((item) => !item.trashed && !item.archived)
    .filter((item) => !folderId || item.folderId === folderId);

  const groups = new Map<string, EvidenceItem[]>();
  for (const item of activeItems) {
    const key = evidenceDuplicateGroupKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const duplicateIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(compareEvidenceKeepPriority);
    duplicateIds.push(...sorted.slice(1).map((item) => item.id));
  }
  return duplicateIds;
}

function evidenceFileIdentityKey(item: Pick<EvidenceItem, 'fileName' | 'size' | 'lastModified'>): string {
  return [
    item.fileName.trim().toLowerCase(),
    item.size,
    item.lastModified || 0,
  ].join('|');
}

function compareEvidenceKeepPriority(a: EvidenceItem, b: EvidenceItem): number {
  const richnessA = evidenceRichnessScore(a);
  const richnessB = evidenceRichnessScore(b);
  if (richnessA !== richnessB) return richnessB - richnessA;
  if (a.importedAt !== b.importedAt) return a.importedAt - b.importedAt;
  return a.createdAt - b.createdAt;
}

function evidenceRichnessScore(item: EvidenceItem): number {
  return [
    (item.linkedIOCIds?.length || 0) * 100,
    item.imageAnalysis?.trim() ? 40 : 0,
    item.imageOcrText?.trim() ? 35 : 0,
    item.imageData ? 30 : 0,
    item.extractionWarning?.trim() ? 5 : 0,
    item.clsLevel?.trim() ? 3 : 0,
    item.tags.length,
  ].reduce((total, score) => total + score, 0);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
