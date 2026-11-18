/** Always-visible shell controls in German: the screenshare switch, notifications and the tag input. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18n from '../i18n';
import { ScreenshareToggle } from '../components/Common/ScreenshareToggle';
import { ToastContainer } from '../components/Common/Toast';
import { TagInput } from '../components/Common/TagInput';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import deCommon from '../../public/locales/de/common.json';

const de = deCommon as Record<string, string>;
const fill = (text: string, values: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name]);

beforeEach(async () => {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  await act(async () => { await i18n.changeLanguage('de'); });
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('shell controls in the analyst\'s language', () => {
  it('names the screenshare switch, its levels and its badge', () => {
    const levels = ['TLP:CLEAR', 'TLP:AMBER'];
    const view = render(<ScreenshareToggle maxLevel={null} onChangeLevel={vi.fn()} effectiveLevels={levels} />);
    const toggle = screen.getByRole('button', { name: de['screenshare.toggle'] });
    expect(toggle).toHaveAttribute('title', de['screenshare.mode']);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: de['screenshare.off'] })).toBeInTheDocument();
    for (const level of levels) expect(screen.getByRole('button', { name: fill(de['screenshare.showUpTo'], { level }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Off' })).toBeNull();
    expect(screen.queryByText(/Show up to/)).toBeNull();
    view.unmount();

    render(<ScreenshareToggle maxLevel="TLP:AMBER" onChangeLevel={vi.fn()} effectiveLevels={levels} />);
    const active = fill(de['screenshare.level'], { level: 'TLP:AMBER' });
    expect(screen.getByRole('button', { name: de['screenshare.toggle'] })).toHaveAttribute('title', active);
    expect(screen.getByText(active)).toBeInTheDocument();
    expect(screen.queryByText(/Screenshare:/)).toBeNull();
  });

  it('labels notifications and hides their details while screensharing', () => {
    function Notify() {
      const { addToast } = useToast();
      useEffect(() => { addToast('info', 'Synthetic notification about Fictional Case Alpha'); }, [addToast]);
      return null;
    }
    render(<ScreenshareContext.Provider value={{ maxLevel: 'TLP:CLEAR', effectiveLevels: ['TLP:CLEAR'] }}>
      <ToastProvider><Notify /><ToastContainer /></ToastProvider>
    </ScreenshareContext.Provider>);
    const region = screen.getByRole('region', { name: de['toasts.label'] });
    expect(within(region).getByText(de['screenshare.notificationHidden'])).toBeInTheDocument();
    expect(region).not.toHaveTextContent('Fictional Case Alpha');
    fireEvent.click(within(region).getByRole('button', { name: de.dismiss }));
    expect(within(region).queryByRole('alert')).toBeNull();
  });

  it('labels the tag input and each tag\'s remove button', () => {
    const onChange = vi.fn();
    render(<ToastProvider><TagInput selectedTags={['phishing']} allTags={[]} onChange={onChange} onCreateTag={vi.fn()} /></ToastProvider>);
    expect(screen.getByRole('combobox', { name: de['tagInput.addLabel'] })).toHaveAttribute('placeholder', de['tagInput.addPlaceholder']);
    fireEvent.click(screen.getByRole('button', { name: fill(de['tagInput.removeLabel'], { name: 'phishing' }) }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
    expect(screen.queryByPlaceholderText('Add tag...')).toBeNull();
  });
});
