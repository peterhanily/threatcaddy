import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IntegrationConfigForm } from '../components/Integrations/IntegrationConfigForm';
import type { IntegrationConfigField } from '../types/integration-types';

const fields: IntegrationConfigField[] = [
  { key: 'token', label: 'Access token', type: 'password', required: true, description: 'Use your integration token.' },
  { key: 'limit', label: 'Limit', type: 'number', required: true, default: 0 },
  { key: 'flag', label: 'Include archived', type: 'boolean', required: true },
  { key: 'choice', label: 'Dataset', type: 'multi-select', required: true, options: [{ label: 'First', value: 'first' }, { label: 'Second', value: 'second' }] },
];

describe('integration configuration form', () => {
  it('does not close a replacement editor when an older save completes', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const close = vi.fn();
    const values = { token: 'fictional-token', choice: 'first' };
    const old = render(<IntegrationConfigForm fields={fields} values={values} onSave={save} onCancel={close} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    old.unmount();
    render(<IntegrationConfigForm fields={fields} values={values} onSave={vi.fn()} onCancel={close} />);
    await user.type(screen.getByLabelText(/^Access token/), '-new-draft');
    await act(async () => resolve());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Access token/)).toHaveValue('fictional-token-new-draft');
  });

  it('associates required guidance with inputs and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<IntegrationConfigForm fields={fields} values={{}} onSave={save} onCancel={vi.fn()} />);
    expect(screen.getByRole('spinbutton', { name: 'Limit' })).toHaveValue(0);
    expect(screen.getByRole('switch', { name: 'Include archived' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const token = screen.getByLabelText(/^Access token/);
    expect(token).toHaveFocus();
    expect(token).toHaveAttribute('aria-invalid', 'true');
    expect(token).toHaveAccessibleDescription('Use your integration token. Access token is required.');
    expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveAccessibleDescription('Dataset is required.');
    expect(save).not.toHaveBeenCalled();
    await user.type(token, 'fictional-token');
    expect(token).not.toHaveAttribute('aria-invalid');
    await user.selectOptions(screen.getByRole('combobox'), 'first');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ token: 'fictional-token', limit: 0, flag: false, choice: 'first' });
  });

  it('does not replace a cleared value with a default and rejects whitespace', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<IntegrationConfigForm fields={fields} values={{ token: '   ', choice: 'first' }} onSave={save} onCancel={vi.fn()} />);
    await user.clear(screen.getByRole('spinbutton'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
    expect(screen.getByRole('spinbutton')).toHaveAccessibleDescription('Limit is required.');
    expect(screen.getByLabelText(/^Access token/)).toHaveFocus();
  });

  it('preserves imported multi-select arrays without flattening them', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<IntegrationConfigForm fields={fields} values={{ token: 'fictional', flag: false, limit: 0, choice: ['first', 'second'] }} onSave={save} onCancel={vi.fn()} />);
    expect(screen.getByRole('listbox', { name: 'Dataset' })).toHaveValue(['first', 'second']);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ choice: ['first', 'second'] }));
  });

  it('retains inputs on async save failure, prevents duplicate submits and hides secret error details', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const cancel = vi.fn();
    render(<IntegrationConfigForm fields={fields} values={{ token: 'fictional-secret', choice: 'first' }} onSave={save} onCancel={cancel} />);
    await user.dblClick(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText(/^Access token/)).toBeDisabled();
    await act(async () => reject(new Error('Storage error with fictional-secret')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save configuration');
    expect(screen.getByRole('alert')).not.toHaveTextContent('fictional-secret');
    expect(screen.getByLabelText(/^Access token/)).toHaveValue('fictional-secret');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
