/**
 * C2-4: tool names and raw JSON on the chat approval card and the agent action card read
 * left to right in RTL languages, so braces are not mirrored.
 * C2-5: the agent action card's expand button is named without a stray placeholder.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAction } from '../types';
import type { ApprovalItem } from '../lib/chat-tool-executor';
import { ChatApprovalCard } from '../components/Chat/ChatApprovalCard';
import { AgentActionCard } from '../components/Agent/AgentActionCard';

const agentCatalogs = import.meta.glob<{ default: Record<string, unknown> }>('../../public/locales/*/agent.json', { eager: true });
const action = (values: Partial<AgentAction>): AgentAction => ({ id: 'action-1', investigationId: 'S', threadId: 't', toolName: 'create_note',
  toolInput: { title: 'Synthetic' }, rationale: 'Proposed by the agent', status: 'executed', resultSummary: '{"id":"n1"}', createdAt: 1, ...values });
const item: ApprovalItem = { toolUse: { type: 'tool_use', id: 'call-1', name: 'fetch_url', input: { url: 'https://collector.example/a' } },
  reason: 'egress', readForeignThisRequest: false,
  reach: { name: 'fetch_url', write: false, homeShareable: false, crossRead: false, crossWrite: false, targetFolderIds: [],
    hidden: false, egress: 'open-fetch', destinations: ['collector.example'], harvested: false, flags: [] } };

afterEach(cleanup);

describe('C2-4 raw tool input reads left to right in RTL languages', () => {
  it('the chat approval card\'s tool name and Details JSON are LTR', () => {
    render(<ChatApprovalCard item={item} index={1} total={1} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText('fetch_url')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/"url": "https:\/\/collector\.example\/a"/)).toHaveAttribute('dir', 'ltr');
  });

  it('the agent action card\'s input and result blocks are LTR', () => {
    render(<AgentActionCard action={action({})} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/"title": "Synthetic"/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('{"id":"n1"}')).toHaveAttribute('dir', 'ltr');
  });
});

describe('C2-5 the agent action card\'s expand button has a clean name', () => {
  it('names the tool and the action, with no placeholder left over', () => {
    render(<AgentActionCard action={action({ toolName: 'fetch_url', toolInput: { url: 'https://collector.example/a' } })} />);
    // A string name matches the whole accessible name.
    fireEvent.click(screen.getByRole('button', { name: 'Expand fetch_url action details' }));
    expect(screen.getByRole('button', { name: 'Collapse fetch_url action details' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('every language fills only {{toolName}}', () => {
    const placeholders = Object.fromEntries(Object.entries(agentCatalogs).map(([path, catalog]) => [path.split('/').at(-2),
      ['action.expandAction', 'action.collapseAction'].map(key => String(catalog.default[key]).match(/\{\{\w+\}\}/g))]));
    expect(Object.keys(placeholders)).toHaveLength(21);
    expect(placeholders).toEqual(Object.fromEntries(Object.keys(placeholders).map(lng => [lng, [['{{toolName}}'], ['{{toolName}}']]])));
  });
});
