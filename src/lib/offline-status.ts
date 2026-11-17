/** 'checking' looks for a registration; 'installing' means an expected worker
 * is downloading or activating, so closing the tab can interrupt it.
 * 'unconfirmed' found no expected worker in time, which a late or failed
 * download looks like too; 'unavailable' is a definite failure: no worker
 * support, a refused lookup or an expected worker that became redundant. */
export type OfflineStatus = 'checking' | 'installing' | 'installed' | 'unconfirmed' | 'unavailable';

export interface ObservedOfflineWorker extends EventTarget {
  readonly state: ServiceWorkerState;
  readonly scriptURL: string;
}
export interface ObservedOfflineRegistration extends EventTarget {
  readonly scope: string;
  readonly active: ObservedOfflineWorker | null;
  readonly installing: ObservedOfflineWorker | null;
  readonly waiting: ObservedOfflineWorker | null;
}
export interface OfflineWorkerContainer extends EventTarget {
  getRegistration(clientURL: string): Promise<ObservedOfflineRegistration | undefined>;
  readonly ready: Promise<ObservedOfflineRegistration>;
}

/** Relative SPA navigation must not change the expected worker's directory.
 * Hosted build modules live under assets/, including subpath deployments. */
export function offlineWorkerTarget(pageURL: string, moduleURL: string, baseURL: string, production: boolean) {
  const page = new URL(pageURL);
  const module = new URL(moduleURL);
  const assets = module.pathname.lastIndexOf('/assets/');
  const base = production && baseURL.startsWith('.') && assets >= 0 && module.origin === page.origin
    ? new URL(module.pathname.slice(0, assets + 1), module.origin)
    : new URL(baseURL, page);
  return { pageURL: page.href, scopeURL: base.href, workerURL: new URL('sw.js', base).href };
}

/** Observe the existing registration only. Activated is an installation signal,
 * not an asset-integrity, latest-version or durable-storage guarantee. */
export function observeOfflineStatus({
  container, lifecycle, pageURL, scopeURL, workerURL, onChange: listener,
  timeoutMs = 15_000, pollMs = 500,
}: {
  container?: OfflineWorkerContainer;
  lifecycle?: EventTarget;
  pageURL: string;
  scopeURL: string;
  workerURL: string;
  onChange: (status: OfflineStatus) => void;
  timeoutMs?: number;
  pollMs?: number;
}): () => void {
  let disposed = false;
  let lastStatus: OfflineStatus | undefined;
  const emit = (status: OfflineStatus) => {
    if (!disposed && status !== lastStatus) { lastStatus = status; listener(status); }
  };
  if (!container) {
    emit('unavailable');
    return () => { disposed = true; listener = () => {}; };
  }

  let registration: ObservedOfflineRegistration | undefined;
  const workers = new Set<ObservedOfflineWorker>();
  let lookupVersion = 0;
  let timedOut = false;
  let installFailed = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stopPolling = () => { clearInterval(poll); clearTimeout(deadline); poll = undefined; deadline = undefined; };
  const isExpected = (worker: ObservedOfflineWorker | null | undefined) => worker?.scriptURL === workerURL;

  const evaluate = () => {
    if (disposed) return;
    // Browsers drop a failed first install from the registration before its
    // redundant event arrives, so check the workers watched until now.
    if ([...workers].some(worker => worker.state === 'redundant')) installFailed = true;
    for (const worker of workers) worker.removeEventListener('statechange', evaluate);
    workers.clear();
    for (const worker of [registration?.active, registration?.waiting, registration?.installing]) {
      if (worker && isExpected(worker)) {
        workers.add(worker);
        worker.addEventListener('statechange', evaluate);
      }
    }
    if (isExpected(registration?.active) && registration?.active?.state === 'activated') {
      emit('installed');
      timedOut = true;
      installFailed = false;
      stopPolling();
    } else if ([...workers].some(worker => ['installing', 'installed', 'activating'].includes(worker.state))) {
      // A legitimate large download can take minutes. Polling ends, but these
      // workers' events still report completion or redundancy without a reload.
      emit('installing');
      installFailed = false;
    } else if (installFailed || [...workers].some(worker => worker.state === 'redundant')) {
      emit('unavailable');
    } else {
      emit(timedOut ? 'unconfirmed' : 'checking');
    }
  };

  const bind = (next: ObservedOfflineRegistration | undefined) => {
    registration?.removeEventListener('updatefound', evaluate);
    registration = next?.scope === scopeURL ? next : undefined;
    registration?.addEventListener('updatefound', evaluate);
    evaluate();
  };
  const inspect = () => {
    if (disposed) return;
    const version = ++lookupVersion;
    try {
      void container.getRegistration(pageURL).then(next => {
        if (!disposed && version === lookupVersion) bind(next);
      }, () => {
        if (!disposed && version === lookupVersion) {
          if (isExpected(registration?.active) && registration?.active?.state === 'activated') evaluate();
          else emit('unavailable');
        }
      });
    } catch { emit('unavailable'); }
  };

  emit('checking');
  poll = setInterval(inspect, pollMs);
  deadline = setTimeout(() => { timedOut = true; stopPolling(); evaluate(); }, timeoutMs);
  container.addEventListener('controllerchange', inspect);
  lifecycle?.addEventListener('focus', inspect);
  lifecycle?.addEventListener('online', inspect);
  try {
    void container.ready.then(next => {
      if (!disposed && next.scope === scopeURL) { ++lookupVersion; bind(next); }
    }, () => { if (!disposed && lastStatus !== 'installed') emit('unavailable'); });
  } catch { emit('unavailable'); }
  inspect();
  return () => {
    disposed = true;
    // A never-settling ready promise may retain this disposed observer. Its
    // only callback binding must stop retaining the component immediately.
    listener = () => {};
    ++lookupVersion;
    stopPolling();
    registration?.removeEventListener('updatefound', evaluate);
    for (const worker of workers) worker.removeEventListener('statechange', evaluate);
    workers.clear();
    container.removeEventListener('controllerchange', inspect);
    lifecycle?.removeEventListener('focus', inspect);
    lifecycle?.removeEventListener('online', inspect);
  };
}
