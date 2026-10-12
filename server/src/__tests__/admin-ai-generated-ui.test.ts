import { describe, expect, it, vi } from 'vitest';
import { createContext, Script } from 'node:vm';
import { aiStreamJs } from '../routes/admin-html/ai-stream.js';
import { aiTabJs } from '../routes/admin-html/ai-tab.js';
import { getAdminHtml } from '../routes/admin-html/index.js';

interface Parser { push(bytes: Uint8Array): boolean; finish(): void; isTerminal(): boolean }
function fixture() {
  const context = createContext({ TextDecoder, TextEncoder });
  new Script(aiStreamJs()).runInContext(context);
  const events: Record<string, unknown>[] = [];
  const parser = (context.createAdminAiSseParser as (fn: (value: Record<string, unknown>) => void) => Parser)(value => events.push(value));
  return { parser, events };
}
const bytes = (text: string) => new TextEncoder().encode(text);
const frame = (value: unknown, newline = '\n') => `data: ${JSON.stringify(value)}${newline}${newline}`;
const settingsSnapshot = { localEndpoint: '', localApiKey: '', localModelName: 'Fictional model', customSystemPrompt: '', temperature: 0 };
function settingsFixture(withProviders = false) {
  type Element = { value: string; textContent: string; disabled: boolean; placeholder: string; style: Record<string, string>; options: Element[];
    addEventListener(): void; replaceChildren(): void; appendChild(child: Element): void };
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      let value = '';
      const options: Element[] = [];
      elements.set(id, { get value() { return value; }, set value(next: string) { value = String(next); },
        textContent: '', disabled: false, placeholder: '', style: {}, options, addEventListener() {},
        replaceChildren() { options.length = 0; value = ''; }, appendChild(child) { options.push(child); if (!value) value = child.value; } });
    }
    return elements.get(id)!;
  };
  let created = 0;
  const context = createContext({ TextDecoder, TextEncoder, AbortController, token: 'fictional-session', window: {},
    document: { getElementById: element, createElement: () => element('created-' + created++) } });
  new Script(aiTabJs()).runInContext(context);
  if (!withProviders) context.loadAiProviders = () => {};
  return { context, element, load: context.loadAiSettings as () => Promise<void>, save: context.saveAiSettings as () => Promise<void> };
}

