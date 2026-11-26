import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresenceIndicator } from '../components/Common/PresenceIndicator';

const user = (id: string, displayName: string, view: string) => ({ id, displayName, avatarUrl: null, view });

describe('PresenceIndicator', () => {
  it('shows nothing when nobody else has the investigation open', () => {
    const { container } = render(<PresenceIndicator users={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the people, and names each one's view by its sidebar name", () => {
    render(<PresenceIndicator users={[user('a', 'Dana', 'timeline'), user('b', 'Omar', 'ioc-stats'), user('d', 'Kim', 'overview'), user('c', 'Li', 'a-view-from-a-newer-client')]} />);
    fireEvent.click(screen.getByRole('button', { name: /4 online/ }));
    expect(screen.getByText('In this investigation now')).toBeInTheDocument();
    expect(screen.getByText('Dana').parentElement).toHaveTextContent('DanaTimeline');
    expect(screen.getByText('Omar').parentElement).toHaveTextContent('OmarIOCs');
    expect(screen.getByText('Kim').parentElement).toHaveTextContent('KimOverview');
    // A view this version does not know is not shown as raw text.
    expect(screen.getByText('Li').parentElement).toHaveTextContent(/^Li$/);
  });

  it('does not break on a view named like an object member, which a teammate can send', () => {
    render(<PresenceIndicator users={['constructor', 'toString', '__proto__', 'hasOwnProperty'].map((view, index) => user(String(index), `Person ${index}`, view))} />);
    fireEvent.click(screen.getByRole('button', { name: /4 online/ }));
    expect(screen.getByText('Person 0').parentElement).toHaveTextContent(/^Person 0$/);
    expect(screen.getByText('Person 2').parentElement).toHaveTextContent(/^Person 2$/);
  });
});
