/** A workspace switch must not leave provider requests attached to old data. */
const requests = new Set<AbortController>();
if (typeof window !== 'undefined') {
  window.addEventListener('workspace-will-switch', () => {
    for (const controller of requests) controller.abort();
  });
}

export function cancellableRequest(parent?: AbortSignal) {
  const controller = new AbortController();
  requests.add(controller);
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  return { controller, signal: controller.signal, dispose: () => {
    requests.delete(controller);
    parent?.removeEventListener('abort', abort);
  } };
}
