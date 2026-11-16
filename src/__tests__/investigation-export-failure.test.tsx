import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, render, screen, within } from '@testing-library/react';
import App from '../App';
import { db } from '../db';

const mocked = vi.hoisted(() => ({ exportInvestigationJSON: vi.fn() }));
vi.mock('../lib/export', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/export')>(), exportInvestigationJSON: mocked.exportInvestigationJSON }));

// The whole App, so the toast is the one Export Investigation really shows.
// A cold render of it and its lazy chunks can exceed the default timeouts under a loaded suite.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

beforeEach(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {},
    removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add({ id: 'case', name: 'Real case', order: 0, status: 'active', createdAt: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Export Investigation', () => {
  it('names the record that stopped the export, like Save Backup', async () => {
    const reason = 'Invalid backup field standaloneIOCs.confidence in record standaloneIOCs:i1; no data was changed.';
    mocked.exportInvestigationJSON.mockRejectedValue(new Error(reason));
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Investigations/ }))[0]);
    const card = await screen.findByRole('group', { name: 'Real case' });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Export Investigation' }));
    expect(await screen.findByText(`Failed to export investigation: ${reason}`)).toBeInTheDocument();
    expect(mocked.exportInvestigationJSON).toHaveBeenCalledWith('case');
  }, 30_000);
});
