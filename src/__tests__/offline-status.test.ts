import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeOfflineStatus, offlineWorkerTarget, type OfflineStatus, type ObservedOfflineRegistration, type ObservedOfflineWorker } from '../lib/offline-status';
import observerSource from '../lib/offline-status.ts?raw';

const scopeURL = 'https://app.example.test/app/';
const workerURL = `${scopeURL}sw.js`;
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  let reject: (reason?: unknown) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class Worker extends EventTarget implements ObservedOfflineWorker {
  state: ServiceWorkerState = 'installing';
  scriptURL = workerURL;
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget implements ObservedOfflineRegistration {
  scope = scopeURL;
  active: Worker | null = null;
  installing: Worker | null = null;
  waiting: Worker | null = null;
  update = vi.fn();
  unregister = vi.fn();
}
class Container extends EventTarget {
  getRegistration = vi.fn<(url: string) => Promise<Registration | undefined>>().mockResolvedValue(undefined);
  readiness = deferred<Registration>();
  ready = this.readiness.promise;
  register = vi.fn();
}
const stops: Array<() => void> = [];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function observe(container?: Container) {
  const lifecycle = new EventTarget(); const states: OfflineStatus[] = [];
  const onChange = vi.fn((status: OfflineStatus) => states.push(status));
  const stop = observeOfflineStatus({ container, lifecycle, pageURL: `${scopeURL}case/detail`, scopeURL, workerURL,
    onChange, timeoutMs: 100, pollMs: 25 });
  stops.push(stop);
  return { lifecycle, states, onChange, stop };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers(); });

