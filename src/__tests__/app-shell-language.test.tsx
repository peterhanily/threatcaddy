/** The whole App in German: the phone Analyst Mode banner and the screenshare-hidden view use the analyst's language. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, getConfig, render, screen } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import i18n from '../i18n';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import deCommon from '../../public/locales/de/common.json';
import deExec from '../../public/locales/de/exec.json';

const de = { common: deCommon as Record<string, string>, exec: deExec as Record<string, string> };

// A cold render of the App and its lazy chunks can exceed the default timeouts under a loaded suite.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

const stubWidth = (phone: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: phone && query === '(max-width: 767px)', media: query, onchange: null, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await Promise.all(db.tables.map(table => table.clear()));
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  i18n.addResourceBundle('de', 'exec', deExec, true, true);
  localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ language: 'de' }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('app shell text', () => {
  it('shows the phone Analyst Mode banner in the analyst\'s language', async () => {
    expect(de.exec['dashboard.analystModeBanner']).toBeTruthy();
    stubWidth(true);
    sessionStorage.setItem('tc-analyst-mode', '1');
    render(<App />);
    expect(await screen.findByText(de.exec['dashboard.analystModeBanner'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.exec['dashboard.backToExecView'] })).toBeInTheDocument();
    expect(screen.queryByText('Analyst Mode — optimized for desktop')).toBeNull();
  }, 30_000);

  it('says a view is hidden while screensharing, and offers the way back, in the analyst\'s language', async () => {
    expect(de.common['screenshare.browseVisible']).toBeTruthy();
    expect(de.common['screenshare.viewHidden']).toBeTruthy();
    stubWidth(false);
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Toggle screenshare mode' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Show up to TLP:CLEAR' }));
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${de.common['sidebar.settings']}`) }))[0]);
    const back = await screen.findByRole('button', { name: de.common['screenshare.browseVisible'] });
    expect(screen.getByText(de.common['screenshare.viewHidden'])).toBeInTheDocument();
    expect(screen.queryByText('This view is hidden while screensharing.')).toBeNull();
    expect(screen.queryByText('Browse visible investigations')).toBeNull();
    fireEvent.click(back);
    expect(screen.queryByRole('button', { name: de.common['screenshare.browseVisible'] })).toBeNull();
  }, 30_000);
});
