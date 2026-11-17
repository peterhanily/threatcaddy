# ThreatCaddy — Claude Desktop (MCP Server)

Future: MCP server that exposes the ThreatCaddy agent bridge's 33 tools (see [`../claude-code/SKILL.md`](../claude-code/SKILL.md)) for Claude Desktop.

## Status

Not yet implemented. See `../claude-code/` for the CDP-based approach that works today.

## Planned Architecture

```
Claude Desktop ←stdio→ MCP Server (Node.js) ←WebSocket→ Browser App (IndexedDB)
```
