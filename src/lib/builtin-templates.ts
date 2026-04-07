import type { NoteTemplate } from '../types';
import i18n from '../i18n';

export const BUILTIN_NOTE_TEMPLATES: NoteTemplate[] = [
  // ─── General ──────────────────────────────────────────────────
  {
    id: 'bt-article',
    get name() { return i18n.t('builtinTemplate.article.name', { ns: 'notes' }); },
    icon: '\uD83D\uDCF0',
    get category() { return i18n.t('builtinTemplateCategory.general', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Article Title

**Source:** [Link](url)
**Author:**
**Date:**

## Summary

## Key Points

-
-
-

## Quotes

>

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-bookmark',
    get name() { return i18n.t('builtinTemplate.bookmark.name', { ns: 'notes' }); },
    icon: '\uD83D\uDD17',
    get category() { return i18n.t('builtinTemplateCategory.general', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Bookmark

**URL:** [Link](url)
**Category:**
**Tags:**

## Description

## Why it's useful

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-code-snippet',
    get name() { return i18n.t('builtinTemplate.codeSnippet.name', { ns: 'notes' }); },
    icon: '\uD83D\uDCBB',
    get category() { return i18n.t('builtinTemplateCategory.general', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Code Snippet

**Language:**
**Source:**

## Code

\`\`\`
// Paste code here
\`\`\`

## Explanation

## Usage

\`\`\`
// Example usage
\`\`\`
`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-meeting-notes',
    get name() { return i18n.t('builtinTemplate.meetingNotes.name', { ns: 'notes' }); },
    icon: '\uD83D\uDCCB',
    get category() { return i18n.t('builtinTemplateCategory.general', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Meeting Notes

**Date:**
**Attendees:**

## Agenda

1.
2.
3.

## Discussion

## Action Items

- [ ]
- [ ]
- [ ]

## Next Meeting

`,
    createdAt: 0,
    updatedAt: 0,
  },

  // ─── Investigation ────────────────────────────────────────────
  {
    id: 'bt-host-endpoint',
    get name() { return i18n.t('builtinTemplate.hostEndpoint.name', { ns: 'notes' }); },
    icon: '\uD83D\uDDA5\uFE0F',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Host/Endpoint Details

**Hostname:**
**IP Address(es):** x.x.x.x
**MAC Address:**
**OS / Version:**
**Domain / Workgroup:**
**Last Seen:**

## Logged-In Users

-

## Installed Software

| Software | Version |
|----------|---------|
|          |         |

## Running Processes

| PID | Process Name | User | Command Line |
|-----|-------------|------|-------------|
|     |             |      |             |

## Open Ports

| Port | Protocol | Service | State |
|------|----------|---------|-------|
|      |          |         |       |

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-user-account',
    get name() { return i18n.t('builtinTemplate.userAccount.name', { ns: 'notes' }); },
    icon: '\uD83D\uDC64',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# User Account Details

**Username:**
**Email:** user@domain.com
**Display Name:**
**Domain:**
**Role / Title:**
**Last Login:**
**MFA Status:** Enabled / Disabled

## Group Memberships

-

## Recent Activity

| Timestamp | Action | Source IP | Details |
|-----------|--------|----------|---------|
|           |        |          |         |

## Suspicious Indicators

-

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-malware-sample',
    get name() { return i18n.t('builtinTemplate.malwareSample.name', { ns: 'notes' }); },
    icon: '\uD83E\uDDA0',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Malware Sample Analysis

**Filename:**
**File Size:**
**File Type:**
**First Seen:**

## Hashes

**MD5:**
**SHA1:**
**SHA256:**

## C2 Infrastructure

| Type | Value | Port | Protocol |
|------|-------|------|----------|
| IP   |       |      |          |
| Domain |     |      |          |

## YARA Rule Hits

-

## Sandbox Analysis

**Sandbox URL:**
**Verdict:**

## MITRE ATT&CK Techniques

| ID | Technique | Tactic |
|----|-----------|--------|
|    |           |        |

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-phishing-report',
    get name() { return i18n.t('builtinTemplate.phishingReport.name', { ns: 'notes' }); },
    icon: '\uD83C\uDFA3',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Phishing Campaign Report

**Campaign Name:**
**Date Identified:**
**Classification:** TLP:AMBER

## Email Details

**Subject Line:**
**Sender Address:**
**Reply-To:**
**Sending IP:**
**SPF/DKIM/DMARC:**

## Payload

**URL(s):**
**Attachment(s):**
**Landing Page:**
**Credential Harvesting:** Yes / No

## Targeting

**Recipients (count):**
**Targeted Department(s):**
**Users Who Clicked:**
**Users Who Submitted Credentials:**

## Infrastructure

| Type | Value | Registration Date | Hosting |
|------|-------|-------------------|---------|
|      |       |                   |         |

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Containment Actions

- [ ] Blocked sender domain
- [ ] Blocked payload URLs
- [ ] Quarantined emails
- [ ] Reset compromised credentials
- [ ] Notified affected users

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-threat-actor',
    get name() { return i18n.t('builtinTemplate.threatActor.name', { ns: 'notes' }); },
    icon: '\uD83C\uDFAD',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Threat Actor Profile

**Name / Aliases:**
**Classification:** APT / Cybercrime / Hacktivist / Insider
**Country of Origin:**
**Active Since:**
**Confidence:** Low / Medium / High

## Diamond Model

**Adversary:**
**Capability:**
**Infrastructure:**
**Victim:**

## Motivation

-

## Known TTPs (MITRE ATT&CK)

| Tactic | Technique ID | Technique Name |
|--------|-------------|----------------|
|        |             |                |

## Known Infrastructure

| Type | Value | First Seen | Last Seen |
|------|-------|------------|-----------|
|      |       |            |           |

## Known Targets

| Sector | Geography | Campaign |
|--------|-----------|----------|
|        |           |          |

## References

-

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-hunt-hypothesis',
    get name() { return i18n.t('builtinTemplate.huntHypothesis.name', { ns: 'notes' }); },
    icon: '\uD83D\uDD2D',
    get category() { return i18n.t('builtinTemplateCategory.investigation', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Threat Hunt Hypothesis

**Hypothesis:**
**MITRE ATT&CK Mapping:**
**Priority:** High / Medium / Low
**Data Sources Required:**

## Background / Intelligence Basis

## Hunt Query / Logic

\`\`\`
// Query or detection logic here
\`\`\`

## Data Sources

| Source | Coverage | Retention |
|--------|----------|-----------|
|        |          |           |

## Expected Results

## Actual Findings

## False Positive Analysis

## Recommendations

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-ir-triage',
    get name() { return i18n.t('builtinTemplate.irTriage.name', { ns: 'notes' }); },
    icon: '\uD83D\uDEA8',
    get category() { return i18n.t('builtinTemplateCategory.incidentResponse', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Incident Response Triage

**Incident ID:**
**Date/Time Detected:**
**Reported By:**
**Severity:** Critical / High / Medium / Low
**Classification:** TLP:AMBER

## Initial Assessment

**Type:** Malware / Phishing / Unauthorized Access / Data Breach / DDoS / Other
**Affected Systems:**
**Affected Users:**
**Business Impact:**

## Triage Checklist

### Detection & Analysis
- [ ] Confirm incident is real (not false positive)
- [ ] Determine scope and affected assets
- [ ] Identify attack vector
- [ ] Collect initial IOCs
- [ ] Assign severity level

### Containment
- [ ] Isolate affected systems
- [ ] Block malicious IPs/domains
- [ ] Disable compromised accounts
- [ ] Preserve evidence (memory dumps, disk images)

### Communication
- [ ] Notify incident commander
- [ ] Update stakeholders
- [ ] Engage legal if data breach suspected
- [ ] Document all actions in timeline

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Timeline

| Time | Action | Actor | Details |
|------|--------|-------|---------|
|      |        |       |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-vuln-assessment',
    get name() { return i18n.t('builtinTemplate.vulnAssessment.name', { ns: 'notes' }); },
    icon: '\uD83D\uDEE1\uFE0F',
    get category() { return i18n.t('builtinTemplateCategory.incidentResponse', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Vulnerability Assessment

**CVE ID:**
**CVSS Score:**
**Severity:** Critical / High / Medium / Low
**Vendor Advisory:**

## Description

## Affected Systems

| Hostname | IP | OS/Version | Status |
|----------|----|------------|--------|
|          |    |            |        |

## Exploitation

**Exploit Available:** Yes / No
**Actively Exploited:** Yes / No
**Exploit Complexity:** Low / Medium / High

## Impact Analysis

**Confidentiality:**
**Integrity:**
**Availability:**
**Business Impact:**

## Remediation

**Patch Available:** Yes / No
**Patch ID:**
**Workaround:**

## Remediation Checklist

- [ ] Identify all affected systems
- [ ] Test patch in staging
- [ ] Deploy patch to production
- [ ] Verify remediation
- [ ] Update vulnerability scan

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-post-incident',
    get name() { return i18n.t('builtinTemplate.postIncident.name', { ns: 'notes' }); },
    icon: '\uD83D\uDCD3',
    get category() { return i18n.t('builtinTemplateCategory.incidentResponse', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Post-Incident Review

**Incident ID:**
**Incident Date:**
**Review Date:**
**Participants:**

## Incident Summary

## Timeline of Events

| Time | Event |
|------|-------|
|      |       |

## What Went Well

-

## What Could Be Improved

-

## Root Cause Analysis

## Detection Gap Analysis

**Time to Detect:**
**Time to Contain:**
**Time to Eradicate:**
**Time to Recover:**

## Action Items

| # | Action | Owner | Due Date | Status |
|---|--------|-------|----------|--------|
|   |        |       |          |        |

## Recommendations

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },

  // ─── Cloud ────────────────────────────────────────────────────
  {
    id: 'bt-cloud-account',
    get name() { return i18n.t('builtinTemplate.cloudAccount.name', { ns: 'notes' }); },
    icon: '\u2601\uFE0F',
    get category() { return i18n.t('builtinTemplateCategory.cloud', { ns: 'notes' }); },
    source: 'builtin',
    content: `# Cloud Account Details

**Provider:** AWS / Azure / GCP
**Account/Subscription ID:**
**Root Email:** user@domain.com
**Regions:**
**Environment:** Production / Staging / Development

## IAM Roles / Users

| Name | Type | Permissions | Last Active |
|------|------|-------------|-------------|
|      |      |             |             |

## Services In Use

-

## Access Keys

| Key ID | Created | Last Used | Status |
|--------|---------|-----------|--------|
|        |         |           |        |

## Suspicious Activity

-

## IOC Summary

| Type | Value | Context |
|------|-------|---------|
|      |       |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-oci-user',
    get name() { return i18n.t('builtinTemplate.ociUser.name', { ns: 'notes' }); },
    icon: '\uD83D\uDD11',
    get category() { return i18n.t('builtinTemplateCategory.cloud', { ns: 'notes' }); },
    source: 'builtin',
    content: `# OCI User Details

**User OCID:** ocid1.user.oc1..
**Tenancy:**
**Email:** user@domain.com
**Created:**
**Last Login:**

## Compartments

-

## Group Memberships

-

## API Keys

| Fingerprint | Created | Status |
|-------------|---------|--------|
|             |         |        |

## Auth Tokens

| Description | Created | Expires |
|-------------|---------|---------|
|             |         |         |

## Capabilities

- [ ] API Keys
- [ ] Auth Tokens
- [ ] SMTP Credentials
- [ ] Customer Secret Keys
- [ ] Console Access

## Recent Activity

| Timestamp | Action | Source IP | Details |
|-----------|--------|----------|---------|
|           |        |          |         |

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'bt-oci-tenancy',
    get name() { return i18n.t('builtinTemplate.ociTenancy.name', { ns: 'notes' }); },
    icon: '\uD83C\uDFE2',
    get category() { return i18n.t('builtinTemplateCategory.cloud', { ns: 'notes' }); },
    source: 'builtin',
    content: `# OCI Tenancy Details

**Tenancy OCID:** ocid1.tenancy.oc1..
**Tenancy Name:**
**Home Region:**
**Created:**

## Subscribed Regions

-

## Compartment Hierarchy

- Root
  -

## Key Policies

| Policy Name | Compartment | Statements |
|-------------|-------------|------------|
|             |             |            |

## Admin Users

| Username | Email | Last Login |
|----------|-------|------------|
|          |       |            |

## Budgets / Cost

| Budget Name | Amount | Actual Spend | Alert Threshold |
|-------------|--------|-------------|----------------|
|             |        |             |                |

## Connected Services

-

## Notes

`,
    createdAt: 0,
    updatedAt: 0,
  },
];

export const BUILTIN_TEMPLATE_CATEGORIES = [
  'General',
  'Investigation',
  'Incident Response',
  'Cloud',
] as const;
