import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardView } from '../components/Dashboard/DashboardView';
import type { QuickLink } from '../types';

const link: QuickLink = {
  id: 'fictional-quick-link', title: 'Fictional reference',
  url: 'https://reference.example/ordinary', description: 'A synthetic saved reference.', icon: '🔎',
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const [name, key] of [['Enter', '{Enter}'], ['Space', ' ']]) {
  describe(`${name} activation`, () => {
    for (const action of ['Edit', 'Delete']) {
      it(`${action} opens only its dialog and cancellation preserves the link`, async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const update = vi.fn();
        render(<DashboardView links={[link]} onUpdateLinks={update} />);
        const control = screen.getByRole('button', { name: `${action} ${link.title}` });
        expect(control.closest('[role="button"]')).toBeNull();
        control.focus();
        await user.keyboard(key);
        const dialog = await screen.findByRole('dialog', { name: `${action} Link` });
        expect(open).not.toHaveBeenCalled();
        if (action === 'Edit') {
          const title = within(dialog).getByPlaceholderText('e.g. VirusTotal');
          await user.clear(title);
          await user.type(title, 'An unsaved edit');
        }
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: link.title })).toBeVisible();
        expect(update).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      });
    }

    it('launches the saved HTTP(S) target exactly once through the native button', async () => {
      const user = userEvent.setup();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      render(<DashboardView links={[link]} onUpdateLinks={vi.fn()} />);
      const launch = screen.getByRole('button', { name: link.title });
      expect(launch.tagName).toBe('BUTTON');
      expect(launch.querySelector('button, [role="button"]')).toBeNull();
      expect(launch).toHaveAccessibleDescription(link.description);
      launch.focus();
      await user.keyboard(key);
      expect(open).toHaveBeenCalledExactlyOnceWith(link.url, '_blank', 'noopener,noreferrer');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
}

it.each(['file:///fictional-reference.txt', 'mailto:analyst@example.test', 'not a URL'])('does not open the unsupported saved target %s', async url => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(<DashboardView links={[{ ...link, url }]} onUpdateLinks={vi.fn()} />);
  const launch = screen.getByRole('button', { name: link.title });
  launch.focus();
  await user.keyboard('{Enter} ');
  await user.click(launch);
  expect(open).not.toHaveBeenCalled();
});
