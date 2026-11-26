/**
 * Provider-safe tool names. Anthropic, OpenAI and Mistral accept only
 * ^[a-zA-Z0-9_-]{1,64}$, but dynamic skills are named local:<skill> and
 * host:<host>:<skill>. Internal names never change: each transport sends
 * aliases and decodes the response before any executor or policy sees it.
 */
const PROVIDER_SAFE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Deterministic and synchronous (no crypto.subtle): FNV-1a 64 over UTF-8. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, '0');
}

const isToolUse = (block: unknown): block is { type: 'tool_use'; name: string } =>
  !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_use' && typeof (block as { name?: unknown }).name === 'string';

const nameOf = (tool: unknown) => (tool && typeof tool === 'object' && typeof (tool as { name?: unknown }).name === 'string' ? (tool as { name: string }).name : undefined);

/** Alias tools[].name and replayed tool_use names; decode() maps an alias back and leaves other names unchanged. */
export function encodeRequest<T extends { messages: unknown[]; tools?: unknown[] }>(request: T): { req: T; decode: (name: string) => string } {
  const historyNames = request.messages.flatMap(message => {
    const content = message && typeof message === 'object' ? (message as { content?: unknown }).content : undefined;
    return Array.isArray(content) ? content.filter(isToolUse).map(block => block.name) : [];
  });
  const names = [...new Set([...(request.tools ?? []).map(nameOf).filter((name): name is string => name !== undefined), ...historyNames])];
  const unchanged = new Set(names.filter(name => PROVIDER_SAFE_NAME.test(name)));
  const readable = new Map(names.filter(name => !unchanged.has(name)).map(name => [name, name.replaceAll(':', '__')]));
  const uses = new Map<string, number>();
  for (const alias of readable.values()) uses.set(alias, (uses.get(alias) ?? 0) + 1);
  const aliases = new Map<string, string>();
  const decoded = new Map<string, string>();
  for (const [name, simple] of readable) {
    // A readable alias that is too long, ambiguous or already a real name falls back to a hash.
    const alias = PROVIDER_SAFE_NAME.test(simple) && uses.get(simple) === 1 && !unchanged.has(simple) ? simple : `dyn_${fnv1a64(name)}`;
    if (unchanged.has(alias) || decoded.has(alias)) throw new Error(`Tool name alias ${alias} collides with another tool name.`);
    aliases.set(name, alias);
    decoded.set(alias, name);
  }
  if (!aliases.size) return { req: request, decode: name => name };
  const rename = (block: unknown) => (isToolUse(block) && aliases.has(block.name) ? { ...block, name: aliases.get(block.name) } : block);
  return {
    req: {
      ...request,
      messages: request.messages.map(message => {
        const content = message && typeof message === 'object' ? (message as { content?: unknown }).content : undefined;
        return Array.isArray(content) ? { ...(message as object), content: content.map(rename) } : message;
      }),
      ...(request.tools ? { tools: request.tools.map(tool => { const name = nameOf(tool); return name && aliases.has(name) ? { ...(tool as object), name: aliases.get(name) } : tool; }) } : {}),
    },
    decode: name => decoded.get(name) ?? name,
  };
}

/** The blocks a provider returned, without the gaps. The extension and the team server keep only text
 * and tool_use blocks at their stream positions, so a model that thinks first (every current Claude
 * model) leaves a hole, which arrives as null. */
export function presentBlocks(blocks: unknown): unknown[] {
  return Array.isArray(blocks) ? blocks.filter(block => block !== null && typeof block === 'object') : [];
}

/** Restore internal names on response tool_use blocks. */
export function decodeBlocks(blocks: unknown[], decode: (name: string) => string): unknown[] {
  return presentBlocks(blocks).map(block => (isToolUse(block) ? { ...block, name: decode(block.name) } : block));
}
