import { describe, expect, it } from 'vitest';
import { validatePortableTables } from '../lib/backup-records';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { BUILTIN_NOTE_TEMPLATES } from '../lib/builtin-templates';
import { BUILTIN_PLAYBOOKS } from '../lib/builtin-playbooks';
import { generateSampleInvestigation } from '../lib/sample-investigation';

describe('backup compatibility with application-generated data', () => {
  it('accepts every shipped template/profile without executing integrations or changing their contents', () => {
    const data = JSON.parse(JSON.stringify({ integrationTemplates: BUILTIN_INTEGRATIONS,
      agentProfiles: BUILTIN_AGENT_PROFILES, noteTemplates: BUILTIN_NOTE_TEMPLATES, playbookTemplates: BUILTIN_PLAYBOOKS }));
    const before = JSON.stringify(data);
    expect(() => validatePortableTables(data)).not.toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('accepts the complete built-in synthetic investigation, including its nested records', () => {
    const sample = generateSampleInvestigation();
    const data = { folders: [sample.folder], notes: sample.notes, tasks: sample.tasks, timelineEvents: sample.timelineEvents,
      timelines: [sample.timeline], standaloneIOCs: sample.standaloneIOCs, whiteboards: [sample.whiteboard], tags: sample.tags,
      chatThreads: sample.chatThreads, evidenceItems: sample.evidenceItems, noteTemplates: sample.noteTemplates };
    const before = JSON.stringify(data);
    expect(() => validatePortableTables(data)).not.toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });
});
