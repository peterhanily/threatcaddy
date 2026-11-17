---
name: threatcaddy
description: Read and write data in a live ThreatCaddy investigation session via Chrome DevTools Protocol
---

# ThreatCaddy

Interact with a live ThreatCaddy investigation session running in Chrome. Create notes, IOCs, timeline events, tasks, and more — directly from your AI coding agent.

## Prerequisites

- Chrome launched with `--remote-debugging-port=9222` (recommended, no popups)
  - macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
  - Alternative: `chrome://inspect/#remote-debugging` → toggle on (shows allow popup each time)
- ThreatCaddy open in a Chrome tab with an investigation selected
- The agent bridge turned on in ThreatCaddy under Settings → AI (it is off by default)
- Node.js 22+

## Commands

All commands use `scripts/tc.mjs`. The first command spawns a background daemon that holds the Chrome CDP session open. Chrome's "Allow debugging" popup fires once; all subsequent commands reuse the session silently. The daemon auto-exits after 20 minutes idle.

### Check connection

```bash
scripts/tc.mjs status
```

### List investigations

```bash
scripts/tc.mjs investigations
```

### Show the active investigation

The bridge works only in the investigation selected in ThreatCaddy. Select it in the app, then check it:

```bash
scripts/tc.mjs folder
```

### Execute a tool

```bash
scripts/tc.mjs exec <tool_name> '<json_input>'
```

### Stop the daemon

```bash
scripts/tc.mjs stop
```

## Available Tools (23)

Web, enrichment and cross-investigation tools are not available through the bridge.

### Search & Read (10 tools)

- **search_notes** — `{"query": "malware"}` — Search notes by keyword
- **search_all** — `{"query": "apt29"}` — Search across all entity types
- **read_note** — `{"id": "..."}` or `{"title": "..."}` — Get full note content
- **read_task** — `{"id": "..."}` or `{"title": "..."}` — Get full task details
- **read_ioc** — `{"id": "..."}` or `{"value": "10.0.0.1"}` — Get full IOC details
- **read_timeline_event** — `{"id": "..."}` or `{"title": "..."}` — Get full event details
- **list_tasks** — `{"status": "todo"}` — List tasks, optional status filter
- **list_iocs** — `{"type": "ipv4"}` — List IOCs, optional type filter
- **list_timeline_events** — `{"eventType": "initial-access"}` — List events
- **get_investigation_summary** — `{}` — Get entity counts and metadata

### Create & Update (11 tools)

- **create_note** — `{"title": "Finding", "content": "# Details"}`
- **update_note** — `{"id": "...", "appendContent": "New paragraph"}`
- **create_task** — `{"title": "Review logs", "priority": "high", "status": "todo"}`
- **update_task** — `{"id": "...", "status": "done"}`
- **create_ioc** — `{"type": "ipv4", "value": "10.0.0.1", "confidence": "high", "analystNotes": "C2 server"}`
- **update_ioc** — `{"id": "...", "confidence": "confirmed", "attribution": "APT29"}`
- **bulk_create_iocs** — `{"iocs": [{"type": "ipv4", "value": "10.0.0.1"}, {"type": "domain", "value": "evil.com"}]}`
- **create_timeline_event** — `{"title": "Phishing email", "timestamp": "2025-06-15T14:00:00Z", "eventType": "initial-access"}`
- **update_timeline_event** — `{"id": "...", "actor": "APT29"}`
- **link_entities** — `{"links": [{"sourceType": "note", "sourceId": "...", "targetType": "task", "targetId": "..."}]}`
- **generate_report** — `{"executiveSummary": "...", "findings": "..."}`

### Analysis (2 tools)

- **extract_iocs** — `{"text": "Found IP 10.0.0.1 and domain evil.com"}` — Extract IOCs from text
- **analyze_graph** — `{}` — Analyze entity relationship graph

## IOC Types

`ipv4`, `ipv6`, `domain`, `url`, `email`, `md5`, `sha1`, `sha256`, `cve`, `mitre-attack`, `yara-rule`, `sigma-rule`, `file-path`

## Timeline Event Types

`initial-access`, `execution`, `persistence`, `privilege-escalation`, `defense-evasion`, `credential-access`, `discovery`, `lateral-movement`, `collection`, `exfiltration`, `command-and-control`, `impact`, `detection`, `containment`, `eradication`, `recovery`, `communication`, `evidence`, `other`

## Example Workflows

### Triage a threat report

```bash
# Extract IOCs from a threat report
scripts/tc.mjs exec extract_iocs '{"text": "The actor used 185.220.101.1 to deliver payload.exe (SHA256: abc123...) via phishing from updates.evil.com"}'

# Bulk create the IOCs
scripts/tc.mjs exec bulk_create_iocs '{"iocs": [{"type":"ipv4","value":"185.220.101.1","confidence":"high","analystNotes":"C2 server"},{"type":"domain","value":"updates.evil.com","confidence":"high","analystNotes":"Phishing infrastructure"}]}'

# Create timeline events
scripts/tc.mjs exec create_timeline_event '{"title":"Phishing email delivered","timestamp":"2025-06-15T09:00:00Z","eventType":"initial-access","source":"Email gateway"}'

# Create follow-up tasks
scripts/tc.mjs exec create_task '{"title":"Block C2 IP at firewall","priority":"high","status":"todo"}'
```

### Research and document

```bash
# Create a note with analysis findings
scripts/tc.mjs exec create_note '{"title":"APT29 Infrastructure Analysis","content":"# Infrastructure Mapping\n\nThe following C2 infrastructure was identified..."}'
```
