/** After a hosted update the new service worker removes the old build's chunks, and a view this tab had not
 * loaded yet fails to import. The error boundary catches that failure, so public/chunk-reload-guard.js never
 * sees it; the boundary reloads the page once per session itself and shares the guard's claim. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy, Suspense } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../components/Common/ErrorBoundary';

const GUARD_KEY = 'tc_chunk_reload';
const guardSource = readFileSync(resolve(__dirname, '../../public/chunk-reload-guard.js'), 'utf8');
const guardPatterns = [...guardSource.matchAll(/msg\.indexOf\('([^']+)'\)/g)].map(match => match[1]);
const CHROMIUM = 'Failed to fetch dynamically imported module: http://localhost/assets/GraphCanvas-D3HnSMYJ.js';

const originalLocation = window.location;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, href: 'https://threatcaddy.example/app/?view=graph#notes', replace },
    writable: true, configurable: true,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  document.querySelectorAll('script[data-test-build]').forEach(script => script.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The page's hashed entry script, as a hosted build's index.html loads it. */
function loadBuild(entry: string) {
  document.querySelectorAll('script[data-test-build]').forEach(script => script.remove());
  const script = document.createElement('script');
  script.type = 'module';
  script.setAttribute('src', entry);
  script.dataset.testBuild = '';
  document.head.appendChild(script);
}

/** A lazily loaded view whose chunk import rejects, as React.lazy sees it after the update. */
function renderView(error: unknown) {
  const View = lazy(() => Promise.reject(error));
  return render(<ErrorBoundary region="main-content"><Suspense fallback={null}><View /></Suspense></ErrorBoundary>);
}

/** Runs the hosted guard script as index.html does, with its own window listeners. */
function bootGuard() {
  const events = new EventTarget();
  new Function('window', guardSource)({ addEventListener: events.addEventListener.bind(events) });
  return events;
}

describe('ErrorBoundary: a view whose chunk the update removed', () => {
  it('reloads the page once with a cache-busting address instead of showing the error', async () => {
    renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    const target = new URL(replace.mock.calls[0][0] as string);
    expect(target.origin + target.pathname).toBe('https://threatcaddy.example/app/');
    expect(target.searchParams.get('view')).toBe('graph');
    expect(target.searchParams.get('_r')).toMatch(/^\d+$/);
    expect(target.hash).toBe('#notes');
    expect(sessionStorage.getItem(GUARD_KEY)).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('shows the error panel when the view fails again after that reload', async () => {
    const first = renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    first.unmount();
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(CHROMIUM)).toBeInTheDocument();
    expect(replace).toHaveBeenCalledOnce();
  });

  it.each([
    ['WebKit', new TypeError('Importing a module script failed.')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://threatcaddy.example/assets/Timeline-x.js')],
    ['a module served as HTML', new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".')],
  ])('recognises the %s message', async (_engine, error) => {
    renderView(error);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
  });

  it('recognises every message the stale-deploy guard recognises', async () => {
    expect(guardPatterns.length).toBeGreaterThanOrEqual(7);
    for (const pattern of guardPatterns) {
      sessionStorage.clear();
      replace.mockClear();
      const view = renderView(new Error(`prefix ${pattern} suffix`));
      await waitFor(() => expect(replace, pattern).toHaveBeenCalledOnce());
      view.unmount();
    }
  });

  it('shows other errors at once and never reloads for them', async () => {
    renderView(new Error('Cannot read properties of undefined'));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GUARD_KEY)).toBeNull();
  });

  it('does not reload again when the stale-deploy guard already reloaded this session', async () => {
    sessionStorage.setItem(GUARD_KEY, '1');
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the panel and does not reload when this browser blocks session storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('never reloads twice in a session, even after the guard has finished its boot check', async () => {
    // The guard must name this build exactly as the boundary's claim does.
    loadBuild('./assets/index-2Hq1aB3c.js');
    const first = renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    first.unmount();
    // The reloaded page boots: the guard runs, and 8 s later it clears its own boot claim.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const guardWindow = bootGuard();
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();
    // A chunk failure the guard sees at boot does not reload either.
    guardWindow.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError(CHROMIUM) }));
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledOnce();
  });

  it('shows the panel when the reload does not happen, so the analyst can still leave the view', async () => {
    // For example a "Leave site?" prompt answered with Stay while a save is pending.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderView(new TypeError(CHROMIUM));
    // Testing Library's waitFor drains with setTimeout, which is fake here.
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('shows the panel without reloading while the browser is offline, and keeps the reload for later', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GUARD_KEY)).toBeNull();
  });

  it('reloads once per build, so a later update in the same tab reloads again', async () => {
    loadBuild('./assets/index-2Hq1aB3c.js');
    const first = renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    first.unmount();
    // The reloaded page runs the new build; a later update removes that build's chunks too.
    loadBuild('./assets/index-9Zx8yW7v.js');
    const second = renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    second.unmount();
    // The same build failing again after its own reload shows the panel.
    renderView(new TypeError(CHROMIUM));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('lets the stale-deploy guard reload after a view reload made by an older build', async () => {
    loadBuild('./assets/index-2Hq1aB3c.js');
    const view = renderView(new TypeError(CHROMIUM));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    view.unmount();
    // The reloaded page runs the new build and outlives the guard's boot check.
    loadBuild('./assets/index-9Zx8yW7v.js');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const guardWindow = bootGuard();
    vi.advanceTimersByTime(9_000);
    // A chunk outside every boundary fails after the next update.
    guardWindow.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError(CHROMIUM) }));
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('keeps the guard releasing its own boot claim, so a later update can still reload once', () => {
    sessionStorage.setItem(GUARD_KEY, '1');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    bootGuard();
    vi.advanceTimersByTime(8_000);
    expect(sessionStorage.getItem(GUARD_KEY)).toBeNull();
  });
});
