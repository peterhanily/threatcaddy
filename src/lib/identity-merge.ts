import { nanoid } from 'nanoid';
import type { Identity, IdentityConnection, IdentityStatus } from '../types';
import { conservativeClsLevel } from './classification';
import { IDENTITY_STATUSES } from './entity-enums';
import { sameText as normalized } from './identity-model';

/**
 * Merging one identity into another, as plain functions (no React): the Identities view merges with
 * them, and sync uses them to finish a merge whose merged-away identity a teammate changed meanwhile,
 * or to cancel one when the analyst keeps the teammate's version of the kept identity.
 */
const sameText = (a: string, b: string) => normalized(a) === normalized(b);
/** Lower is more serious; no status ranks last. */
const statusRank = (status?: IdentityStatus) => (status ? IDENTITY_STATUSES.indexOf(status) : IDENTITY_STATUSES.length);

/** One edge per target and label, and never to itself. */
export function distinctConnections(edges: IdentityConnection[], selfId: string): IdentityConnection[] {
  return edges.filter((edge, index) => edge.targetId !== selfId
    && edges.findIndex(other => other.targetId === edge.targetId && sameText(other.label, edge.label)) === index);
}

/** Edges to the merged-away identity, pointed at the kept one. */
export const retarget = (edges: IdentityConnection[], goneId: string, keepId: string) =>
  edges.map(edge => edge.targetId === goneId ? { ...edge, targetId: keepId } : edge);

/**
 * The kept identity with the merged-away one folded in. Merge cannot be undone, so nothing is dropped:
 * every name, detail, connection and tag of both, both descriptions, the more serious status and the
 * more restrictive classification. Folding in the same identity again adds only what it does not hold.
 */
export function mergeIdentityRows(keep: Identity, gone: Identity, now: number): Identity {
  const aliases = [...keep.aliases];
  for (const name of [gone.name, ...gone.aliases]) {
    if (name.trim() && !sameText(name, keep.name) && !aliases.some(alias => sameText(alias, name))) aliases.push(name);
  }
  const details = [...keep.details];
  for (const detail of gone.details) {
    const same = details.findIndex(kept => sameText(kept.label, detail.label) && sameText(kept.value, detail.value));
    // The same detail stays private if either identity marked it private.
    if (same >= 0) { if (detail.private) details[same] = { ...details[same], private: true }; continue; }
    details.push(details.some(kept => kept.id === detail.id) ? { ...detail, id: nanoid() } : detail);
  }
  const holdsDescription = !gone.description || (!!keep.description && normalized(keep.description).includes(normalized(gone.description)));
  return {
    ...keep,
    description: holdsDescription ? keep.description || gone.description : keep.description ? `${keep.description}\n\n${gone.description}` : gone.description,
    aliases,
    status: statusRank(gone.status) < statusRank(keep.status) ? gone.status : keep.status,
    contact: keep.contact || gone.contact || undefined,
    details,
    connections: distinctConnections(retarget([...keep.connections, ...gone.connections], gone.id, keep.id), keep.id),
    tags: [...new Set([...keep.tags, ...gone.tags])],
    clsLevel: conservativeClsLevel([keep.clsLevel, gone.clsLevel]),
    updatedAt: now,
  };
}

/**
 * Undoes a merge's retargeting on another identity: the edges the merge pointed at the kept identity
 * go back to the merged-away one. `before` is that identity's connections before the merge; edges
 * added since are kept.
 */
export function undoRetarget(current: IdentityConnection[], before: IdentityConnection[], keepId: string, goneId: string, selfId: string): IdentityConnection[] {
  const hadToKeep = (label: string) => before.some(edge => edge.targetId === keepId && sameText(edge.label, label));
  const kept = current.filter(edge => edge.targetId !== keepId || hadToKeep(edge.label));
  return distinctConnections([...kept, ...before.filter(edge => edge.targetId === goneId)], selfId);
}