describe('passive offline installation observer', () => {
  it('finishes unsupported contexts without timers or registration changes', () => {
    const result = observe();
    expect(result.states).toEqual(['unavailable']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an existing matching activated worker and never changes its lifecycle', async () => {
    const container = new Container(); const registration = new Registration(); const worker = new Worker();
    worker.state = 'activated'; registration.active = worker;
    container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await flush();
    expect(result.states).toEqual(['checking', 'installed']);
    expect(container.getRegistration).toHaveBeenCalledWith(`${scopeURL}case/detail`);
    expect(container.register).not.toHaveBeenCalled();
    expect(registration.update).not.toHaveBeenCalled(); expect(registration.unregister).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds polling without labeling a still-installing worker as failed', async () => {
    const container = new Container(); const registration = new Registration(); const worker = new Worker();
    registration.installing = worker; container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(result.states).toEqual(['checking']);
    expect(container.getRegistration.mock.calls.length).toBeLessThanOrEqual(5);
    expect(vi.getTimerCount()).toBe(0);
    registration.installing = null; registration.active = worker; worker.change('activated');
    expect(result.states.at(-1)).toBe('installed');
  });

  it('marks absent registration as unconfirmed after timeout and recovers from late ready', async () => {
    const container = new Container(); const result = observe(container);
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.states).toEqual(['checking', 'unavailable']);
    expect(vi.getTimerCount()).toBe(0);
    const registration = new Registration(); const worker = new Worker(); worker.state = 'activated'; registration.active = worker;
    container.readiness.resolve(registration); await flush();
    expect(result.states.at(-1)).toBe('installed');
  });

  it('does not wait forever for a lookup or ready promise and accepts its valid late completion', async () => {
    const container = new Container(); const lookup = deferred<Registration | undefined>();
    container.getRegistration.mockReturnValue(lookup.promise);
    const result = observe(container); await vi.advanceTimersByTimeAsync(1000);
    expect(result.states.at(-1)).toBe('unavailable');
    const registration = new Registration(); const worker = new Worker(); worker.state = 'activated'; registration.active = worker;
    lookup.resolve(registration); await flush();
    expect(result.states.at(-1)).toBe('installed'); expect(vi.getTimerCount()).toBe(0);
  });

  it('observes redundant installation and recovers when an update is found', async () => {
    const container = new Container(); const registration = new Registration(); const failed = new Worker();
    registration.installing = failed; container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await flush(); failed.change('redundant');
    expect(result.states.at(-1)).toBe('unavailable');
    const replacement = new Worker(); registration.installing = replacement; registration.dispatchEvent(new Event('updatefound'));
    expect(result.states.at(-1)).toBe('checking');
    registration.active = replacement; registration.installing = null; replacement.change('activated');
    expect(result.states.at(-1)).toBe('installed');
  });

  it('keeps the installed signal for an existing worker while an update installs or fails', async () => {
    const container = new Container(); const registration = new Registration(); const active = new Worker();
    active.state = 'activated'; registration.active = active; container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await flush();
    const update = new Worker(); registration.installing = update; registration.dispatchEvent(new Event('updatefound'));
    update.change('redundant');
    expect(result.states).toEqual(['checking', 'installed']);
  });

  it('rejects unrelated worker scripts and scopes without claiming offline support', async () => {
    const container = new Container(); const registration = new Registration(); const active = new Worker();
    active.state = 'activated'; active.scriptURL = `${scopeURL}unrelated.js`; registration.active = active;
    container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await vi.advanceTimersByTimeAsync(100);
    expect(result.states.at(-1)).toBe('unavailable');
    registration.scope = 'https://app.example.test/'; active.scriptURL = workerURL;
    container.readiness.resolve(registration); await flush();
    expect(result.states.at(-1)).toBe('unavailable');
  });

  it('handles rejected and synchronous browser API failures, then retries on lifecycle events', async () => {
    const container = new Container(); container.getRegistration.mockRejectedValue(new Error('Unavailable'));
    const result = observe(container); await flush(); expect(result.states.at(-1)).toBe('unavailable');
    container.getRegistration.mockImplementation(() => { throw new Error('Denied'); });
    result.lifecycle.dispatchEvent(new Event('focus')); expect(result.states.at(-1)).toBe('unavailable');
    const registration = new Registration(); const worker = new Worker(); worker.state = 'activated'; registration.active = worker;
    container.getRegistration.mockResolvedValue(registration); result.lifecycle.dispatchEvent(new Event('online')); await flush();
    expect(result.states.at(-1)).toBe('installed');
    container.readiness.reject(new Error('Old readiness failure')); await flush(); expect(result.states.at(-1)).toBe('installed');
  });

  it('does not let an older lookup erase a newer installed result', async () => {
    const container = new Container(); const old = deferred<Registration | undefined>(); const latest = deferred<Registration | undefined>();
    container.getRegistration.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const result = observe(container); result.lifecycle.dispatchEvent(new Event('focus'));
    const registration = new Registration(); const worker = new Worker(); worker.state = 'activated'; registration.active = worker;
    latest.resolve(registration); await flush(); old.resolve(undefined); await flush();
    expect(result.states.at(-1)).toBe('installed');
  });

  it('reports removal after a known installation without starting perpetual checking', async () => {
    const container = new Container(); const registration = new Registration(); const worker = new Worker();
    worker.state = 'activated'; registration.active = worker; container.getRegistration.mockResolvedValue(registration);
    const result = observe(container); await flush(); container.getRegistration.mockResolvedValue(undefined);
    result.lifecycle.dispatchEvent(new Event('focus')); await flush();
    expect(result.states.at(-1)).toBe('unavailable'); expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans timers/listeners and ignores async readiness after unsubscribe', async () => {
    const container = new Container(); const registration = new Registration(); const worker = new Worker();
    registration.installing = worker; container.getRegistration.mockResolvedValue(registration);
    const remove = vi.spyOn(worker, 'removeEventListener');
    const result = observe(container); await flush(); result.stop();
    const calls = result.onChange.mock.calls.length; const lookups = container.getRegistration.mock.calls.length;
    registration.active = worker; registration.installing = null; worker.change('activated');
    registration.dispatchEvent(new Event('updatefound')); container.dispatchEvent(new Event('controllerchange'));
    result.lifecycle.dispatchEvent(new Event('online')); result.lifecycle.dispatchEvent(new Event('focus'));
    container.readiness.resolve(registration); await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(result.onChange).toHaveBeenCalledTimes(calls); expect(container.getRegistration).toHaveBeenCalledTimes(lookups);
    expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
  });

  it('detaches callback ownership without retaining the original options in pending closures', async () => {
    // Structural rather than GC-timing coverage: the callback has one mutable
    // binding and the original options object is never captured by callbacks.
    expect(observerSource).toMatch(/function observeOfflineStatus\(\{[^}]*onChange: listener,/s);
    expect(observerSource).not.toMatch(/\boptions\b/);
    expect(observerSource).toContain('listener = () => {};');
    const container = new Container(); const lookup = deferred<Registration | undefined>();
    container.getRegistration.mockReturnValue(lookup.promise);
    const onChange = vi.fn();
    const { proxy, revoke } = Proxy.revocable({ container, pageURL: scopeURL, scopeURL, workerURL, onChange }, {});
    const stop = observeOfflineStatus(proxy); stops.push(stop);
    revoke(); stop();
    const registration = new Registration(); const worker = new Worker();
    worker.state = 'activated'; registration.active = worker;
    container.readiness.resolve(registration); lookup.resolve(registration); await flush();
    expect(onChange.mock.calls).toEqual([['checking']]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('expected hosted worker location', () => {
  it.each([
    ['https://app.example.test/', 'https://app.example.test/assets/index.js', './', 'https://app.example.test/'],
    ['https://app.example.test/app/', 'https://app.example.test/app/assets/status.js', './', 'https://app.example.test/app/'],
    ['https://app.example.test/app/case/detail', 'https://app.example.test/app/assets/status.js', './', 'https://app.example.test/app/'],
    ['https://app.example.test/app/case/detail', 'https://app.example.test/app/assets/status.js', '/app/', 'https://app.example.test/app/'],
  ])('resolves %s from the built module and configured base', (page, module, base, scope) => {
    expect(offlineWorkerTarget(page, module, base, true)).toEqual({ pageURL: page, scopeURL: scope, workerURL: `${scope}sw.js` });
  });
});
