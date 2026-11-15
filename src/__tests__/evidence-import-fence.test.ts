import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEvidenceImportFence } from '../hooks/useEvidenceImportFence';

type Input = Parameters<typeof useEvidenceImportFence>[0];
const ready: Input = { folderId: 'case', visible: true, screenshare: false, archived: false, dataReady: true, dataFailed: false };

function startImport(input: Input = ready) {
  const view = renderHook(props => useEvidenceImportFence(props), { initialProps: input });
  const fence = view.result.current.begin();
  const controller = new AbortController();
  fence.track(controller);
  return { view, fence, controller };
}

describe('evidence import ownership', () => {
  it('keeps an in-flight import alive while chats or evidence reload', () => {
    const { view, fence, controller } = startImport();
    // useChats/useEvidenceItems clear loadedSuccessfully at the start of every reload.
    view.rerender({ ...ready, dataReady: false });
    view.rerender({ ...ready, dataReady: true });
    view.rerender({ ...ready, dataReady: false });
    expect(controller.signal.aborted).toBe(false);
    expect(() => fence.assertCurrentScope()).not.toThrow();
  });

  it.each([
    ['a folder switch', { folderId: 'other' }],
    ['leaving the Evidence view', { visible: false }],
    ['screenshare mode', { screenshare: true }],
    ['archiving the investigation', { archived: true }],
  ])('interrupts an in-flight import on %s with a typed reason', (_name, change) => {
    const { view, fence, controller } = startImport();
    view.rerender({ ...ready, ...change });
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({ code: 'interrupted' });
    expect(() => fence.assertCurrentScope()).toThrow(expect.objectContaining({ code: 'contextChanged' }));
  });

  it('interrupts an in-flight import on unmount and stops tracking settled requests', () => {
    const { view, controller } = startImport();
    const settled = new AbortController();
    const release = view.result.current.begin().track(settled);
    release();
    view.unmount();
    expect(controller.signal.aborted).toBe(true);
    expect(settled.signal.aborted).toBe(false);
  });

  it.each([
    [{ screenshare: true }, 'screenshareActive'],
    [{ archived: true }, 'investigationArchived'],
    [{ dataReady: false }, 'notReady'],
    [{ dataReady: false, dataFailed: true }, 'dataUnavailable'],
    [{ visible: false }, 'contextChanged'],
  ] as const)('refuses to start with %o and names the reason', (change, code) => {
    const { result } = renderHook(() => useEvidenceImportFence({ ...ready, ...change }));
    expect(() => result.current.begin()).toThrow(expect.objectContaining({ code }));
    expect(result.current.blockedReason).toBe(code === 'contextChanged' ? undefined : code);
  });

  it('blocks the controls until data first loads, but not during later reloads', () => {
    const view = renderHook(props => useEvidenceImportFence(props), { initialProps: { ...ready, dataReady: false } });
    expect(view.result.current.blockedReason).toBe('notReady');
    view.rerender(ready);
    expect(view.result.current.blockedReason).toBeUndefined();
    // A chat or evidence reload clears readiness for a moment: the controls stay
    // put, and an import started in that moment is still refused.
    view.rerender({ ...ready, dataReady: false });
    expect(view.result.current.blockedReason).toBeUndefined();
    expect(() => view.result.current.begin()).toThrow(expect.objectContaining({ code: 'notReady' }));
  });

  it('blocks the controls with the real reason when data failed to load', () => {
    const view = renderHook(props => useEvidenceImportFence(props), { initialProps: ready });
    view.rerender({ ...ready, dataReady: false, dataFailed: true });
    expect(view.result.current.blockedReason).toBe('dataUnavailable');
    expect(() => view.result.current.begin()).toThrow(expect.objectContaining({ code: 'dataUnavailable' }));
    view.rerender(ready);
    expect(view.result.current.blockedReason).toBeUndefined();
  });
});
