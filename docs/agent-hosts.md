# Agent Hosts

An **agent host** is an external HTTP endpoint that ThreatCaddy agents can call as if it were a built-in tool. Hosts let you expose local services (a SOC workstation, a forensic VM, a custom LLM) as a list of named "skills" that show up in the LLM's tool surface and obey the same policy gates as everything else.

There are two flavours:

| Flavour | Tool name format | Where it's configured |
|---|---|---|
| **Named host** (multiple per workspace) | `host:<name>:<skill>` | Settings → AI → Agent Hosts |
| **Local LLM endpoint** (singleton) | `local:<skill>` | Settings → AI → Local LLM |

The protocol, authentication, and execution path are identical for both.

## Protocol

A host implements two endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/skills` | Return the catalogue of skills this host offers |
| `POST` | `/execute` | Run one skill with parameters |

Authorization (optional): if `apiKey` is configured on the host, ThreatCaddy sends `Authorization: Bearer <apiKey>` on both endpoints. The literal string `local` is treated as "no auth" for the local endpoint flavour.

Timeouts (client-side): `GET /skills` has 30 s, `POST /execute` has 60 s. Both abort cleanly on overrun.

### `GET /skills`

Returns a JSON array of skill descriptors.

```json
[
  {
    "name": "scan_host",
    "description": "Run a fast nmap scan against a target IP or hostname.",
    "parameters": {
      "type": "object",
      "properties": {
        "target": { "type": "string", "description": "IP or hostname" },
        "ports":  { "type": "string", "description": "Port spec (e.g. '22,80,443' or '1-1024')" }
      },
      "required": ["target"]
    },
    "actionClass": "fetch"
  }
]
```

Field reference:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Slug used in the tool name. Validated against `^[A-Za-z0-9_-]{1,80}$` — anything outside that is dropped during discovery. |
| `description` | yes | Shown to the LLM. Truncated to 500 chars on ingest. |
| `parameters` | yes | A JSON-Schema-style object. `type` must be `'object'`. `properties` and `required` are passed through to the LLM tool definition. |
| `actionClass` | no | Hint for the agent policy auto-approval gate. One of: `read`, `enrich`, `fetch`, `create`, `modify`, `delegate`. Default at discovery time is whatever you supplied (no fallback). At execution time, missing values fall back to `modify` (the most restrictive class) so an unconfigured skill can never auto-approve a destructive action. |

Discovery is done from the Agent Hosts UI by clicking **Refresh skills**, or programmatically by calling `fetchHostSkills(host)`. The result is cached on `AgentHost.skills` and `AgentHost.skillsFetchedAt`. The cache is what feeds `getHostToolDefinitions(settings)`, which in turn feeds the LLM. Skills don't appear to the LLM until they've been discovered at least once.

### `POST /execute`

Body:

```json
{
  "skill": "scan_host",
  "parameters": { "target": "10.0.0.5", "ports": "22,80,443" }
}
```

Response: free-form text. The body is passed through verbatim as the LLM tool result, so JSON, plain text, or markdown all work. Hosts SHOULD return JSON for anything the LLM needs to parse, but ThreatCaddy doesn't require it.

On non-2xx, ThreatCaddy returns a synthetic `{"error": "<displayName> returned HTTP <status>"}` to the LLM. The upstream body is **not** forwarded — bodies are routinely echo the caller's `Authorization` header, so `fetchHostSkills` runs them through `redactAuth()` (strips `Authorization: Bearer …`, `api_key`, `access_token`, `secret`, `password`, etc.) before showing them in the audit log; for `/execute` errors the body is dropped entirely.

## How a skill becomes a tool

1. **Configure** the host in Settings → AI → Agent Hosts: name (slug), display name, URL, optional API key, enabled flag.
2. **Discover** by clicking *Refresh skills*. ThreatCaddy calls `GET /skills`, validates the entries, and caches them on the host record.
3. **Definition** — `getHostToolDefinitions(settings)` synthesises an LLM tool definition for each cached skill:
   - Tool name: `host:<name>:<skill>` (or `local:<skill>` for the local flavour).
   - Description: `[<host displayName>] <skill description>`.
   - Input schema: copied from `skill.parameters`.
4. **Allowlist** — the tool name is added to the deployment's effective tool surface by `buildAgentToolset` only if the agent profile allows that prefix. (See `caddy-agent-policy.ts` and CLAUDE.md "Tool allowlist" notes.)
5. **Execute** — when the LLM emits a tool call with the synthesised name, `executeHostSkill` parses the prefix, looks up the host, and POSTs `{ skill, parameters }` to `<baseUrl>/execute`.

## Policy integration

`getHostSkillActionClass(toolName)` resolves the action class for any host or local tool by reading the cached skill record and returning its `actionClass`. The result is fed into the same policy gate that classifies built-in tools (`read`, `enrich`, `fetch`, `create`, `modify`, `delegate`). Missing values default to `modify`, the most restrictive class — a host that doesn't declare `actionClass` is treated as a write tool and won't auto-approve unless the deployment policy explicitly allows `modify` for the action class.

`isWriteTool(name)` (in `llm-tool-defs.ts`) consults the same cache: any host or local skill with `actionClass` of `modify` or `create` is treated as a write tool, which means it carries an idempotency key (`${deploymentId}:${cycleStartedAt}:${toolName}:sha256(args)`) and survives the handoff state machine.

## Worked example

Suppose you run a SOC workstation that hosts a small Python service on port 8080. The service exposes two skills:

```python
# host.py — minimal Flask example
from flask import Flask, request, jsonify
import subprocess

