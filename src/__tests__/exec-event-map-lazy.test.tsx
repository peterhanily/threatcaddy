import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '../types';
import { ExecEventView } from '../components/ExecMode/ExecEventView';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('../components/ExecMode/ExecEventMap', () => {
  loaded();
  return { ExecEventMap: ({ latitude, longitude }: { latitude: number; longitude: number }) => <div aria-label="Synthetic lazy map">{latitude},{longitude}</div> };
});
afterEach(cleanup);
const event = { id: 'synthetic-event', title: 'Fictional observation', description: '', timestamp: 1,
  eventType: 'other', confidence: 'medium', assets: [], mitreAttackIds: [], tags: [] } as unknown as TimelineEvent;

it('does not load the map library without coordinates, then loads it for zero-valued coordinates', async () => {
  const view = render(<ExecEventView event={event} onBack={vi.fn()} />);
  expect(screen.getByRole('heading', { name: event.title })).toBeInTheDocument();
  expect(loaded).not.toHaveBeenCalled();
  view.rerender(<ExecEventView event={{ ...event, latitude: 0, longitude: 0 }} onBack={vi.fn()} />);
  expect(await screen.findByLabelText('Synthetic lazy map')).toHaveTextContent('0,0');
  expect(loaded).toHaveBeenCalledTimes(1);
});
