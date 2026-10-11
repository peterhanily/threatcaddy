import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react';
import type { ChatAttachment } from '../types';
import { readLocalFile } from '../lib/local-file-read';
import { cancellableRequest } from '../lib/request-cancellation';
import { COMPOSER_LIMITS, getComposerDraft, getComposerDrafts, subscribeComposerDrafts, setComposerImages,
  reserveComposerImages, releaseComposerImages } from '../lib/chat-composer-drafts';

export const IMAGE_ATTACHMENT_LIMITS = { count: COMPOSER_LIMITS.imageCount, fileBytes: COMPOSER_LIMITS.imageFileBytes, totalBytes: COMPOSER_LIMITS.imageBytes } as const;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type ImageAttachmentError = 'busy' | 'count' | 'type' | 'size' | 'total' | 'global' | 'read';
class AttachmentError extends Error {
  readonly code: ImageAttachmentError;
  constructor(code: ImageAttachmentError) { super(code); this.code = code; }
}

/** A batch is accepted atomically. Read failure never clears earlier images or
 * the text draft. FileReader avoids spreading millions of bytes onto the stack. */
export function useImageAttachments(scope: string | undefined, onError: (code: ImageAttachmentError) => void) {
  const drafts = useSyncExternalStore(subscribeComposerDrafts, getComposerDrafts);
  const images = scope === undefined ? [] : (drafts.get(scope) ?? getComposerDraft(scope)).images;
  const [reading, setReading] = useState(false);
  const request = useRef<ReturnType<typeof cancellableRequest> | null>(null);
  const errorHandler = useRef(onError);
  const mounted = useRef(false);
  useLayoutEffect(() => { errorHandler.current = onError; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.controller.abort(); };
  }, [scope]);

  const setImages = useCallback((value: SetStateAction<ChatAttachment[]>) => {
    if (scope === undefined) return;
    const next = typeof value === 'function' ? value(getComposerDraft(scope).images) : value;
    setComposerImages(scope, next);
  }, [scope]);

  const attach = useCallback(async (files: File[]) => {
    if (!files.length || !mounted.current || scope === undefined) return;
    if (request.current) { errorHandler.current('busy'); return; }
    const operation = cancellableRequest();
    const reservation = Symbol('image read');
    request.current = operation;
    setReading(true);
    try {
      const snapshot = [...files];
      let bytes = 0;
      for (const file of snapshot) {
        if (!TYPES.has(file.type)) throw new AttachmentError('type');
        if (file.size > IMAGE_ATTACHMENT_LIMITS.fileBytes) throw new AttachmentError('size');
        bytes += file.size;
      }
      const capacity = reserveComposerImages(reservation, scope, snapshot.length, bytes, () => operation.controller.abort());
      if (capacity) throw new AttachmentError(capacity);
      const next: ChatAttachment[] = [];
      for (const file of snapshot) {
        operation.signal.throwIfAborted();
        if (!file.size) throw new AttachmentError('read');
        const encoded = await readLocalFile(file, 'dataURL', operation.signal);
        operation.signal.throwIfAborted();
        const prefix = `data:${file.type};base64,`;
        if (!encoded.startsWith(prefix)) throw new AttachmentError('read');
        next.push({ type: 'image', data: encoded.slice(prefix.length), mimeType: file.type, name: file.name });
      }
      if (mounted.current && !operation.signal.aborted) {
        releaseComposerImages(reservation);
        setImages(previous => [...previous, ...next]);
      }
    } catch (error) {
      if (mounted.current && !operation.signal.aborted) errorHandler.current(error instanceof AttachmentError ? error.code : 'read');
    } finally {
      operation.dispose();
      releaseComposerImages(reservation);
      if (request.current === operation) {
        request.current = null;
        if (mounted.current) setReading(false);
      }
    }
  }, [scope, setImages]);

  const clear = useCallback(() => { request.current?.controller.abort(); setImages([]); }, [setImages]);
  return { images, setImages, attach, clear, reading };
}
