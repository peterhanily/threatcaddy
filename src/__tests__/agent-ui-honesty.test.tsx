/**
 * B-UI: the agent inbox and policy editor say what the runtime does: where an
 * action reaches, which agents still ask, who is paused, and what "Approve
 * all" will and will not run.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type AgentAction, type AgentDeployment, type Folder, type Settings } from '../types';
import { AgentActionCard } from '../components/Agent/AgentActionCard';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { loadAgentPolicy } from '../lib/agent-profile-resolver';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';

vi.mock('../components/Agent/AgentProfilePicker', () => ({ AgentProfilePicker: () => null }));
vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const settings = { llmLocalEndpoint: 'http://localhost:11434' } as Settings;
const action = (values: Partial<AgentAction>): AgentAction => ({ id: `action-${values.toolName}`, investigationId: 'S', threadId: 't', toolName: 'create_note',
  toolInput: {}, rationale: 'Proposed by the agent', status: 'pending', createdAt: 1, ...values });
const deployment = (profileId: string, investigationId = 'S'): AgentDeployment => ({ id: `dep-${profileId}`, investigationId, profileId, status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
const folder = async (id: string) => await db.folders.get(id) as Folder;
const renderPanel = async (selected: Folder, deployments: AgentDeployment[]) => {
  const view = render(<AgentPanel folder={selected} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={deployments} />);
  await act(async () => {});
  return view;
};

beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); });
afterEach(cleanup);

describe('B-UI-1 action cards name the action class and where it reaches', () => {
  it('a fetch proposal is labelled Fetch with its destination host and the agent\'s reason', () => {
    render(<AgentActionCard action={action({ toolName: 'fetch_url', toolInput: { url: 'https://collector.example/c?d=1' } })} />);
    expect(screen.getByText('Fetch')).toBeInTheDocument();
    expect(screen.getByText('Sends to: collector.example')).toBeInTheDocument();
    expect(screen.getByText('Agent\'s reason:')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('enrichment, skills and delegation say what they are', () => {
    render(<>
      <AgentActionCard action={action({ toolName: 'enrich_ioc', toolInput: { iocId: ids('S').ioc } })} />
      <AgentActionCard action={action({ toolName: 'host:soc1:scan', status: 'executed' })} />
      <AgentActionCard action={action({ toolName: 'delegate_task', status: 'failed' })} />
    </>);
    expect(screen.getByText('Sends to: vendor lookups')).toBeInTheDocument();
    expect(screen.getByText('Sends to: soc1')).toBeInTheDocument();
    expect(screen.getByText('Delegate')).toBeInTheDocument();
    expect(screen.getByText('Executed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

describe('B-UI-2 the policy editor shows the ceiling and who still asks', () => {
  it('renders translated, honest labels and the "asks before" line for Threat Hunter under a folder that turns creates off', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    await renderPanel(await folder('S'), [deployment('ap-threat-hunter')]);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle agent settings' }));
    expect(await screen.findByText('Threat Hunter asks before: Create, Modify')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Auto-approve Fetch: Reference sites only/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Auto-approve Enrich: .*vendor/i })).toBeInTheDocument();
    expect(screen.getByText(/limit every agent in this investigation/)).toBeInTheDocument();
  });

  it('notifies once when a folder policy lowers a deployed builtin, and remembers the dismissal', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    const view = await renderPanel(await folder('S'), [deployment('ap-threat-hunter')]);
    const notice = screen.getByText(/now limit/);
    expect(notice).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText(/now limit/)).not.toBeInTheDocument();
    view.unmount();
    await renderPanel(await folder('S'), [deployment('ap-threat-hunter')]);
    expect(screen.queryByText(/now limit/)).not.toBeInTheDocument();
  });

  it('shows no notice without an explicit folder policy', async () => {
    await renderPanel(await folder('S'), [deployment('ap-threat-hunter')]);
    expect(screen.queryByText(/now limit/)).not.toBeInTheDocument();
  });

  it('without a saved folder policy, the toggles are not presented as a limit until a change is saved', async () => {
    const view = await renderPanel(await folder('S'), [deployment('ap-threat-hunter')]);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle agent settings' }));
    // Threat Hunter creates on its own: nothing limits it yet.
    expect(await screen.findByText('Threat Hunter asks before: Modify')).toBeInTheDocument();
    expect(screen.queryByText(/limit every agent in this investigation/)).not.toBeInTheDocument();
    expect(screen.getByText(/No limit is saved for this investigation yet/)).toBeInTheDocument();
    // The toggles show what an investigation without deployed agents uses.
    const undeployed = await loadAgentPolicy('S');
    for (const [key, label] of [['autoApproveReads', 'Reads'], ['autoApproveEnrich', 'Enrich'], ['autoApproveFetch', 'Fetch'], ['autoApproveCreate', 'Create'], ['autoApproveModify', 'Modify']] as const) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^Auto-approve ${label}:`) })).toHaveAttribute('aria-checked', String(undeployed[key]));
    }

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /^Auto-approve Reads:/ })); });
    view.rerender(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[deployment('ap-threat-hunter')]} />);
    expect(await screen.findByText(/limit every agent in this investigation/)).toBeInTheDocument();
    expect(screen.queryByText(/No limit is saved/)).not.toBeInTheDocument();
  });
});

describe('agent panel review state', () => {
  it('names the agent waiting for review and says the others keep working', async () => {
    await db.agentActions.add(action({ toolName: 'fetch_url', agentConfigId: 'ap-threat-hunter', toolInput: { url: 'https://collector.example/' } }));
    await renderPanel(await folder('S'), [deployment('ap-threat-hunter'), deployment('ap-lead-analyst')]);
    expect(await screen.findByText('Threat Hunter is waiting for your review. Other agents keep working.')).toBeInTheDocument();
    expect(screen.queryByText(/Lead Analyst is waiting/)).not.toBeInTheDocument();
  });

  it('approve all counts routine rows and reports the rest', async () => {
    await db.agentActions.bulkAdd([
      action({ id: 'routine', toolName: 'create_note', toolInput: { title: 'Summary', content: 'Done' } }),
      action({ id: 'egress', toolName: 'fetch_url', toolInput: { url: 'https://collector.example/' } }),
    ]);
    await renderPanel(await folder('S'), []);
    fireEvent.click(await screen.findByRole('button', { name: /approve all/i }));
    expect(await screen.findByText('Execute 1?')).toBeInTheDocument();
    expect(screen.getByText('Left for individual review: 1')).toBeInTheDocument();
  });

  it('a cross-case profile in a shareable investigation says its cross-case tools are off', async () => {
    const view = await renderPanel(await folder('S'), [deployment('ap-pattern-hunter')]);
    fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));
    expect(await screen.findByText(/Cross-investigation tools are off/)).toBeInTheDocument();
    view.unmount();
    await renderPanel(await folder('L2'), [deployment('ap-pattern-hunter', 'L2')]);
    fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));
    await act(async () => {});
    expect(screen.queryByText(/Cross-investigation tools are off/)).not.toBeInTheDocument();
  });
});
