import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { goToApp, waitForAppReady } from './fixtures';

const locale = (language: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../public/locales/${language}/${namespace}.json`, import.meta.url), 'utf8'));

/** How far a name's laid-out text sits from each edge of its own box, in CSS px (negative: it overflows that edge). */
const place = (name: Locator) => name.evaluate(element => {
  const box = element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = [...range.getClientRects()];
  return {
    fromLeft: Math.round(Math.min(...rects.map(rect => rect.left)) - box.left),
    fromRight: Math.round(box.right - Math.max(...rects.map(rect => rect.right))),
  };
});

/** The start edge of the page's direction: left in a left-to-right page, right in a right-to-left one. */
const expectAtPageStart = (at: { fromLeft: number; fromRight: number }, language: string, label: string) =>
  expect(language === 'ar' ? at.fromRight : at.fromLeft, label).toBeLessThanOrEqual(1);

async function reloadIn(page: Page, language: string, values: Record<string, unknown> = {}) {
  await page.evaluate(({ language, values }) => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false, ...values }));
  }, { language, values });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await waitForAppReady(page);
}

const LONG_LATIN = 'Fictional analysis name that is deliberately far too long to fit beside its controls';
const LONG_HOST = `${LONG_LATIN}, repeated so that it overflows even the wide Settings dialog: ${LONG_LATIN}`;
const HOSTS = [
  { id: 'arabic', name: 'arabic', displayName: 'مضيف التحليل', url: 'https://arabic.example.invalid/api', enabled: true, skills: [] },
  { id: 'latin', name: 'latin', displayName: 'Fictional SOC host', url: 'https://latin.example.invalid/api', enabled: true, skills: [] },
  { id: 'long', name: 'long', displayName: LONG_HOST, url: 'https://long.example.invalid/api', enabled: true, skills: [] },
];

/** A long Latin name overflows its box at its own end, the right, so its first letters stay in view. */
const expectCutAtItsEnd = (at: { fromLeft: number; fromRight: number }, label: string) => {
  expect(at.fromRight, `${label} overflows`).toBeLessThan(-1);
  expect(at.fromLeft, `${label} keeps its start`).toBeGreaterThanOrEqual(-1);
};

// Each name takes its own direction, so a long Latin name is cut at its own end in a right-to-left page,
// and sits at the start of its row in the page's direction, whatever its script.
for (const language of ['en', 'ar']) {
  test(`${language}: agent host names start at the page's start edge and keep their first letters`, async ({ page }) => {
    await goToApp(page);
    await reloadIn(page, language, { agentHosts: HOSTS });
    await page.getByRole('button', { name: locale(language, 'common')['sidebar.settings'], exact: true }).first().click();
    await page.getByRole('tab', { name: locale(language, 'settings')['tabs.ai'], exact: true }).click();
    for (const host of HOSTS.slice(0, 2)) {
      const name = page.getByText(host.displayName, { exact: true });
      await name.scrollIntoViewIfNeeded();
      expectAtPageStart(await place(name), language, host.id);
    }
    expectCutAtItsEnd(await place(page.getByText(LONG_HOST, { exact: true })), 'long host name');
  });
}

test('ar: the sidebar card keeps a long Latin investigation name\'s first letters and aligns a short one to the start', async ({ page }) => {
  await goToApp(page);
  await page.evaluate(names => new Promise<void>((resolve, reject) => {
    const now = Date.now();
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('folders', 'readwrite');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      names.forEach((name, order) => transaction.objectStore('folders').put({
        id: `direction-${order}`, name, order, status: 'active', clsLevel: 'TLP:CLEAR', createdAt: now, updatedAt: now,
      }));
    };
  }), [LONG_LATIN, 'Fictional case']);
  const card = page.getByTitle(locale('ar', 'common')['sidebar.investigationSettings'], { exact: true });
  for (const [order, name] of [LONG_LATIN, 'Fictional case'].entries()) {
    await page.evaluate(id => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'notes', selectedFolderId: id })), `direction-${order}`);
    await reloadIn(page, 'ar');
    const at = await place(card.getByText(name, { exact: true }));
    if (name === LONG_LATIN) expectCutAtItsEnd(at, 'long investigation name');
    else expectAtPageStart(at, 'ar', 'short name');
  }
});
