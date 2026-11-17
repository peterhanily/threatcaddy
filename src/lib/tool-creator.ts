// ── Creator Context ───────────────────────────────────────────────────
// Set before each tool execution so entity-creating functions know who's calling.
// Uses a stack to handle concurrent agent tool calls safely.
const _creatorStack: string[] = [];

export function pushCreator(label: string): void { _creatorStack.push(label); }
export function popCreator(): void { _creatorStack.pop(); }

/** Get the current creator label for entity attribution. */
export function currentCreator(): string | undefined { return _creatorStack.length > 0 ? _creatorStack[_creatorStack.length - 1] : undefined; }

/** Agent-created entities carry a synced `ai-generated` tag (D11); the server
 * overwrites createdBy on push, the tag survives. Chat writes were approved by a person. */
export function withCreatorTags(tags: string[]): string[] {
  return currentCreator()?.startsWith('agent:') && !tags.includes('ai-generated') ? [...tags, 'ai-generated'] : tags;
}
