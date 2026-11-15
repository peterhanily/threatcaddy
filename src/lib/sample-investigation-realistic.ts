import type { EvidenceItem, Note, StandaloneIOC, Task, TimelineEvent } from '../types';
import type { generateSampleInvestigation } from './sample-investigation';

export type SampleInvestigationKind = 'realistic' | 'parody';
export const REALISTIC_SAMPLE_FOLDER_ID = 'sample-realistic-investigation';

/** Keep removal of either demo scoped to that demo, including its global tags/templates. */
export function isSampleEntityForKind(id: string, kind: SampleInvestigationKind): boolean {
  return kind === 'realistic'
    ? id.startsWith('sample-realistic-')
    : id.startsWith('sample-') && !id.startsWith('sample-realistic-');
}

/** Offline training data only: reserved network identifiers, no provider output or active agents. */
export function generateRealisticInvestigation(): ReturnType<typeof generateSampleInvestigation> {
  const base = Date.UTC(2026, 10, 10, 9);
  const minute = 60_000;
  const id = (kind: string, n: number) => `sample-realistic-${kind}-${n}`;
  const folderId = REALISTIC_SAMPLE_FOLDER_ID;
  const timelineId = id('timeline', 1);
  const common = { folderId, tags: ['synthetic-training'], archived: false, trashed: false,
    createdAt: base, updatedAt: base + 180 * minute, clsLevel: 'TLP:CLEAR' };
  const titles = [
    'START HERE — Mailbox Compromise Exercise',
    'Authentication Evidence — Mailbox Exercise',
    'Mailbox Audit Evidence — Mailbox Exercise',
    'Assessment and Gaps — Mailbox Exercise',
    'Containment Checklist — Mailbox Exercise',
    'Draft Incident Report — Mailbox Exercise',
  ];
  const bodies = [
    `# Mailbox Compromise Exercise

**SYNTHETIC TRAINING DATA.** Example Cooperative, all people, events and logs are fictional. Addresses use reserved example domains and documentation IP ranges. Do not block, enrich or contact these indicators. No external provider was queried and no agent is running.

## Your first investigation, in about 15 minutes
1. Read [[Authentication Evidence — Mailbox Exercise]] and [[Mailbox Audit Evidence — Mailbox Exercise]]. The matching source excerpts are in Evidence.
2. Open Timeline to compare the six recorded events in UTC. Each event links back to the supporting note; distinguish a log fact from an inference.
3. Open IOCs to inspect the three training indicators and their evidence links. No reputation verdict is claimed.
4. Read [[Assessment and Gaps — Mailbox Exercise]], then use Tasks and [[Containment Checklist — Mailbox Exercise]] to track the remaining work.
5. Review [[Draft Incident Report — Mailbox Exercise]]. Edit its confidence, scope and open questions; use the note's Download as Markdown control to export the report. This does not require AI.
6. Use Save Backup to download a portable copy, then test Load Backup in a separate browser profile. A report is not a complete backup; the ordinary JSON backup contains readable data, so store it securely.

## Start your own case
Create an investigation from Investigations, then import authorized source files using the header Import action or write a note. Preserve source context in Evidence, record uncertainty and link observations before drafting a report. AI assistance is optional and requires your configured provider; review what you send first.

The separate FERMENTED PERSISTENCE parody remains available in Settings. Removing this demo does not remove that case.`,
    `# Authentication evidence

**Synthetic excerpt — not a real identity-provider export.** Source: Evidence / authentication-example.csv. All timestamps UTC on 2026-11-10.

| Time | User | Source IP | Result | Context |
|---|---|---|---|---|
| 09:00 | analyst@example.test | 192.0.2.10 | Success | Known training workstation |
| 09:14 | analyst@example.test | 198.51.100.24 | Success | Previously unseen training address; existing session |
| 09:18 | analyst@example.test | 198.51.100.24 | Success | Mailbox access recorded |

The supplied excerpt records a successful session from an unfamiliar address. It does **not** establish geography, who controlled the session, how credentials were obtained or whether MFA was bypassed. "Existing session" alone is not proof of token theft.

Correlate with [[Mailbox Audit Evidence — Mailbox Exercise]], then record alternative explanations in [[Assessment and Gaps — Mailbox Exercise]].`,
    `# Mailbox audit evidence

**Synthetic excerpt — not a real mail-system export.** Source: Evidence / mailbox-audit-example.csv. All timestamps UTC on 2026-11-10.

| Time | Operation | Detail |
|---|---|---|
| 09:20 | Inbox rule created | Forward mail to archive@review-mail.example |
| 09:26 | User report | User states the forwarding rule was not authorized |
| 09:31 | Containment | Sessions revoked and forwarding rule removed in the exercise |

The forwarding rule and user report support suspected account misuse. The excerpt contains no delivery or message-access records proving which messages left the mailbox. Do not convert a forwarding configuration into a confirmed data-loss count.

Linked context: [[Authentication Evidence — Mailbox Exercise]] and [[Assessment and Gaps — Mailbox Exercise]].`,
    `# Assessment and gaps

**Working hypothesis:** an unauthorized session created an external forwarding rule. Confidence: medium within this fictional exercise, based on correlated sign-in and mailbox-audit excerpts plus the simulated user report.

## Observed versus unknown
- Observed: a successful session from 198.51.100.24 and a forwarding rule targeting archive@review-mail.example.
- Observed: the simulated user denied authorizing the rule; simulated containment followed.
- Unknown: initial access method, complete session history, messages accessed or delivered, other affected accounts and any actor identity.
- Alternative to test: an authorized application or administrator created the rule without the user's knowledge. Obtain change records and actor/application identifiers before rejecting this explanation.

## Next evidence requests
Obtain complete sign-in and mailbox audit logs, delivery traces and authorized change records for a bounded time window. Record collection times, source, timezone and access limits. Keep originals in an approved evidence store and record integrity hashes when actually computed; this demo supplies excerpts only and claims no custody or forensic hash verification.

Track actions in [[Containment Checklist — Mailbox Exercise]]. Carry the uncertainty into [[Draft Incident Report — Mailbox Exercise]].`,
    `# Containment checklist

**Exercise only — no real account changes have been made.** Tasks show a mix of completed simulated steps and pending analyst work.

- Completed in the scenario: revoke active sessions, remove the unauthorized forwarding rule and preserve the supplied audit excerpts.
- Pending: collect complete audit/delivery records and establish whether messages were forwarded.
- Pending: review account recovery/MFA configuration and obtain an authorized owner approval for recovery.
- Pending: peer-review [[Draft Incident Report — Mailbox Exercise]], including the unresolved scope and alternative explanation.

For a real case, record who authorized and performed each containment step, its timestamp and outcome. Do not mark remediation complete merely because this sample includes a checked task.`,
    `# Draft incident report — mailbox compromise exercise

**SYNTHETIC / TRAINING / DRAFT.** Prepared from the fictional source excerpts linked below. This is an example analyst report, not an automatically validated finding.

## Executive summary
On 2026-11-10, an unfamiliar successful session for analyst@example.test preceded an external mailbox-forwarding rule. The simulated user denied authorizing the rule. The scenario records session revocation and rule removal at 09:31 UTC. Suspected account misuse has medium confidence; the amount of exposed data and initial access method remain unknown.

## Scope and evidence
One training mailbox; six timeline events spanning 09:00–09:31 UTC. Sources: [[Authentication Evidence — Mailbox Exercise]] and [[Mailbox Audit Evidence — Mailbox Exercise]]. These are short excerpts, not complete logs. No live enrichment, malware execution or external AI analysis was performed.

## Findings and limitations
See [[Assessment and Gaps — Mailbox Exercise]]. A forwarding rule is evidence of configuration, not proof that a specific message was delivered externally. Actor attribution and legal notification requirements have not been assessed.

## Actions and next decision
See [[Containment Checklist — Mailbox Exercise]]. The exercise owner should review complete logs and approve recovery criteria before closing the case. Peer review and data-exposure scoping remain open tasks.

## Handoff
Replace this draft with your reviewed assessment. Download this note as Markdown for the report; use Save Backup separately for the full workspace and verify restoration in a fresh browser profile. Do not distribute the report as a real incident.`,
  ];
  const notes: Note[] = titles.map((title, i) => ({ ...common, id: id('note', i + 1), title,
    content: bodies[i], pinned: i === 0, linkedNoteIds: titles.flatMap((target, n) =>
      bodies[i].includes(`[[${target}]]`) ? [id('note', n + 1)] : []) }));
  const tasks: Task[] = [
    { title: 'Record simulated session revocation and rule removal', status: 'done', note: 5 },
    { title: 'Collect complete audit and delivery records', status: 'in-progress', note: 4 },
    { title: 'Review account recovery configuration with owner', status: 'todo', note: 5 },
    { title: 'Peer-review the draft report and unresolved scope', status: 'todo', note: 6 },
  ].map((task, i) => ({ ...common, id: id('task', i + 1), title: task.title,
    description: 'Synthetic exercise action. Review the linked note before changing status.',
    priority: 'medium', status: task.status as Task['status'], completed: task.status === 'done', order: i,
    linkedNoteIds: [id('note', task.note)], ...(task.status === 'done' ? { completedAt: base + 31 * minute } : {}) }));
  const eventSpecs: Array<[number, string, TimelineEvent['eventType'], number]> = [
    [0, 'Known workstation sign-in (synthetic)', 'evidence', 2],
    [14, 'Successful session from unfamiliar training address', 'evidence', 2],
    [18, 'Mailbox session recorded in supplied excerpt', 'evidence', 2],
    [20, 'External forwarding rule created', 'persistence', 3],
    [26, 'Simulated user denies authorizing the rule', 'detection', 3],
    [31, 'Simulated sessions revoked and rule removed', 'containment', 5],
  ];
  const timelineEvents: TimelineEvent[] = eventSpecs.map(([offset, title, eventType, note], i) => ({
    ...common, id: id('event', i + 1), timestamp: base + offset * minute, title, eventType,
    source: 'Synthetic training excerpt', confidence: 'medium', linkedIOCIds: [id('ioc', i === 0 ? 3 : i >= 3 ? 2 : 1)],
    linkedNoteIds: [id('note', note)], linkedTaskIds: i === 5 ? [id('task', 1)] : [],
    mitreAttackIds: [], assets: ['analyst@example.test'], starred: false, timelineId,
    description: 'Fictional exercise record. See the linked note for source limits; no live event was collected.',
  }));
  const iocSpecs: Array<[StandaloneIOC['type'], string, string, number]> = [
    ['ipv4', '198.51.100.24', 'Unfamiliar session address within the exercise; documentation-only IP, not a real threat verdict.', 1],
    ['email', 'archive@review-mail.example', 'Forwarding destination within the exercise; reserved domain, no delivered messages established.', 2],
    ['ipv4', '192.0.2.10', 'Known workstation baseline within the exercise; retained as context, not a malicious indicator.', 1],
  ];
  const standaloneIOCs: StandaloneIOC[] = iocSpecs.map(([type, value, analystNotes, evidence], i) => ({
    ...common, id: id('ioc', i + 1), type, value, analystNotes, confidence: 'low',
    linkedNoteIds: [id('note', evidence + 1)], linkedEvidenceIds: [id('evidence', evidence)],
  }));
  const sourceTexts = [
    'timestamp_utc,user,source_ip,result,context\n2026-11-10T09:00:00Z,analyst@example.test,192.0.2.10,success,known training workstation\n2026-11-10T09:14:00Z,analyst@example.test,198.51.100.24,success,existing session\n2026-11-10T09:18:00Z,analyst@example.test,198.51.100.24,success,mailbox access',
    'timestamp_utc,operation,detail\n2026-11-10T09:20:00Z,rule_created,forward to archive@review-mail.example\n2026-11-10T09:26:00Z,user_report,rule not authorized\n2026-11-10T09:31:00Z,containment,sessions revoked and rule removed',
  ];
  const evidenceItems: EvidenceItem[] = sourceTexts.map((content, i) => ({ ...common,
    id: id('evidence', i + 1), title: `Synthetic source — ${i === 0 ? 'authentication' : 'mailbox audit'}`,
    fileName: i === 0 ? 'authentication-example.csv' : 'mailbox-audit-example.csv', fileType: 'text',
    mimeType: 'text/csv', content, size: content.length, extractionStatus: 'extracted',
    extractionWarning: 'Generated training excerpt, not an imported original or verified forensic acquisition.',
    importedAt: base + 40 * minute, chunkIndex: 0, chunkCount: 1,
    linkedIOCIds: i === 0 ? [id('ioc', 1), id('ioc', 3)] : [id('ioc', 2)],
  }));
  return {
    folder: { id: folderId, name: 'Mailbox Compromise — Synthetic Exercise',
      description: 'Fictional mailbox incident: review evidence, compare a timeline, track containment and export a qualified report. Reserved identifiers only; no external services or active agents.',
      order: 998, status: 'active', localOnly: true, timelineId, createdAt: base, updatedAt: base + 180 * minute,
      clsLevel: 'TLP:CLEAR', tags: ['synthetic-training'] },
    notes, tasks, timelineEvents, standaloneIOCs, evidenceItems,
    timeline: { id: timelineId, name: 'Mailbox Exercise — UTC', order: 0, createdAt: base, updatedAt: base },
    whiteboard: { ...common, id: id('whiteboard', 1), name: 'Mailbox Exercise — Analysis Workspace', order: 0, elements: '[]' },
    tags: [{ id: id('tag', 1), name: 'synthetic-training', color: '#6366f1' }],
    chatThreads: [], noteTemplates: [],
  };
}
