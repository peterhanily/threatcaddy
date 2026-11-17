import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const libDir = join(root, 'src/lib');
const serverIndex = readFileSync(join(root, 'server/src/index.ts'), 'utf8');

/** Paths the server mounts: `app.route(prefix, router)` and direct `app.get/post(...)` handlers. */
const routers = [...serverIndex.matchAll(/\bapp\.route\(\s*'(\/api\/[^']+)'/g)].map(match => match[1]);
const handlers = [...serverIndex.matchAll(/\bapp\.(?:get|post|put|patch|delete|all)\(\s*'(\/api\/[^']+)'/g)].map(match => match[1]);

/** String literals that start with '/api/', or with one `${serverUrl}` and then '/api/'. Absolute URLs and
 *  prose that merely mentions a path are not request paths. */
function apiLiterals(): Array<{ file: string; path: string }> {
  const files = readdirSync(libDir, { recursive: true, encoding: 'utf8' }).filter(name => /\.tsx?$/.test(name));
  return files.flatMap(file => {
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      let text: string | undefined;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) text = node.head.text || node.templateSpans[0].literal.text;
      if (text?.startsWith('/api/')) found.push(text.split(/[?#\s]/)[0]);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, readFileSync(join(libDir, file), 'utf8'), ts.ScriptTarget.Latest, true));
    return found.map(path => ({ file, path }));
  });
}

const mounted = (path: string) => handlers.includes(path)
  || routers.some(prefix => path === prefix || path.startsWith(prefix + '/'));

describe('client API routes', () => {
  it('reads the server mounts and the client literals it checks', () => {
    expect(routers).toEqual(expect.arrayContaining(['/api/auth', '/api/sync', '/api/integrations']));
    expect(apiLiterals().map(literal => literal.path)).toEqual(expect.arrayContaining(['/api/auth/me', '/api/llm/chat', '/api/files/']));
  });

  it('maps every /api literal under src/lib to a router mounted by the server', () => {
    expect(apiLiterals().filter(literal => !mounted(literal.path))).toEqual([]);
  });
});
