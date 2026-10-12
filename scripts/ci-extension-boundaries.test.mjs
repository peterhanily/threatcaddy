// Static harness contracts complement, and do not replace, installed-browser acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

for (const browser of ['chrome', 'firefox']) {
  test(`${browser} boundary acceptance uses the shared isolated runtime`, () => {
    const source = readFileSync(new URL(`./verify-extension-${browser}.mjs`, import.meta.url), 'utf8');
    assert.match(source, /import \{ withClipRuntime \} from '\.\/verify-clip-delivery-runtime\.mjs'/);
    assert.match(source, /import \{ verifyExtensionBoundaries \} from '\.\/verify-extension-boundary-suite\.mjs'/);
    assert.ok(source.includes(`withClipRuntime('${browser}', context => verifyExtensionBoundaries(context, '${browser}'))`));
    assert.doesNotMatch(source, /launchPersistentContext|spawn\(|webextOptionalPermissionPrompts/);
  });
}

test('boundary suite uses explicit revocation confirmation and preserves notification assertions', () => {
  const source = readFileSync(new URL('./verify-extension-boundary-suite.mjs', import.meta.url), 'utf8');
  assert.match(source, /await popup\.click\('#modal-cancel'\)/);
  assert.match(source, /await popup\.click\('#modal-confirm'\)/);
  const cancellation = source.slice(source.indexOf("await popup.click('#modal-cancel')"), source.indexOf("await popup.click('#modal-confirm')"));
  assert.match(cancellation, /Object\.keys\(data\.approvedAppsV1 \|\| \{\}\)\.sort\(\)/);
  assert.match(cancellation, /await first\.goto\(origins\[0\]\)/);
  assert.match(cancellation, /await second\.goto\(origins\[1\]\)/);
  assert.match(cancellation, /cancelled revocation preserves approvals on fresh documents/);
  assert.match(source, /assert\.equal\(denied\.accepted, false\)/);
  assert.match(source, /if \(browserName === 'firefox'\)/);
  assert.match(source, /assert\.equal\(granted\.accepted, true\)/);
  assert.match(source, /check\('Firefox granted notification API acknowledges acceptance; native prompt and OS delivery are not asserted'\)/);
  assert.match(source, /server\.listen\(0, '127\.0\.0\.1', resolve\)/);
  assert.match(source, /throwIfFailed\(operationFailure, cleanupErrors/);
});
