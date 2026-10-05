import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagSubList } from '../components/Layout/TagSubList';
import { ScreenshareContext } from '../hooks/ScreenshareContext';

const tags = [{ id: 'first', name: 'phishing', color: '#123456' }, { id: 'second', name: 'malware', color: '#654321' }];
function props() {
  return {
    tags, selectedTag: 'phishing', onTagSelect: vi.fn(), onFolderSelect: vi.fn(),
    onShowTrash: vi.fn(), onShowArchive: vi.fn(), onNavigate: vi.fn(),
    onRenameTag: vi.fn().mockResolvedValue(undefined), onDeleteTag: vi.fn().mockResolvedValue(undefined),
  };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('accessible sidebar tag controls', () => {
  it('uses separate native buttons and only selection navigates', async () => {
    const actions = props();
    const user = userEvent.setup();
    const view = render(<TagSubList {...actions} />);
    expect(view.container.querySelector('button button, [role="button"] button')).toBeNull();
    const select = screen.getByRole('button', { name: 'phishing' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    select.focus();
    await user.keyboard('{Enter}');
    expect(actions.onTagSelect).toHaveBeenCalledExactlyOnceWith('phishing');
    expect(actions.onFolderSelect).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(actions.onShowTrash).toHaveBeenCalledExactlyOnceWith(false);
    expect(actions.onShowArchive).toHaveBeenCalledExactlyOnceWith(false);
    expect(actions.onNavigate).toHaveBeenCalledOnce();
    expect(actions.onDeleteTag).not.toHaveBeenCalled();
    expect(actions.onRenameTag).not.toHaveBeenCalled();
  });

  it('collapses with native Space and expands with Enter', async () => {
    const user = userEvent.setup();
    render(<TagSubList {...props()} />);
    const toggle = screen.getByRole('button', { name: 'Tags' });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'phishing' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'phishing' })).toBeVisible();
  });

  for (const key of ['{Enter}', ' ']) {
    it(`opens deletion with ${JSON.stringify(key)} without selecting and restores focus on cancel`, async () => {
      const actions = props();
      const user = userEvent.setup();
      render(<TagSubList {...actions} />);
      const remove = screen.getByRole('button', { name: 'Delete tag malware' });
      remove.focus();
      await user.keyboard(key);
      expect(screen.getByRole('dialog', { name: 'Delete Tag' })).toBeVisible();
      expect(actions.onTagSelect).not.toHaveBeenCalled();
      expect(actions.onNavigate).not.toHaveBeenCalled();
      expect(actions.onFolderSelect).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(remove).toHaveFocus();
      expect(actions.onDeleteTag).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'phishing' })).toHaveAttribute('aria-pressed', 'true');
    });
  }

  it('cancels keyboard renaming without changing filters or navigating', async () => {
    const actions = props();
    const user = userEvent.setup();
    render(<TagSubList {...actions} />);
    const rename = screen.getByRole('button', { name: 'Rename tag phishing' });
    rename.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'New name for tag phishing' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Uncommitted name');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename tag phishing' })).toHaveFocus();
    expect(actions.onRenameTag).not.toHaveBeenCalled();
    expect(actions.onTagSelect).not.toHaveBeenCalled();
    expect(actions.onNavigate).not.toHaveBeenCalled();
  });

  it('awaits Enter commit, updates the selected filter and restores rename-button focus', async () => {
    const actions = props();
    const request = deferred();
    actions.onRenameTag.mockReturnValue(request.promise);
    const user = userEvent.setup();
    const view = render(<TagSubList {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Rename tag phishing' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '  email-risk  {Enter}');
    expect(actions.onRenameTag).toHaveBeenCalledExactlyOnceWith('first', 'email-risk');
    expect(input).toBeDisabled();
    expect(actions.onTagSelect).not.toHaveBeenCalled();
    await act(async () => request.resolve());
    expect(actions.onTagSelect).toHaveBeenCalledExactlyOnceWith('email-risk');
    view.rerender(<TagSubList {...actions} tags={[{ ...tags[0], name: 'email-risk' }, tags[1]]} selectedTag="email-risk" />);
    expect(screen.getByRole('button', { name: 'Rename tag email-risk' })).toHaveFocus();
    expect(actions.onNavigate).not.toHaveBeenCalled();
    expect(actions.onFolderSelect).not.toHaveBeenCalled();
  });

  it('retains a failed rename draft, reports a generic error and allows retry', async () => {
    const actions = props();
    actions.onRenameTag.mockRejectedValueOnce(new Error('Private database detail'));
    const user = userEvent.setup();
    render(<TagSubList {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Rename tag phishing' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'retry-name{Enter}');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not rename'));
    expect(input).toHaveValue('retry-name');
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    expect(screen.queryByText('Private database detail')).toBeNull();
    expect(actions.onTagSelect).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(actions.onRenameTag).toHaveBeenCalledTimes(2);
  });

  it('rejects blank names and case-insensitive trimmed duplicates', async () => {
    const actions = props();
    const user = userEvent.setup();
    render(<TagSubList {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Rename tag phishing' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '  {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a tag name');
    await user.clear(input);
    await user.type(input, ' MALWARE {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(actions.onRenameTag).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer selection when rename completes', async () => {
    const actions = props();
    const request = deferred();
    actions.onRenameTag.mockReturnValue(request.promise);
    const user = userEvent.setup();
    const view = render(<TagSubList {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Rename tag phishing' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'renamed{Enter}');
    view.rerender(<TagSubList {...actions} selectedTag="malware" />);
    await act(async () => request.resolve());
    expect(actions.onTagSelect).not.toHaveBeenCalled();
  });

  it('clears the deleted selected tag only after persistence and focuses the stable toggle', async () => {
    const actions = props();
    const request = deferred();
    actions.onDeleteTag.mockReturnValue(request.promise);
    const user = userEvent.setup();
    const view = render(<TagSubList {...actions} tags={[tags[0]]} />);
    await user.click(screen.getByRole('button', { name: 'Delete tag phishing' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Tag' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus();
    expect(actions.onTagSelect).not.toHaveBeenCalled();
    await act(async () => request.resolve());
    expect(actions.onTagSelect).toHaveBeenCalledExactlyOnceWith(undefined);
    view.rerender(<TagSubList {...actions} tags={[]} selectedTag={undefined} />);
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus();
    expect(actions.onNavigate).not.toHaveBeenCalled();
    expect(actions.onFolderSelect).not.toHaveBeenCalled();
  });

  it('reports failed deletion without navigating or clearing the selected tag', async () => {
    const actions = props();
    actions.onDeleteTag.mockRejectedValueOnce(new Error('Private failure'));
    const user = userEvent.setup();
    render(<TagSubList {...actions} />);
    await user.click(screen.getByRole('button', { name: 'Delete tag phishing' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Tag' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not delete'));
    expect(actions.onTagSelect).not.toHaveBeenCalled();
    expect(actions.onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete tag phishing' })).toBeEnabled();
  });

  it('suspends mutations while sharing and retains the hidden inline rename draft', async () => {
    const actions = props();
    const user = userEvent.setup();
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}><TagSubList {...actions} /></ScreenshareContext.Provider>;
    const view = render(ui(null));
    await user.click(screen.getByRole('button', { name: 'Rename tag phishing' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Private draft name');
    view.rerender(ui('TLP:CLEAR'));
    expect(input).not.toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename tag malware' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete tag malware' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'malware' })).toBeEnabled();
    view.rerender(ui(null));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('Private draft name');
    expect(actions.onRenameTag).not.toHaveBeenCalled();
  });
});
