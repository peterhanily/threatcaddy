import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ExecEntityNav } from '../components/ExecMode/ExecEntityNav';
import en from '../../public/locales/en/exec.json';
import fr from '../../public/locales/fr/exec.json';

describe('Exec investigation entity navigation', () => {
  it.each(['en', 'fr'])('names every count-only control in %s and supports keyboard selection', async language => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: 'en', keySeparator: false, resources: { en: { exec: en }, fr: { exec: fr } } });
    const onTap = vi.fn();
    const counts = { notes: 2, tasks: 3, events: 0, whiteboards: 1, iocs: 4 };
    render(<I18nextProvider i18n={i18n}><ExecEntityNav counts={counts} activeTab="tasks" onTap={onTap} /></I18nextProvider>);
    const user = userEvent.setup();
    for (const [key, count] of Object.entries(counts)) {
      const label = i18n.t(`investigations.${key === 'whiteboards' ? 'boards' : key}`, { ns: 'exec' });
      const button = screen.getByRole('button', { name: `${label}: ${count}`, pressed: key === 'tasks' });
      expect(button).toHaveAttribute('type', 'button');
      await user.tab();
      expect(button).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(onTap).toHaveBeenLastCalledWith(key);
    }
    expect(onTap).toHaveBeenCalledTimes(5);
  });
});
