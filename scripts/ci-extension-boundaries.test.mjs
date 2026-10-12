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

test('each boundary approval uses fresh UI feedback and awaits action completion before navigation', () => {
  const source = readFileSync(new URL('./verify-extension-boundary-suite.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const approve = async origin => {');
  const end = source.indexOf('await approve(origins[0])', start);
  const approval = source.slice(start, end);
  const freshDocument = approval.indexOf("await popup.goto(runtime.extensionOrigin + '/popup.html')");
  const openSettings = approval.indexOf("await popup.click('#settings-btn')");
  const initialSettings = approval.indexOf("'initial target settings loaded'");
  const fillTarget = approval.indexOf("await popup.fill('#settings-target-url', origin)");
  const clickApprove = approval.indexOf("await popup.click('#settings-save-url')");
  const completed = approval.indexOf("'exact app approval persisted and acknowledged'");
  assert.ok(start >= 0 && end > start && freshDocument >= 0);
  assert.ok(freshDocument < openSettings && openSettings < initialSettings && initialSettings < fillTarget);
  assert.ok(fillTarget < clickApprove && clickApprove < completed);
  assert.match(approval, /assert\.equal\(await popup\.evaluate\(\(\) => document\.querySelector\('#settings-approval-status'\)\.textContent\), ''\)/);
  assert.match(approval, /return !!data\.approvedAppsV1\?\.\[origin\]\s+&& document\.querySelector\('#settings-approval-status'\)\.textContent === chrome\.i18n\.getMessage\('appApproved'\)/);
  assert.match(source, /await approve\(origins\[0\]\);\s+await first\.goto\(origins\[0\]\)/);
  assert.match(source, /await approve\(origins\[1\]\);\s+await second\.goto\(origins\[1\]\)/);
});

test('clip delivery reapproval cannot complete from an existing stored approval alone', () => {
  const source = readFileSync(new URL('./verify-clip-delivery-suite.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function approve(popup, origin) {');
  const end = source.indexOf('async function assertCommitted', start);
  const approval = source.slice(start, end);
  const freshDocument = approval.indexOf("await popup.goto((await popup.url()).split('/popup.html')[0] + '/popup.html')");
  const openSettings = approval.indexOf("await popup.click('#settings-btn')");
  const initialSettings = approval.indexOf("'initial target settings loaded'");
  const fillTarget = approval.indexOf("await popup.fill('#settings-target-url', origin)");
  const clickApprove = approval.indexOf("await popup.click('#settings-save-url')");
  const completed = approval.indexOf("'exact loopback app approval persisted and acknowledged'");
  assert.ok(start >= 0 && end > start && freshDocument >= 0);
  assert.ok(freshDocument < openSettings && openSettings < initialSettings && initialSettings < fillTarget);
  assert.ok(fillTarget < clickApprove && clickApprove < completed);
  assert.match(approval, /assert\.equal\(await popup\.evaluate\(\(\) => document\.querySelector\('#settings-approval-status'\)\.textContent\), ''\)/);
  assert.match(approval, /return !!data\.approvedAppsV1\?\.\[origin\]\s+&& document\.querySelector\('#settings-approval-status'\)\.textContent === chrome\.i18n\.getMessage\('appApproved'\)/);
});

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