app = Flask(__name__)

@app.get("/skills")
def skills():
    return jsonify([
        {
            "name": "ping_host",
            "description": "Ping a target and return latency / loss.",
            "parameters": {
                "type": "object",
                "properties": {"target": {"type": "string"}},
                "required": ["target"],
            },
            "actionClass": "fetch",
        },
        {
            "name": "block_ip",
            "description": "Add an IP to the firewall block list.",
            "parameters": {
                "type": "object",
                "properties": {"ip": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["ip"],
            },
            "actionClass": "modify",  # destructive — won't auto-approve
        },
    ])

@app.post("/execute")
def execute():
    body = request.get_json(force=True)
    if body["skill"] == "ping_host":
        out = subprocess.run(["ping", "-c", "3", body["parameters"]["target"]], capture_output=True, text=True, timeout=10)
        return out.stdout
    if body["skill"] == "block_ip":
        # ... call iptables, return result
        return jsonify({"blocked": body["parameters"]["ip"]})
    return jsonify({"error": "unknown skill"}), 400
```

Configure it in ThreatCaddy:

| Field | Value |
|---|---|
| Name | `soc1` |
| Display Name | `SOC Workstation` |
| URL | `http://192.168.1.50:8080` |
| API Key | (optional) |

After clicking *Refresh skills*, two new tools are visible to allowed agents:

- `host:soc1:ping_host` — auto-approved if the deployment policy allows the `fetch` action class.
- `host:soc1:block_ip` — requires explicit approval (or a policy that auto-approves `modify`) every time it's called.

## Failure modes and what the LLM sees

| Failure | Returned to LLM |
|---|---|
| Host disabled | `{"error": "Agent host \"<name>\" is disabled."}` |
| Host not found | `{"error": "Agent host not found: <name>. Configure in Settings > AI > Agent Hosts."}` |
| HTTP non-2xx from `/execute` | `{"error": "<displayName> returned HTTP <status>"}` (body dropped) |
| Network error | `{"error": "<displayName> execution failed: <message>"}` |
| Timeout (60 s) | `{"error": "<displayName> timed out after 60s"}` |
| `/skills` returns invalid JSON | Throws during discovery — surfaced in the Settings UI, not at execution time |
| `/skills` entry fails name validation | Silently dropped from the catalogue |

## Security model

- ThreatCaddy treats hosts as **untrusted upstreams**. Skill descriptions are truncated and used as LLM context, but they are never executed as code on the client.
- API keys are stored in `Settings.agentHosts[].apiKey` (and for local: `Settings.llmLocalApiKey`). They live in `localStorage` in plaintext like all other LLM keys — see CLAUDE.md and the security audit for context.
- Error bodies from `/skills` are passed through `redactAuth()` before display. Bodies from `/execute` errors are dropped entirely.
- The skill name validator (`^[A-Za-z0-9_-]{1,80}$`) prevents prompt-injection of tool names with embedded directives.
- Hosts cannot register tools that collide with built-in tool names — the prefixes (`host:`, `local:`) are reserved.

## Related

- `src/lib/agent-hosts.ts` — implementation
- `src/lib/caddy-agent-policy.ts` — action-class gating
- `src/lib/llm-tool-defs.ts` — `isWriteTool` consults host action class
- CLAUDE.md, "Agent Hosts" section
