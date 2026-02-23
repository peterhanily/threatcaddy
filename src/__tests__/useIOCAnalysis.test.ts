import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIOCAnalysis } from '../hooks/useIOCAnalysis';
import type { IOCTarget, IOCAnalysis } from '../types';

function makeItem(overrides: Partial<IOCTarget> = {}): IOCTarget {
  return {
    id: 'item-1',
    title: 'Test Item',
    content: 'Found suspicious IP 192.168.1.100 and domain evil.example.com',
    ...overrides,
  };
}

function makeAnalysis(iocs: IOCAnalysis['iocs'] = []): IOCAnalysis {
  return {
    extractedAt: Date.now(),
    iocs,
    analysisSummary: '',
  };
}

describe('useIOCAnalysis', () => {
  it('analyze extracts IOCs from content and calls onUpdate', () => {
    const onUpdate = vi.fn();
    const item = makeItem();
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    act(() => {
      result.current.analyze();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [id, updates] = onUpdate.mock.calls[0];
    expect(id).toBe('item-1');
    expect(updates.iocAnalysis).toBeDefined();
    expect(updates.iocAnalysis!.iocs.length).toBeGreaterThan(0);
    expect(updates.iocTypes).toBeDefined();
  });

  it('dismissIOC marks an IOC as dismissed', () => {
    const onUpdate = vi.fn();
    const analysis = makeAnalysis([
      { id: 'ioc-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', dismissed: false, firstSeen: Date.now() },
    ]);
    const item = makeItem({ iocAnalysis: analysis });
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    act(() => {
      result.current.dismissIOC('ioc-1');
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updates = onUpdate.mock.calls[0][1];
    expect(updates.iocAnalysis!.iocs[0].dismissed).toBe(true);
  });

  it('restoreIOC marks an IOC as not dismissed', () => {
    const onUpdate = vi.fn();
    const analysis = makeAnalysis([
      { id: 'ioc-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', dismissed: true, firstSeen: Date.now() },
    ]);
    const item = makeItem({ iocAnalysis: analysis });
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    act(() => {
      result.current.restoreIOC('ioc-1');
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updates = onUpdate.mock.calls[0][1];
    expect(updates.iocAnalysis!.iocs[0].dismissed).toBe(false);
  });

  it('iocCount returns count of non-dismissed IOCs', () => {
    const onUpdate = vi.fn();
    const analysis = makeAnalysis([
      { id: 'ioc-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', dismissed: false, firstSeen: Date.now() },
      { id: 'ioc-2', type: 'domain', value: 'evil.com', confidence: 'high', dismissed: true, firstSeen: Date.now() },
      { id: 'ioc-3', type: 'url', value: 'http://bad.com', confidence: 'low', dismissed: false, firstSeen: Date.now() },
    ]);
    const item = makeItem({ iocAnalysis: analysis });
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    expect(result.current.iocCount).toBe(2);
    expect(result.current.activeIOCs).toHaveLength(2);
    expect(result.current.dismissedIOCs).toHaveLength(1);
  });

  it('updateSummary updates the analysis summary', () => {
    const onUpdate = vi.fn();
    const analysis = makeAnalysis([]);
    const item = makeItem({ iocAnalysis: analysis });
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    act(() => {
      result.current.updateSummary('This is a test summary');
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updates = onUpdate.mock.calls[0][1];
    expect(updates.iocAnalysis!.analysisSummary).toBe('This is a test summary');
  });

  it('returns zero counts when no analysis exists', () => {
    const onUpdate = vi.fn();
    const item = makeItem();
    const { result } = renderHook(() => useIOCAnalysis({ item, onUpdate }));

    expect(result.current.iocCount).toBe(0);
    expect(result.current.activeIOCs).toHaveLength(0);
    expect(result.current.dismissedIOCs).toHaveLength(0);
    expect(result.current.analysis).toBeUndefined();
  });
});
