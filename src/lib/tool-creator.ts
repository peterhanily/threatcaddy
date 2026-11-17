// ── Creator Context ───────────────────────────────────────────────────
// The dispatcher computes one creator label per tool call and passes it to the
// entity-creating executors. No shared state: concurrent chat and agent calls
// cannot read each other's label.

/** Agent-created entities carry a synced `ai-generated` tag (D11); the server
 * overwrites createdBy on push, the tag survives. Chat writes were approved by a person. */
export function withCreatorTags(tags: string[], creator: string | undefined): string[] {
  return creator?.startsWith('agent:') && !tags.includes('ai-generated') ? [...tags, 'ai-generated'] : tags;
}
