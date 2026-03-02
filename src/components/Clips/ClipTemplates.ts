export type TemplateCategory = 'General' | 'Investigation' | 'Cloud';

export interface ClipTemplate {
  name: string;
  icon: string;
  content: string;
  category: TemplateCategory;
}

export const CLIP_TEMPLATES: ClipTemplate[] = [
  {
    name: 'Article',
    icon: '📰',
    category: 'General',
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
  },
  {
    name: 'Bookmark',
    icon: '🔗',
    category: 'General',
    content: `# Bookmark

**URL:** [Link](url)
**Category:**
**Tags:**

## Description

## Why it's useful

`,
  },
  {
    name: 'Code Snippet',
    icon: '💻',
    category: 'General',
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
  },
  {
    name: 'Quote',
    icon: '💬',
    category: 'General',
    content: `# Quote

> "Quote text here"

**— Author**

**Source:**
**Context:**

## Reflection

`,
  },
  {
    name: 'Meeting Notes',
    icon: '📋',
    category: 'General',
    content: `# Meeting Notes

**Date:** ${new Date().toLocaleDateString()}
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
  },
  {
    name: 'Host/Endpoint Details',
    icon: '🖥️',
    category: 'Investigation',
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
  },
  {
    name: 'Cloud Account Details',
    icon: '☁️',
    category: 'Cloud',
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
  },
  {
    name: 'User Account Details',
    icon: '👤',
    category: 'Investigation',
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
  },
  {
    name: 'Malware Sample',
    icon: '🦠',
    category: 'Investigation',
    content: `# Malware Sample

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
  },
  {
    name: 'OCI User Details',
    icon: '🔑',
    category: 'Cloud',
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
  },
  {
    name: 'OCI Tenancy Details',
    icon: '🏢',
    category: 'Cloud',
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
  },
];