describe('the actual generated administrative AI JavaScript', () => {
  it.each(['success', 'failure'])('discards an older provider %s and coalesces a fresh list after settings save', async outcome => {
    const { context, element, save } = settingsFixture(true);
    context.aiSettingsLoaded = true; context.aiSettingsHasSnapshot = true;
    element('aiTemperature').value = '0';
    let finish!: (value: unknown) => void; let fail!: (error: Error) => void;
    const older = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let reads = 0;
    context.aiRequestJSON = (path: string, options: { method?: string }) => {
      if (path === '/ai/settings' && options.method === 'PATCH') return Promise.resolve(settingsSnapshot);
      expect(path).toBe('/ai/providers');
      return ++reads === 1 ? older : Promise.resolve({ providers: [{ provider: 'local', models: ['current-model'] }], settings: { defaultProvider: 'local' } });
    };
    const loading = (context.loadAiProviders as () => Promise<void>)();
    await save();
    (context.refreshAiProviders as () => void)(); // repeated refresh requests coalesce, not parallel reads
    expect(reads).toBe(1); expect(element('aiSendBtn').disabled).toBe(true);
    element('aiInput').value = 'Fictional unsent draft';
    (context.sendAiMessage as () => void)();
    expect(element('aiInput').value).toBe('Fictional unsent draft');
    if (outcome === 'success') finish({ providers: [{ provider: 'openai', models: ['old-model'] }] });
    else fail(new Error('Fictional old read failure'));
    await loading;
    await vi.waitFor(() => expect(context.aiProvidersLoaded).toBe(true));
    expect(reads).toBe(2);
    expect(element('aiProviderSelect').options.map(option => option.value)).toEqual(['local']);
    expect(element('aiModelSelect').value).toBe('current-model');
    expect(element('aiProviderHint').textContent).toBe('');
    expect(element('aiSettingsStatus').textContent).toBe('AI settings saved.');
    expect(element('aiSendBtn').disabled).toBe(false);
  });
  it('parses the complete HTML script, including its real interpolation/escaping layers', () => {
    const html = getAdminHtml('fictional-test-nonce');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(() => new Script(scripts[0][1])).not.toThrow();
  });

  it('formats ordinary bold/code/newline text without introducing empty formatting runs', () => {
    const context = createContext({ TextDecoder, TextEncoder, document: { getElementById: () => ({ addEventListener() {} }) },
      esc: (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
    new Script(aiTabJs()).runInContext(context);
    const format = context.formatAiText as (value: string) => string;
    expect(format('A **fictional** note\nwith `code` and <label>.'))
      .toBe('A <strong>fictional</strong> note\nwith <code>code</code> and &lt;label&gt;.');
  });

  it.each([false, true])('only expires the session that owns a late 401 (new generation: %s)', async changedGeneration => {
    let resolveResponse!: (response: Response) => void;
    let logouts = 0;
    const context = createContext({ TextDecoder, TextEncoder, setTimeout, clearTimeout,
      token: 'fictional-session', BASE: 'http://127.0.0.1',
      document: { getElementById: () => ({ addEventListener() {} }) },
      fetch: () => new Promise<Response>(resolve => { resolveResponse = resolve; }),
      logout: () => { logouts++; },
    });
    new Script(aiTabJs()).runInContext(context);
    const request = (context.aiRequestJSON as (path: string, options: object, controller: AbortController, token: string) => Promise<unknown>)(
      '/fictional', {}, new AbortController(), 'fictional-session');
    if (changedGeneration) context.aiSessionGeneration = 1;
    resolveResponse(new Response(JSON.stringify({ error: 'Fictional session expired' }), { status: 401 }));
    await expect(request).rejects.toThrow('Fictional session expired');
    expect(logouts).toBe(changedGeneration ? 0 : 1);
  });

  it.each([null, {}])('does not enable settings edits or save without a valid initial snapshot (%j)', async invalid => {
    const { context, element, load, save } = settingsFixture();
    let requests = 0;
    context.aiRequestJSON = async () => { requests++; return invalid; };
    await load(); await save();
    expect(requests).toBe(1);
    expect(element('aiSettingsSave').disabled).toBe(true);
    expect(element('aiLocalEndpoint').disabled).toBe(true);
    expect(element('aiSettingsStatus').textContent).toContain('Could not load settings');
  });

  it.each([
    { outcome: 'success', edited: false }, { outcome: 'failure', edited: false },
    { outcome: 'success', edited: true }, { outcome: 'failure', edited: true },
  ])('keeps saved settings/status after an older reload ($outcome; edited: $edited)', async ({ outcome, edited }) => {
    const { context, element, load, save } = settingsFixture();
    context.aiRequestJSON = async () => settingsSnapshot;
    await load();
    expect(element('aiTemperature').value).toBe('0');
    expect(element('aiSettingsSave').disabled).toBe(false);
    let resolveGet!: (value: unknown) => void;
    let rejectGet!: (error: Error) => void;
    const deferred = new Promise((resolve, reject) => { resolveGet = resolve; rejectGet = reject; });
    context.aiSettingsLoaded = false;
    context.aiRequestJSON = (_path: string, options: { method?: string }) => options.method === 'PATCH'
      ? Promise.resolve({ ...settingsSnapshot, localEndpoint: 'http://127.0.0.1:9/new' }) : deferred;
    const loading = load();
    const expectedEndpoint = edited ? 'http://127.0.0.1:9/new' : settingsSnapshot.localEndpoint;
    if (edited) { element('aiLocalEndpoint').value = expectedEndpoint; context.aiSettingsRevision++; context.aiSettingsDirty = true; }
    await save();
    expect(element('aiSettingsStatus').textContent).toBe('AI settings saved.');
    if (outcome === 'success') resolveGet({ ...settingsSnapshot, localEndpoint: 'http://127.0.0.1:9/old' });
    else rejectGet(new Error('Fictional delayed load failure'));
    await loading;
    expect(element('aiLocalEndpoint').value).toBe(expectedEndpoint);
    expect(element('aiSettingsStatus').textContent).toBe('AI settings saved.');
    expect(element('aiSettingsSave').disabled).toBe(false);
  });

  it.each(['\n', '\r\n', '\r'])('handles %j framing with every UTF8 byte in its own transport chunk', newline => {
    const { parser, events } = fixture();
    const wire = bytes(frame({ type: 'text', text: 'Fictional café 🙂' }, newline) + frame({ type: 'done' }, newline));
    for (let offset = 0; offset < wire.length; offset++) parser.push(wire.subarray(offset, offset + 1));
    parser.finish();
    expect(events).toEqual([{ type: 'text', text: 'Fictional café 🙂' }, { type: 'done' }]);
    expect(parser.isTerminal()).toBe(true);
  });

  it('accepts SSE comments/metadata and multiline JSON data without treating each line as an event', () => {
    const { parser, events } = fixture();
    parser.push(bytes(': fictional keepalive\r\nevent: message\r\nid: fixture\r\nretry: 500\r\ndata: {"type":"text",\r\ndata: "text":"Two data lines"}\r\n\r\n' + frame({ type: 'done' })));
    parser.finish();
    expect(events).toEqual([{ type: 'text', text: 'Two data lines' }, { type: 'done' }]);
  });

  it.each([
    { type: 'done', stopReason: 'end_turn' },
    { type: 'error', error: 'Fictional server error' },
    { type: 'confirmation_required', approvalId: 'fictional-approval', name: 'update_user', input: { userId: 'fictional-user', active: false }, expiresAt: 2000000000000 },
  ])('requires and recognizes the terminal $type event', event => {
    const { parser, events } = fixture();
    expect(parser.push(bytes(frame(event)))).toBe(true);
    parser.finish();
    expect(events).toEqual([event]);
  });

  it.each([
    'data: not-json\n\n', frame([]), frame({ type: 'unknown' }), frame({ type: 'text', text: 0 }),
    frame({ type: 'tool_call', name: 'fictional', input: [] }),
    frame({ type: 'confirmation_required', name: 'fictional', input: {}, expiresAt: 2000000000000 }),
    frame({ type: 'confirmation_required', approvalId: 'fixture', name: 'fictional', input: {}, expiresAt: 'later' }),
    frame({ type: 'confirmation_required', approvalId: 'fixture', name: 'fictional', input: {}, expiresAt: Number.MAX_SAFE_INTEGER }),
  ])('rejects a malformed or unsupported event instead of ignoring it', wire => {
    expect(() => fixture().parser.push(bytes(wire))).toThrow('Malformed AI stream event');
  });

  it.each(['', frame({ type: 'text', text: 'Partial fictional response' }), 'data: {"type":"done"}\n'])('rejects truncation or a missing terminal event', wire => {
    const { parser } = fixture(); parser.push(bytes(wire));
    expect(() => parser.finish()).toThrow('complete terminal event');
  });

  it('does not replace malformed or incomplete UTF8 with silently changed text', () => {
    expect(() => fixture().parser.push(new Uint8Array([0xff]))).toThrow();
    const { parser } = fixture(); parser.push(new Uint8Array([0xc3]));
    expect(() => parser.finish()).toThrow();
  });

  it('bounds a single event including an unterminated buffered record', () => {
    expect(() => fixture().parser.push(bytes(frame({ type: 'text', text: 'a'.repeat(256 * 1024) })))).toThrow('event exceeds');
    expect(() => fixture().parser.push(bytes('data: ' + 'a'.repeat(256 * 1024)))).toThrow('event exceeds');
  });

  it('bounds the entire stream even when individual records fit', () => {
    const { parser } = fixture();
    const chunk = bytes(frame({ type: 'text', text: 'a'.repeat(200000) }));
    for (let count = 0; count < 5; count++) parser.push(chunk);
    expect(() => parser.push(chunk)).toThrow('stream exceeds');
  });

  it('rejects another data event after terminal completion and rejects writes after finish', () => {
    expect(() => fixture().parser.push(bytes(frame({ type: 'done' }) + frame({ type: 'text', text: 'Late fictional data' })))).toThrow('continued after completion');
    const { parser } = fixture(); parser.push(bytes(frame({ type: 'done' }))); parser.finish();
    expect(() => parser.push(bytes(': later\n\n'))).toThrow('already closed');
  });
});
