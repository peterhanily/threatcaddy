/**
 * A4: the agent inbox tells the truth, in the analyst's language: which
 * lookups an enrichment proposal sends the IOC to, the whole input a proposal
 * sends, why a proposal failed, and the panel's own labels.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfilePicker } from '../components/Agent/AgentProfilePicker';
import { FORENSICATE_AGENT_PROFILE } from '../lib/forensicate-tool';
import { seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';
import i18n from '../i18n';
import deAgent from '../../public/locales/de/agent.json';
import deTasks from '../../public/locales/de/tasks.json';

vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });
const de = deAgent as Record<string, string>;

async function inGerman() {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'agent', deAgent, true, true);
  i18n.addResourceBundle('de', 'tasks', deTasks, true, true);
  await i18n.changeLanguage('de');
}

let egress: EgressSpy;
beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); egress = installEgressSpy(['llm_streaming', 'fetch_url']); });
afterEach(async () => {
  cleanup();
  egress.restore();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('A4-1 the Forensicate Scanner says what leaves the device', () => {
  // The sentence each language used to end with: nothing leaves this device.
  const NOTHING_LEAVES: Record<string, string> = {
    ar: 'لا يغادر أي شيء هذا الجهاز', de: 'Nichts verlässt dieses Gerät', en: 'Nothing leaves this device', es: 'Nada sale de este dispositivo',
    fa: 'هیچ چیزی از این دستگاه خارج نمی‌شود', fr: 'Rien ne quitte cet appareil', he: 'שום דבר לא יוצא מהמכשיר הזה',
    hi: 'इस डिवाइस से कुछ भी बाहर नहीं जाता', id: 'Tidak ada yang keluar dari perangkat ini', it: 'Nulla lascia questo dispositivo',
    ja: 'このデバイスから何も送信されません', ko: '이 기기 밖으로 아무것도 전송되지 않습니다', nl: 'Er verlaat niets dit apparaat',
    pl: 'Nic nie opuszcza tego urządzenia', 'pt-BR': 'Nada sai deste dispositivo', ru: 'Ничего не покидает это устройство',
    th: 'ไม่มีข้อมูลใดออกจากอุปกรณ์นี้', tr: 'Bu cihazdan hiçbir şey çıkmaz', uk: 'Ніщо не залишає цей пристрій',
    vi: 'Không có gì rời khỏi thiết bị này', 'zh-CN': '任何数据都不会离开此设备',
  };

  it('no language still says nothing leaves this device', () => {
    const descriptions = Object.fromEntries(Object.entries(agentCatalogs).map(([path, catalog]) =>
      [path.split('/').at(-2) as string, catalog.default['builtinProfile.forensicateScanner.descriptionV2']]));
    expect(Object.keys(descriptions).sort()).toEqual(Object.keys(NOTHING_LEAVES).sort());
    for (const [lng, text] of Object.entries(descriptions)) {
      expect(text, lng).toBeTruthy();
      expect(text, lng).not.toContain(NOTHING_LEAVES[lng]);
    }
  });

  it('the picker says the check is local and the agent sends what it reads to the AI model', async () => {
    expect(FORENSICATE_AGENT_PROFILE.description).toBe('Basic check of investigation content for common prompt-injection patterns. '
      + 'The check runs on this device; like every agent, it sends what it reads to your AI model.');
    await inGerman();
    render(<AgentProfilePicker profiles={[FORENSICATE_AGENT_PROFILE]} deployments={[]} onDeployMultiple={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTitle(title => title.endsWith(`: ${de['builtinProfile.forensicateScanner.descriptionV2']}`))).toBeInTheDocument();
  });
});

describe('A4 catalogs', () => {
  it('German translates the Forensicate Scanner description', () => {
    expect(de['builtinProfile.forensicateScanner.descriptionV2']).not.toBe(FORENSICATE_AGENT_PROFILE.description);
  });
});
