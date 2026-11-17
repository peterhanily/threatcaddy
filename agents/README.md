# ThreatCaddy Agent Integrations

External AI agents can read and write data in a live ThreatCaddy session. The agent bridge offers 33 tools to search, create, update, analyze, and report in the investigation selected in ThreatCaddy; they are listed in [`claude-code/SKILL.md`](claude-code/SKILL.md). Web fetch, enrichment, cross-investigation and agent-lifecycle tools are not available through the bridge.

## How It Works

ThreatCaddy exposes `window.threatcaddy` in the browser. The bridge is off by default: turn on **Agent bridge** in ThreatCaddy under Settings → AI → Where AI data goes, and turn it off when you are done, because while it is on any script on the page can use it. AI agents connect via Chrome DevTools Protocol and call tools by evaluating JavaScript in the page context, passing the nonce ThreatCaddy publishes on `window.__tcNonce`. Tool calls read and write IndexedDB in the selected investigation and do not reach the network.

```
AI Agent → Chrome CDP → window.threatcaddy.exec(nonce, tool, input) → IndexedDB → result
```

## Available Integrations

| Agent | Directory | Status |
|-------|-----------|--------|
| **Claude Code** | `claude-code/` | Ready |
| **Claude Desktop** | `claude-desktop/` | Planned (MCP) |
| **OpenAI Codex** | `codex/` | Planned |

## Quick Start (Claude Code)

```bash
# 1. Enable Chrome remote debugging
#    chrome://inspect/#remote-debugging → toggle on

# 2. Open ThreatCaddy in Chrome, turn on Settings → AI → Agent bridge,
#    and select an investigation

# 3. Use the CLI
node agents/claude-code/scripts/tc.mjs status
node agents/claude-code/scripts/tc.mjs exec create_note '{"title":"Test","content":"Hello from Claude Code"}'
```
