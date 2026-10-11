import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseEnv } from 'node:util';
import { load } from 'js-yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const api = load(read('docs/api-reference.yml'));
const schemas = api.components.schemas;
const resolve = reference => {
  assert.ok(reference.startsWith('#/'), `Unexpected external schema reference: ${reference}`);
  return reference.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], api);
};
const parameters = operation => (operation.parameters ?? []).map(value => value.$ref ? resolve(value.$ref) : value);

test('OpenAPI local references resolve without duplicate YAML keys', () => {
  assert.equal(api.openapi, '3.1.0');
  const pending = [api];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if ('$ref' in value) assert.ok(resolve(value.$ref), `Unresolved reference: ${value.$ref}`);
    pending.push(...Object.values(value));
  }
});

test('documented push table, identity, version and batch bounds match the route schema', () => {
  const route = read('server/src/routes/sync.ts');
  const tableEnum = route.match(/table: z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(tableEnum, 'Sync route table enum changed; review the public schema');
  const tables = [...tableEnum[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(schemas.SyncChange.properties.table.enum, tables);
  assert.deepEqual(schemas.SyncChange.properties.op.enum, ['put', 'delete']);
  const identity = route.match(/entityId: z\.string\(\)\.min\((\d+)\)\.max\((\d+)\)/);
  assert.ok(identity);
  assert.equal(schemas.SyncChange.properties.entityId.minLength, Number(identity[1]));
  assert.equal(schemas.SyncChange.properties.entityId.maxLength, Number(identity[2]));
  const version = route.match(/clientVersion: z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)/);
  assert.ok(version);
  assert.equal(schemas.SyncChange.properties.clientVersion.minimum, Number(version[1]));
  assert.equal(schemas.SyncChange.properties.clientVersion.maximum, Number(version[2]));
  const push = api.paths['/api/sync/push'].post;
  const request = push.requestBody.content['application/json'].schema;
  assert.deepEqual(request.required, ['generation', 'changes']);
  assert.equal(request.properties.generation.format, 'uuid');
  assert.equal(request.properties.changes.maxItems, Number(route.match(/changes: z\.array\(changeSchema\)\.max\((\d+)\)/)?.[1]));
  assert.deepEqual(schemas.SyncChange.allOf[0].then.required, ['data']);
  assert.equal(schemas.SyncChange.allOf[0].if.properties.op.const, 'put');
});

test('cursor pull documents paged and legacy responses without treating cursors as numbers', () => {
  const pull = api.paths['/api/sync/pull'].get;
  const params = Object.fromEntries(parameters(pull).map(parameter => [parameter.name, parameter]));
  assert.equal(params.cursor.schema.type, 'string');
  const cursor = new RegExp(params.cursor.schema.pattern);
  assert.ok(cursor.test('0') && cursor.test('9007199254740993'));
  assert.ok(!cursor.test('01') && !cursor.test('-1') && !cursor.test('1.5'));
  assert.equal(params.generation.schema.format, 'uuid');
  assert.deepEqual(params.limit.schema, { type: 'integer', minimum: 1, maximum: 1000, default: 200 });
  assert.equal(params.since.deprecated, true);
  assert.deepEqual(pull.responses['200'].content['application/json'].schema.oneOf.map(value => value.$ref), [
    '#/components/schemas/SyncPullPage', '#/components/schemas/LegacySyncPull',
  ]);
  assert.deepEqual(schemas.SyncPullPage.required, ['changes', 'cursor', 'generation', 'hasMore', 'serverTimestamp']);
  assert.deepEqual(schemas.LegacySyncPull.not.required, ['cursor']);
  assert.deepEqual(schemas.SyncRemoteChange.required, ['table', 'op', 'id']);
  assert.equal(schemas.SyncRemoteChange.properties.data, undefined);
  assert.equal(resolve(pull.responses['409'].$ref).content['application/json'].schema.properties.resetRequired.const, true);
});

test('reply paging and reaction summaries remain optional backward-compatible projections', () => {
  const detail = parameters(api.paths['/api/caddyshack/posts/{id}'].get);
  const paging = detail.find(parameter => parameter.name === 'replies');
  assert.deepEqual(paging.schema.enum, ['page']);
  assert.notEqual(paging.required, true);
  assert.equal(detail.find(parameter => parameter.name === 'limit').schema.default, 50);
  assert.equal(detail.find(parameter => parameter.name === 'cursor').schema.maxLength, 1024);
  for (const path of ['/api/caddyshack', '/api/caddyshack/posts/{id}']) {
    const projection = parameters(api.paths[path].get).find(parameter => parameter.name === 'reactions');
    assert.deepEqual(projection.schema.enum, ['summary']);
    assert.notEqual(projection.required, true);
    assert.equal(projection.schema.default, undefined);
  }
  assert.ok(!schemas.Post.required.includes('replyPage'));
  const reactions = schemas.Post.properties.reactions.additionalProperties;
  assert.deepEqual(reactions.required, ['count', 'userIds']);
  assert.deepEqual(reactions.properties.userIdsScope.enum, ['viewer']);
  assert.deepEqual(schemas.ReplyPage.properties.nextCursor.type, ['string', 'null']);
  const sourceLimit = read('server/src/services/feed-read.ts').match(/REPLY_PAGE_LIMIT = (\d+)/);
  assert.ok(sourceLimit);
  assert.equal(schemas.ReplyPage.properties.limit.maximum, Number(sourceLimit[1]));
});

test('root Compose template has blank secrets and exact-origin placeholder, not a second database URL', () => {
  const environment = parseEnv(read('.env.example'));
  for (const key of ['POSTGRES_PASSWORD', 'BOT_MASTER_KEY', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'ADMIN_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY']) {
    assert.equal(environment[key], '', `${key} must be a blank placeholder`);
  }
  const origin = new URL(environment.ALLOWED_ORIGINS);
  assert.equal(origin.origin, environment.ALLOWED_ORIGINS);
  assert.equal(origin.protocol, 'https:');
  assert.ok(origin.hostname.endsWith('.example'));
  assert.equal(environment.DATABASE_URL, undefined);
  const compose = load(read('docker-compose.yml'));
  for (const key of ['BOT_MASTER_KEY', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'ALLOWED_ORIGINS']) {
    assert.ok(compose.services.server.environment[key].includes('${' + key));
  }
  assert.ok(compose.services.server.environment.DATABASE_URL.includes('${POSTGRES_PASSWORD'));
  assert.ok(compose.services.db.environment.POSTGRES_PASSWORD.includes('${POSTGRES_PASSWORD'));
});

test('README setup uses the recorded runtime and root Compose directory', () => {
  const readme = read('README.md');
  assert.ok(readme.includes(read('.node-version').trim()));
  assert.ok(readme.includes(JSON.parse(read('package.json')).packageManager.split('@')[1]));
  const blocks = [...readme.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map(match => match[1]);
  const compose = blocks.filter(block => block.includes('docker compose'));
  assert.equal(compose.length, 2);
  for (const block of compose) {
    assert.match(block, /cp \.env\.example \.env/);
    assert.doesNotMatch(block, /cd server/);
  }
  assert.match(readme, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
  assert.match(readme, /\[SECURITY\.md\]\(SECURITY\.md\)/);
});
