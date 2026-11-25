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
    render(<PresenceIndicator users={[user('a', 'Dana', 'timeline'), user('b', 'Omar', 'ioc-stats'), user('c', 'Li', 'a-view-from-a-newer-client')]} />);
    fireEvent.click(screen.getByRole('button', { name: /3 online/ }));
    expect(screen.getByText('In this investigation now')).toBeInTheDocument();
    expect(screen.getByText('Dana').parentElement).toHaveTextContent('DanaTimeline');
    expect(screen.getByText('Omar').parentElement).toHaveTextContent('OmarIOCs');
    // A view this version does not know is not shown as raw text.
    expect(screen.getByText('Li').parentElement).toHaveTextContent(/^Li$/);
  });
});
