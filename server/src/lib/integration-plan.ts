/** Pure validation/graph compilation. Kept identical in the client and server. */
export const INTEGRATION_LIMITS = Object.freeze({
  steps: 256, depth: 8, visits: 10_000, iterations: 1_000, logs: 500,
  templateBytes: 4 * 1024 * 1024, dataNodes: 50_000,
});
type Row = Record<string, unknown>;
export interface IntegrationPlan {
  template: Row;
  roots: string[];
  byId: Map<string, Row>;
}
function fail(path: string): never { throw new Error('Invalid integration template: ' + path); }
function object(value: unknown, path: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path + ' must be an object');
  return value as Row;
}
function string(value: unknown, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(path + ' must be a string');
}
function list(value: unknown, path: string, max = 256): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path + ' must be a bounded array');
  return value;
}
function strings(value: unknown, path: string): string[] {
  const values = list(value, path);
  values.forEach(item => string(item, path));
  return values as string[];
}
function choice(value: unknown, values: readonly string[], path: string): void {
  if (typeof value !== 'string' || !values.includes(value)) fail(path + ' is unsupported');
}
function integer(value: unknown, min: number, max: number, path: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path + ' is outside its supported range');
}
function textMap(value: unknown, path: string): void {
  for (const item of Object.values(object(value, path))) string(item, path, true);
}
function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') fail(path + ' must be boolean');
}
function boundedJSON(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let size = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    if (++nodes > INTEGRATION_LIMITS.dataNodes || entry.depth > 24) fail('data exceeds size/depth limit');
    const item = entry.value;
    if (item && typeof item === 'object') {
      if (seen.has(item)) fail('data must not contain cycles or shared objects');
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        size += key.length;
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    } else if (typeof item === 'string') size += item.length * 3;
    else if (item !== null && item !== undefined && typeof item !== 'boolean' && (typeof item !== 'number' || !Number.isFinite(item))) fail('data must be JSON-compatible');
    if (size > INTEGRATION_LIMITS.templateBytes) fail('data exceeds size limit');
  }
}
/** Validate before storage or execution. Does not fetch, normalize or mutate input. */
export function compileIntegrationPlan(value: unknown): IntegrationPlan {
  boundedJSON(value);
  const template = object(structuredClone(value), 'template');
  for (const key of ['id', 'name', 'version']) string(template[key], key);
  if (template.schemaVersion !== '1.0') fail('schemaVersion is unsupported');
  for (const key of ['description', 'author', 'icon', 'color']) string(template[key], key, true);
  choice(template.category, ['enrichment', 'threat-feed', 'siem-soar', 'notification', 'export', 'pipeline', 'utility'], 'category');
  choice(template.source, ['builtin', 'user', 'team', 'community'], 'source');
  strings(template.tags, 'tags');
  const domains = strings(template.requiredDomains, 'requiredDomains');
  for (const domain of domains) {
    if (domain.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain) || domain.includes('..')) fail('requiredDomains must contain bare hostnames');
  }
  const triggers = list(template.triggers, 'triggers');
  if (!triggers.length) fail('triggers must not be empty');
  for (const item of triggers) {
    const trigger = object(item, 'trigger');
    choice(trigger.type, ['manual', 'on-entity-create', 'on-entity-update', 'scheduled', 'webhook'], 'trigger.type');
    if (trigger.iocTypes !== undefined) strings(trigger.iocTypes, 'trigger.iocTypes');
    if (trigger.entityTables !== undefined) strings(trigger.entityTables, 'trigger.entityTables');
    if (trigger.schedule !== undefined) string(trigger.schedule, 'trigger.schedule');
  }
  const configKeys = new Set<string>();
  for (const item of list(template.configSchema, 'configSchema')) {
    const field = object(item, 'config field');
    string(field.key, 'config field.key');
    string(field.label, 'config field.label', true);
    if (configKeys.has(field.key)) fail('duplicate config key');
    configKeys.add(field.key);
    choice(field.type, ['string', 'password', 'number', 'boolean', 'select', 'multi-select'], 'config field.type');
    if (typeof field.required !== 'boolean') fail('config field.required must be boolean');
    optionalBoolean(field.secret, 'config field.secret');
    if (field.options !== undefined) {
      const options = list(field.options, 'config field.options');
      const keys = new Set<string>();
      for (const raw of options) {
        const option = object(raw, 'config option');
        string(option.label, 'config option.label', true);
        string(option.value, 'config option.value');
        if (keys.has(option.value)) fail('duplicate config option');
        keys.add(option.value);
      }
    }
  }
  const byId = new Map<string, Row>();
  const children = new Map<string, string[]>();
  const referenced = new Set<string>();
  for (const raw of list(template.steps, 'steps', INTEGRATION_LIMITS.steps)) {
    const step = object(raw, 'step');
    string(step.id, 'step.id'); string(step.label, 'step.label', true);
    if (byId.has(step.id)) fail('duplicate step id');
    byId.set(step.id, step);
    optionalBoolean(step.continueOnError, 'step.continueOnError');
    if (step.condition !== undefined) string(step.condition, 'step.condition');
    let refs: string[] = [];
    switch (step.type) {
      case 'http':
        choice(step.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 'http.method');
        string(step.url, 'http.url');
        if (!domains.length) fail('HTTP steps must declare requiredDomains');
        if (step.headers !== undefined) textMap(step.headers, 'http.headers');
        if (step.queryParams !== undefined) textMap(step.queryParams, 'http.queryParams');
        if (step.contentType !== undefined) choice(step.contentType, ['json', 'form', 'text'], 'http.contentType');
        if (step.responseType !== undefined) choice(step.responseType, ['json', 'text'], 'http.responseType');
        if (step.timeout !== undefined) integer(step.timeout, 1, 300_000, 'http.timeout');
        if (step.retry !== undefined) {
          const retry = object(step.retry, 'http.retry');
          integer(retry.maxRetries, 0, 10, 'http.retry.maxRetries');
          integer(retry.backoffMs, 0, 60_000, 'http.retry.backoffMs');
          list(retry.retryOn, 'http.retry.retryOn').forEach(code => integer(code, 100, 599, 'retry status'));
        }
        // This field has never been implemented by either executor.
        if (step.pagination !== undefined) fail('HTTP pagination is unavailable; remove it before running');
        break;
      case 'transform':
        string(step.input, 'transform.input', true);
        for (const rawOp of list(step.operations, 'transform.operations')) {
          const op = object(rawOp, 'transform operation'); string(op.as, 'transform.as');
          choice(op.op, ['extract', 'map', 'filter', 'flatten', 'join', 'template', 'lookup'], 'transform.op');
          if (op.op !== 'template') string(op.path, 'transform.path', true);
          if (op.op === 'map') textMap(op.template, 'transform.map.template');
          if (op.op === 'filter') string(op.condition, 'transform.filter.condition');
          if (op.op === 'join') string(op.separator, 'transform.separator', true);
          if (op.op === 'template') string(op.template, 'transform.template', true);
          if (op.op === 'lookup') {
            textMap(op.map, 'transform.lookup.map');
            if (op.default !== undefined) string(op.default, 'transform.lookup.default', true);
          }
        }
        break;
      case 'condition':
        string(step.expression, 'condition.expression');
        refs = [...strings(step.thenSteps, 'condition.thenSteps'), ...strings(step.elseSteps ?? [], 'condition.elseSteps')];
        break;
      case 'loop':
        string(step.items, 'loop.items'); string(step.itemVariable, 'loop.itemVariable');
        if (step.indexVariable !== undefined) {
          string(step.indexVariable, 'loop.indexVariable');
          if (step.indexVariable === step.itemVariable) fail('loop variables must be distinct');
        }
        refs = strings(step.bodySteps, 'loop.bodySteps');
        if (step.maxIterations !== undefined) integer(step.maxIterations, 0, INTEGRATION_LIMITS.iterations, 'loop.maxIterations');
        if (step.delayMs !== undefined) integer(step.delayMs, 0, 60_000, 'loop.delayMs');
        break;
      case 'create-entity': case 'update-entity':
        choice(step.entityType, ['ioc', 'note', 'task', 'timeline-event'], 'entityType');
        object(step.fields, 'entity fields');
        if (step.type === 'update-entity') string(step.entityId, 'entityId');
        break;
      case 'delay': integer(step.ms, 0, 2_147_483_647, 'delay.ms'); break;
      case 'set-variable': textMap(step.variables, 'set-variable.variables'); break;
      default: fail('step.type is unsupported');
    }
    children.set(step.id, refs);
    refs.forEach(id => referenced.add(id));
  }
  for (const id of referenced) if (!byId.has(id)) fail('step reference does not exist');
  // Memoized depth calculation avoids exponential traversal of shared subgraphs.
  const depths = new Map<string, number>();
  const active = new Set<string>();
  function depth(id: string): number {
    if (active.has(id)) fail('step graph contains a cycle');
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    active.add(id);
    if (active.size > INTEGRATION_LIMITS.depth) fail('step nesting exceeds limit');
    let result = 1;
    for (const child of children.get(id) ?? []) result = Math.max(result, 1 + depth(child));
    active.delete(id);
    if (result > INTEGRATION_LIMITS.depth) fail('step nesting exceeds limit');
    depths.set(id, result); return result;
  }
  // All components must be valid, including components without a root.
  for (const id of byId.keys()) depth(id);
  for (const raw of list(template.outputs, 'outputs')) {
    const output = object(raw, 'output');
    choice(output.type, ['create-ioc', 'update-ioc', 'create-note', 'create-task', 'create-timeline-event', 'notify', 'display'], 'output.type');
    object(output.template, 'output.template');
    if (output.condition !== undefined) string(output.condition, 'output.condition');
  }
  return { template, byId, roots: [...byId.keys()].filter(id => !referenced.has(id)) };
}
