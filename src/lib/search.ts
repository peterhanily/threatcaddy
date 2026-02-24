import type { Note, Task, TimelineEvent, Whiteboard } from '../types';
import { TIMELINE_EVENT_TYPE_LABELS } from '../types';

export type SearchMode = 'simple' | 'regex' | 'advanced';

export interface SearchQuery {
  mode: SearchMode;
  raw: string;
}

export type SearchResultType = 'note' | 'clip' | 'task' | 'timeline' | 'whiteboard';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  snippet: string;
  tags: string[];
  updatedAt: number;
  matchField: string;
}

export interface UnifiedSearchResult {
  results: SearchResult[];
  error?: string;
}

const MAX_RESULTS = 50;
const MAX_REGEX_INPUT_LEN = 50_000; // Truncate text before applying user regex to prevent ReDoS
const MAX_QUERY_LEN = 1_000; // Max length of raw query input
const MAX_TOKENS = 200; // Max tokens in advanced query parser

export function unifiedSearch(
  notes: Note[],
  tasks: Task[],
  clipsFolderId: string | undefined,
  query: SearchQuery,
  timelineEvents?: TimelineEvent[],
  whiteboards?: Whiteboard[],
): UnifiedSearchResult {
  if (!query.raw.trim()) return { results: [] };
  if (query.raw.length > MAX_QUERY_LEN) return { results: [], error: 'Query too long' };

  const activeNotes = notes.filter((n) => !n.trashed && !n.archived);
  const results: SearchResult[] = [];
  let error: string | undefined;

  if (query.mode === 'simple') {
    const lower = query.raw.toLowerCase();
    for (const note of activeNotes) {
      const matchField = findSimpleMatchField(note, lower);
      if (matchField) {
        results.push(noteToResult(note, clipsFolderId, matchField, query.raw));
      }
    }
    for (const task of tasks) {
      const matchField = findSimpleTaskMatchField(task, lower);
      if (matchField) {
        results.push(taskToResult(task, matchField, query.raw));
      }
    }
    if (timelineEvents) {
      for (const ev of timelineEvents) {
        const matchField = findSimpleTimelineMatchField(ev, lower);
        if (matchField) results.push(timelineEventToResult(ev, matchField, query.raw));
      }
    }
    if (whiteboards) {
      for (const wb of whiteboards) {
        const matchField = findSimpleWhiteboardMatchField(wb, lower);
        if (matchField) results.push(whiteboardToResult(wb, matchField, query.raw));
      }
    }
  } else if (query.mode === 'regex') {
    // Reject patterns with nested quantifiers to prevent ReDoS
    const NESTED_QUANTIFIER = /(\+|\*|\{)\s*(\+|\*|\{)/;
    if (NESTED_QUANTIFIER.test(query.raw)) {
      return { results: [], error: 'Pattern too complex (nested quantifiers)' };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(query.raw, 'i');
    } catch {
      return { results: [], error: 'Invalid regular expression' };
    }
    for (const note of activeNotes) {
      const matchField = findRegexMatchField(note, regex);
      if (matchField) {
        results.push(noteToResult(note, clipsFolderId, matchField, query.raw));
      }
    }
    for (const task of tasks) {
      const matchField = findRegexTaskMatchField(task, regex);
      if (matchField) {
        results.push(taskToResult(task, matchField, query.raw));
      }
    }
    if (timelineEvents) {
      for (const ev of timelineEvents) {
        const matchField = findRegexTimelineMatchField(ev, regex);
        if (matchField) results.push(timelineEventToResult(ev, matchField, query.raw));
      }
    }
    if (whiteboards) {
      for (const wb of whiteboards) {
        const matchField = findRegexWhiteboardMatchField(wb, regex);
        if (matchField) results.push(whiteboardToResult(wb, matchField, query.raw));
      }
    }
  } else if (query.mode === 'advanced') {
    let predicate: ((fields: FieldSet) => boolean) | null;
    try {
      predicate = parseAdvancedQuery(query.raw);
    } catch {
      // Fallback to simple mode on parse failure
      return unifiedSearch(notes, tasks, clipsFolderId, { mode: 'simple', raw: query.raw });
    }
    if (!predicate) {
      return unifiedSearch(notes, tasks, clipsFolderId, { mode: 'simple', raw: query.raw });
    }
    for (const note of activeNotes) {
      const fields: FieldSet = {
        title: note.title,
        content: note.content,
        tags: note.tags.join(' '),
      };
      if (predicate(fields)) {
        results.push(noteToResult(note, clipsFolderId, 'content', query.raw));
      }
    }
    for (const task of tasks) {
      const fields: FieldSet = {
        title: task.title,
        content: task.description || '',
        tags: task.tags.join(' '),
      };
      if (predicate(fields)) {
        results.push(taskToResult(task, 'title', query.raw));
      }
    }
    if (timelineEvents) {
      for (const ev of timelineEvents) {
        const fields: FieldSet = {
          title: ev.title,
          content: [ev.description || '', ev.source, ev.actor || '', TIMELINE_EVENT_TYPE_LABELS[ev.eventType]?.label || ''].join(' '),
          tags: ev.tags.join(' '),
        };
        if (predicate(fields)) results.push(timelineEventToResult(ev, 'title', query.raw));
      }
    }
    if (whiteboards) {
      for (const wb of whiteboards) {
        const fields: FieldSet = {
          title: wb.name,
          content: '',
          tags: wb.tags.join(' '),
        };
        if (predicate(fields)) results.push(whiteboardToResult(wb, 'name', query.raw));
      }
    }
  }

  // Sort by type group (notes, clips, tasks), then updatedAt desc
  const typeOrder: Record<SearchResultType, number> = { note: 0, clip: 1, task: 2, timeline: 3, whiteboard: 4 };
  results.sort((a, b) => {
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    return b.updatedAt - a.updatedAt;
  });

  return { results: results.slice(0, MAX_RESULTS), error };
}

// --- Simple mode helpers ---

function findSimpleMatchField(note: Note, lower: string): string | null {
  if (note.title.toLowerCase().includes(lower)) return 'title';
  if (note.content.toLowerCase().includes(lower)) return 'content';
  if (note.tags.some((t) => t.toLowerCase().includes(lower))) return 'tags';
  return null;
}

function findSimpleTaskMatchField(task: Task, lower: string): string | null {
  if (task.title.toLowerCase().includes(lower)) return 'title';
  if (task.description?.toLowerCase().includes(lower)) return 'description';
  if (task.tags.some((t) => t.toLowerCase().includes(lower))) return 'tags';
  return null;
}

// --- Regex mode helpers ---
// Truncate text before testing user-supplied regex to mitigate ReDoS
function safeRegexTest(regex: RegExp, text: string): boolean {
  return regex.test(text.slice(0, MAX_REGEX_INPUT_LEN));
}

function findRegexMatchField(note: Note, regex: RegExp): string | null {
  if (safeRegexTest(regex, note.title)) return 'title';
  if (safeRegexTest(regex, note.content)) return 'content';
  if (note.tags.some((t) => safeRegexTest(regex, t))) return 'tags';
  return null;
}

function findRegexTaskMatchField(task: Task, regex: RegExp): string | null {
  if (safeRegexTest(regex, task.title)) return 'title';
  if (task.description && safeRegexTest(regex, task.description)) return 'description';
  if (task.tags.some((t) => safeRegexTest(regex, t))) return 'tags';
  return null;
}

// --- Timeline simple/regex helpers ---

function findSimpleTimelineMatchField(ev: TimelineEvent, lower: string): string | null {
  if (ev.title.toLowerCase().includes(lower)) return 'title';
  if (ev.description?.toLowerCase().includes(lower)) return 'description';
  if (ev.source.toLowerCase().includes(lower)) return 'source';
  if (ev.actor?.toLowerCase().includes(lower)) return 'actor';
  const label = TIMELINE_EVENT_TYPE_LABELS[ev.eventType]?.label || '';
  if (label.toLowerCase().includes(lower)) return 'eventType';
  if (ev.tags.some((t) => t.toLowerCase().includes(lower))) return 'tags';
  return null;
}

function findRegexTimelineMatchField(ev: TimelineEvent, regex: RegExp): string | null {
  if (safeRegexTest(regex, ev.title)) return 'title';
  if (ev.description && safeRegexTest(regex, ev.description)) return 'description';
  if (safeRegexTest(regex, ev.source)) return 'source';
  if (ev.actor && safeRegexTest(regex, ev.actor)) return 'actor';
  const label = TIMELINE_EVENT_TYPE_LABELS[ev.eventType]?.label || '';
  if (safeRegexTest(regex, label)) return 'eventType';
  if (ev.tags.some((t) => safeRegexTest(regex, t))) return 'tags';
  return null;
}

// --- Whiteboard simple/regex helpers ---

function findSimpleWhiteboardMatchField(wb: Whiteboard, lower: string): string | null {
  if (wb.name.toLowerCase().includes(lower)) return 'name';
  if (wb.tags.some((t) => t.toLowerCase().includes(lower))) return 'tags';
  return null;
}

function findRegexWhiteboardMatchField(wb: Whiteboard, regex: RegExp): string | null {
  if (safeRegexTest(regex, wb.name)) return 'name';
  if (wb.tags.some((t) => safeRegexTest(regex, t))) return 'tags';
  return null;
}

// --- Result builders ---

function noteToResult(
  note: Note,
  clipsFolderId: string | undefined,
  matchField: string,
  queryRaw: string
): SearchResult {
  const type: SearchResultType = note.folderId === clipsFolderId ? 'clip' : 'note';
  const text = matchField === 'title' ? note.title : note.content;
  return {
    id: note.id,
    type,
    title: note.title,
    snippet: generateSnippet(text, queryRaw, 120),
    tags: note.tags,
    updatedAt: note.updatedAt,
    matchField,
  };
}

function taskToResult(task: Task, matchField: string, queryRaw: string): SearchResult {
  const text = matchField === 'title' ? task.title : (task.description || '');
  return {
    id: task.id,
    type: 'task',
    title: task.title,
    snippet: generateSnippet(text, queryRaw, 120),
    tags: task.tags,
    updatedAt: task.updatedAt,
    matchField,
  };
}

function timelineEventToResult(ev: TimelineEvent, matchField: string, queryRaw: string): SearchResult {
  const textMap: Record<string, string> = {
    title: ev.title,
    description: ev.description || '',
    source: ev.source,
    actor: ev.actor || '',
    eventType: TIMELINE_EVENT_TYPE_LABELS[ev.eventType]?.label || '',
    tags: ev.tags.join(', '),
  };
  return {
    id: ev.id,
    type: 'timeline',
    title: ev.title,
    snippet: generateSnippet(textMap[matchField] || ev.title, queryRaw, 120),
    tags: ev.tags,
    updatedAt: ev.updatedAt,
    matchField,
  };
}

function whiteboardToResult(wb: Whiteboard, matchField: string, queryRaw: string): SearchResult {
  return {
    id: wb.id,
    type: 'whiteboard',
    title: wb.name,
    snippet: generateSnippet(matchField === 'tags' ? wb.tags.join(', ') : wb.name, queryRaw, 120),
    tags: wb.tags,
    updatedAt: wb.updatedAt,
    matchField,
  };
}

// --- Snippet generation ---

export function generateSnippet(text: string, query: string, maxLen: number = 120): string {
  if (!text || !query) return text.slice(0, maxLen);
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
  const contextPad = Math.floor((maxLen - query.length) / 2);
  const start = Math.max(0, idx - contextPad);
  const end = Math.min(text.length, idx + query.length + contextPad);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

// --- Advanced query parser ---

export interface FieldSet {
  title: string;
  content: string;
  tags: string;
}

type Predicate = (fields: FieldSet) => boolean;

// Tokenizer for advanced query
type TokenType = 'FIELD_OP' | 'AND' | 'OR' | 'LPAREN' | 'RPAREN' | 'TERM';
interface Token {
  type: TokenType;
  value: string;
  field?: string;
  op?: string;
  arg?: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    if (tokens.length >= MAX_TOKENS) throw new Error('Query too complex');
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // Parentheses
    if (input[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }

    // Field operations: field:op("arg")
    const fieldMatch = input.slice(i).match(/^(title|content|tags):(contains|startsWith|endsWith)\("([^"]*)"\)/);
    if (fieldMatch) {
      tokens.push({
        type: 'FIELD_OP',
        value: fieldMatch[0],
        field: fieldMatch[1],
        op: fieldMatch[2],
        arg: fieldMatch[3],
      });
      i += fieldMatch[0].length;
      continue;
    }

    // Keywords AND / OR
    const upperSlice = input.slice(i);
    if (/^AND(?:\s|$|\))/.test(upperSlice)) {
      tokens.push({ type: 'AND', value: 'AND' });
      i += 3;
      continue;
    }
    if (/^OR(?:\s|$|\))/.test(upperSlice)) {
      tokens.push({ type: 'OR', value: 'OR' });
      i += 2;
      continue;
    }

    // Quoted term
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) throw new Error('Unterminated quote');
      tokens.push({ type: 'TERM', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Bare term (until space, paren, or end)
    let j = i;
    while (j < input.length && !/[\s()]/.test(input[j])) j++;
    const word = input.slice(i, j);
    tokens.push({ type: 'TERM', value: word });
    i = j;
  }

  return tokens;
}

// Recursive descent parser: expr → orExpr
// orExpr → andExpr (OR andExpr)*
// andExpr → atom (AND? atom)*
// atom → LPAREN expr RPAREN | FIELD_OP | TERM

export function parseAdvancedQuery(input: string): Predicate | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(expected?: TokenType): Token {
    const t = tokens[pos];
    if (!t) throw new Error('Unexpected end of query');
    if (expected && t.type !== expected) throw new Error(`Expected ${expected}, got ${t.type}`);
    pos++;
    return t;
  }

  function parseExpr(): Predicate {
    return parseOr();
  }

  function parseOr(): Predicate {
    let left = parseAnd();
    while (peek()?.type === 'OR') {
      consume('OR');
      const right = parseAnd();
      const l = left, r = right;
      left = (fields) => l(fields) || r(fields);
    }
    return left;
  }

  function parseAnd(): Predicate {
    let left = parseAtom();
    while (peek() && peek()!.type !== 'OR' && peek()!.type !== 'RPAREN') {
      if (peek()?.type === 'AND') consume('AND');
      if (!peek() || peek()!.type === 'OR' || peek()!.type === 'RPAREN') break;
      const right = parseAtom();
      const l = left, r = right;
      left = (fields) => l(fields) && r(fields);
    }
    return left;
  }

  function parseAtom(): Predicate {
    const t = peek();
    if (!t) throw new Error('Unexpected end of query');

    if (t.type === 'LPAREN') {
      consume('LPAREN');
      const expr = parseExpr();
      consume('RPAREN');
      return expr;
    }

    if (t.type === 'FIELD_OP') {
      const token = consume('FIELD_OP');
      const field = token.field as keyof FieldSet;
      const op = token.op!;
      const arg = token.arg!.toLowerCase();
      return (fields) => {
        const val = fields[field].toLowerCase();
        if (op === 'contains') return val.includes(arg);
        if (op === 'startsWith') return val.startsWith(arg);
        if (op === 'endsWith') return val.endsWith(arg);
        return false;
      };
    }

    if (t.type === 'TERM') {
      const term = consume('TERM').value.toLowerCase();
      return (fields) =>
        fields.title.toLowerCase().includes(term) ||
        fields.content.toLowerCase().includes(term) ||
        fields.tags.toLowerCase().includes(term);
    }

    throw new Error(`Unexpected token: ${t.type}`);
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Unexpected tokens after query');
  return result;
}
