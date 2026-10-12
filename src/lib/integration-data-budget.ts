/** Cumulative derived-data limits: overwriting a variable does not reset its allocation budget. */
export const MAX_INTEGRATION_DERIVED_BYTES = 8 * 1024 * 1024;
export const MAX_INTEGRATION_DATA_NODES = 50_000;
const MAX_DEPTH = 24;
const FAILURE = 'Integration exceeded its derived-data size or complexity budget';

/** Count UTF-8 without first allocating an encoded copy; JSON strings include escaping and quotes. */
function textBytes(text: string, json: boolean, maximum: number): number {
  let bytes = json ? 2 : 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (json && (code === 34 || code === 92)) bytes += 2;
    else if (json && code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += json ? 6 : 3;
    else bytes += 3;
    if (bytes > maximum) return bytes;
  }
  return bytes;
}

export class IntegrationDataBudget {
  exceeded = false;
  private bytes = 0;
  private nodes = 0;
  private readonly limitBytes: number;
  private readonly maxNodes: number;

  constructor(limitBytes = MAX_INTEGRATION_DERIVED_BYTES, maxNodes = MAX_INTEGRATION_DATA_NODES) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > MAX_INTEGRATION_DERIVED_BYTES
      || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_INTEGRATION_DATA_NODES) {
      throw new Error('Integration derived-data limits may only lower the supported limits');
    }
    this.limitBytes = limitBytes;
    this.maxNodes = maxNodes;
  }

  private fail(): never { this.exceeded = true; throw new Error(FAILURE); }
  private consume(bytes: number, nodes = 0): void {
    if (this.exceeded || this.bytes + bytes > this.limitBytes || this.nodes + nodes > this.maxNodes) this.fail();
    this.bytes += bytes; this.nodes += nodes;
  }
  private text(text: string, json = false): void {
    this.consume(textBytes(text, json, this.limitBytes - this.bytes), 1);
  }
  chargeText(text: string): void { this.text(text); }

  /** Measure the serialized representation first. No getters, toJSON, or user coercion runs. */
  chargeJSON(value: unknown): void {
    type Task = { value: unknown; depth: number; arrayItem?: boolean } | { leave: object };
    const pending: Task[] = [{ value, depth: 0 }];
    const ancestors = new Set<object>();
    while (pending.length) {
      const task = pending.pop();
      if (!task) break;
      if ('leave' in task) { ancestors.delete(task.leave); continue; }
      this.consume(0, 1);
      if (task.depth > MAX_DEPTH) this.fail();
      const item = task.value;
      if (typeof item === 'string') { this.consume(textBytes(item, true, this.limitBytes - this.bytes)); continue; }
      if (item === null || (item === undefined && task.arrayItem)) { this.consume(4); continue; }
      if (item === undefined) continue;
      if (typeof item === 'boolean') { this.consume(item ? 4 : 5); continue; }
      if (typeof item === 'number') { this.consume(Number.isFinite(item) ? String(item).length : 4); continue; }
      if (typeof item !== 'object') this.fail();
      if (ancestors.has(item)) this.fail();
      const array = Array.isArray(item);
      if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) this.fail();
      ancestors.add(item); pending.push({ leave: item });
      this.consume(2);
      if (array) {
        if (item.length > this.maxNodes - this.nodes) this.fail();
        if (item.length) this.consume(item.length - 1);
        for (let i = item.length - 1; i >= 0; i--) {
          const descriptor = Object.getOwnPropertyDescriptor(item, i);
          if (descriptor && !('value' in descriptor)) this.fail();
          pending.push({ value: descriptor?.value, depth: task.depth + 1, arrayItem: true });
        }
      } else {
        const keys = Object.keys(item);
        if (keys.length > this.maxNodes - this.nodes) this.fail();
        let included = 0;
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !('value' in descriptor)) this.fail();
          if (descriptor.value === undefined) continue;
          if (included++) this.consume(1);
          this.consume(textBytes(key, true, this.limitBytes - this.bytes) + 1);
          pending.push({ value: descriptor.value, depth: task.depth + 1 });
        }
      }
    }
  }

  stringify(value: unknown): string {
    this.chargeJSON(value);
    return JSON.stringify(value) ?? '';
  }

  /** Charge each fragment before constructing the final expanded string. */
  interpolate(template: string, resolve: (path: string) => unknown): string {
    const pieces: string[] = [];
    let end = 0;
    for (const match of template.matchAll(/\{\{([^}]+)\}\}/g)) {
      const literal = template.slice(end, match.index);
      this.chargeText(literal); pieces.push(literal);
      const value = resolve(match[1]);
      let text: string;
      if (value === undefined || value === null) text = '';
      else if (typeof value === 'object') text = this.stringify(value);
      else if (['string', 'number', 'boolean'].includes(typeof value)) { text = String(value); this.chargeText(text); }
      else this.fail();
      pieces.push(text);
      end = match.index + match[0].length;
    }
    const tail = template.slice(end);
    this.chargeText(tail); pieces.push(tail);
    return pieces.join('');
  }

  /** Array.join-compatible JSON values, built without recursively coercing unbounded arrays. */
  join(values: readonly unknown[], separator: string): string {
    type Task = { value: unknown; depth: number } | { text: string } | { leave: object };
    const pending: Task[] = [];
    const ancestors = new Set<object>();
    const pieces: string[] = [];
    const schedule = (items: readonly unknown[], delimiter: string, depth: number) => {
      if (ancestors.has(items) || depth > MAX_DEPTH || items.length > this.maxNodes - this.nodes) this.fail();
      ancestors.add(items); pending.push({ leave: items });
      for (let i = items.length - 1; i >= 0; i--) {
        const descriptor = Object.getOwnPropertyDescriptor(items, i);
        if (descriptor && !('value' in descriptor)) this.fail();
        pending.push({ value: descriptor?.value, depth });
        if (i) pending.push({ text: delimiter });
      }
    };
    schedule(values, separator, 0);
    while (pending.length) {
      const task = pending.pop();
      if (!task) break;
      if ('leave' in task) { ancestors.delete(task.leave); continue; }
      if ('text' in task) { this.chargeText(task.text); pieces.push(task.text); continue; }
      const item = task.value;
      this.consume(0, 1);
      if (Array.isArray(item)) { schedule(item, ',', task.depth + 1); continue; }
      let text: string;
      if (item === null || item === undefined) text = '';
      else if (typeof item === 'object') {
        if (Object.getPrototypeOf(item) !== Object.prototype || Object.hasOwn(item, 'toString') || Object.hasOwn(item, Symbol.toPrimitive)) this.fail();
        text = '[object Object]';
      } else if (['string', 'number', 'boolean'].includes(typeof item)) text = String(item);
      else this.fail();
      this.consume(textBytes(text, false, this.limitBytes - this.bytes)); pieces.push(text);
    }
    return pieces.join('');
  }
}
