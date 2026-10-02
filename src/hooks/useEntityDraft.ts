import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getEntityDraft } from '../lib/entity-drafts';

export function useEntityDraft<T extends object>(
  kind: string,
  id: string,
  onUpdate: (id: string, patch: Partial<T>) => void | Promise<void>,
  onError?: (message: string) => void,
) {
  const controller = useMemo(() => getEntityDraft(`${kind}:${id}`), [kind, id]);
  const persistRef = useRef(onUpdate);
  const errorRef = useRef(onError);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    persistRef.current = onUpdate;
    errorRef.current = onError;
  }, [onUpdate, onError]);

  useEffect(() => controller.attach(
    (patch) => persistRef.current(id, patch as Partial<T>),
    (message) => errorRef.current?.(message),
  ), [controller, id]);

  return { ...state, patch: state.patch as Partial<T>, controller };
}
