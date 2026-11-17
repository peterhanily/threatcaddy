# Agent Hosts

An **agent host** is an external HTTP endpoint that CaddyAI and ThreatCaddy agents can call as if it were a built-in tool. Hosts let you expose local services (a SOC workstation, a forensic VM, a custom LLM) as a list of named "skills" that show up in the LLM's tool surface. A skill call sends investigation data to another service, so every call that CaddyAI or an agent makes needs a person's approval, whatever the skill declares.

There are two flavours:

| Flavour | Tool name format | Where it's configured |
|---|---|---|
| **Named host** (multiple per workspace) | `host:<name>:<skill>` | Earlier versions only. 2.0.3 cannot add, edit or refresh named hosts; Settings → AI → Where AI data goes lists them with Remove |
| **Local LLM endpoint** (singleton) | `local:<skill>` | Settings → AI → Local LLM |

The protocol, authentication, and execution path are identical for both. A named host must use https; plain http is accepted only for `localhost`, `127.0.0.1` and `[::1]`.

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
| `description` | yes | Shown to the LLM. Control characters become spaces; invisible format, private-use and lone surrogate characters are removed; the result is capped at 200 characters. Descriptions stored by older versions are cleaned the same way. |
| `parameters` | yes | A JSON-Schema-style object. Only `properties` and `required` are used. Parameters whose names do not match `^[a-zA-Z0-9_.-]{1,64}$` are dropped, from `required` too. Every string and key is cleaned like a description, and nested descriptions and titles are capped at 200 characters. A schema over 2000 JSON characters loses its descriptions and titles, then examples and defaults; only if it is still too large is the skill sent with no parameters. |
| `actionClass` | no | One of `read`, `enrich`, `fetch`, `create`, `modify`. Anything else, including `delegate` or a missing value, is treated as `modify`. It decides whether the app treats the skill as a write; it never lets a call run without approval. |

Local endpoint skills are discovered with **Discover Skills** under Settings → AI → Local LLM, which calls `fetchHostSkills` and caches the result in `Settings.llmLocalSkills`. Named hosts keep the skills an earlier version cached on `AgentHost.skills`; 2.0.3 has no control to refresh them. The cache is what feeds `getHostToolDefinitions(settings)`, which in turn feeds the LLM. Skills don't appear to the LLM until they've been discovered at least once.

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

1. **Configure** — for the local flavour, set the endpoint in Settings → AI → Local LLM. Named hosts (name, display name, URL, optional API key, enabled flag) could only be configured in an earlier version; 2.0.3 can remove them.
2. **Discover** — for the local flavour, click *Discover Skills*. ThreatCaddy calls `GET /skills`, validates and cleans the entries, and caches them. Named hosts use the skills cached by an earlier version.
3. **Definition** — `getHostToolDefinitions(settings)` synthesises an LLM tool definition for each cached skill of an enabled host:
   - Tool name: `host:<name>:<skill>` (or `local:<skill>` for the local flavour).
   - Description: `[<host displayName>] <skill description>` (`[Local Agent] …` for the local flavour), cleaned and capped as above.
   - Input schema: the cleaned `skill.parameters`.
   - Named hosts that use plain http on any address other than `localhost`, `127.0.0.1` or `[::1]` are left out. The local flavour's `local:<skill>` tools are offered whenever a local endpoint is set.
   - Anthropic, OpenAI and Mistral accept only `^[a-zA-Z0-9_-]{1,64}$` tool names, so each request sends a readable alias (`host__soc1__ping_host`) or, when that does not fit, `dyn_<hash>`. Responses are decoded back to the internal name before any approval check or execution.
4. **Allowlist** — `buildAgentToolset` offers host and local tools to agents whose profile has no tool list or lists the tool by name, and to the legacy single agent; observers never get them. CaddyAI chat offers them in Act and YOLO mode, never in Plan mode. The supervisor and the agent bridge never offer them.
5. **Approve and execute** — every call is decided as outbound ("configured" egress): chat shows an approval card and an agent's call becomes a proposal in the agent inbox. After a person approves it, `executeHostSkill` parses the prefix, looks up the host, and POSTs `{ skill, parameters }` to `<baseUrl>/execute`. An analyst-typed CTI slash command such as `/cti` runs a host named `cti` directly, because the analyst started it. An enabled `cti` host with cached skills that uses plain http to another computer is not used, and the command says it needs https.

## Policy integration

`getHostSkillActionClass(toolName)` resolves the action class for any host or local tool from the cached skill record; a missing or unknown value is `modify`. The class is metadata only. Whatever a host declares, `decideToolCall` (`src/lib/tool-reach.ts`) treats every host or local skill call as outbound ("configured" egress): it always needs a person's approval, and the dispatcher refuses it without one. Auto-approve settings cannot change that.

`isWriteTool(name)` (in `llm-tool-defs.ts`) consults the same cache: a host or local skill whose class is `create` or `modify` (including a missing class) counts as a write, so the app reloads the affected views after it runs.

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
            "actionClass": "modify",  # destructive
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

Versions before 2.0.3 could add it as a named host:

| Field | Value |
|---|---|
| Name | `soc1` |
| Display Name | `SOC Workstation` |
| URL | `https://soc1.example.org` (served over TLS) |
| API Key | (optional) |

Serve the host over https: 2.0.3 no longer uses a named host at a plain-http address such as `http://192.168.1.50:8080`. With its skills cached, two tools are visible to CaddyAI and allowed agents:

- `host:soc1:ping_host` — declared `fetch`; needs approval every time it's called.
- `host:soc1:block_ip` — declared `modify`; needs approval every time it's called.

## Failure modes and what the LLM sees

| Failure | Returned to LLM |
|---|---|
| Host disabled | `{"error": "Agent host \"<displayName>\" is disabled."}` |
| Host not found | `{"error": "Agent host not found: <name>. Named agent hosts can no longer be configured; remove it in Settings → AI."}` |
| Plain http on a non-loopback address | `{"error": "Agent host \"<displayName>\" must use https (plain http only on localhost)."}` |
| HTTP non-2xx from `/execute` | `{"error": "<displayName> returned HTTP <status>"}` (body dropped) |
| Network error | `{"error": "<displayName> execution failed: <message>"}` |
| Timeout (60 s) or cancellation | `{"error": "<displayName> request was cancelled or timed out. Remote completion is unknown; do not automatically retry."}` |
| `/skills` returns invalid JSON | Throws during discovery — surfaced under *Discover Skills* in Settings, not at execution time |
| `/skills` entry fails name validation | Silently dropped from the catalogue |

## Security model

- ThreatCaddy treats hosts as **untrusted upstreams**. Skill descriptions and parameter schemas are cleaned and capped before they are used as LLM context, and they are never executed as code on the client.
- Every skill call that CaddyAI or an agent makes needs a person's approval. Plan mode, the supervisor and the agent bridge cannot call skills.
- API keys are stored in `Settings.agentHosts[].apiKey` (and for local: `Settings.llmLocalApiKey`). They live in `localStorage` in plaintext like all other LLM keys — see CLAUDE.md and the security audit for context.
- Error bodies from `/skills` are passed through `redactAuth()` before display. Bodies from `/execute` errors are dropped entirely.
- The skill name validator (`^[A-Za-z0-9_-]{1,80}$`) prevents prompt-injection of tool names with embedded directives.
- Hosts cannot register tools that collide with built-in tool names — the prefixes (`host:`, `local:`) are reserved.

## Related

- `src/lib/agent-hosts.ts` — implementation
- `src/lib/caddy-agent-policy.ts` — action-class gating
- `src/lib/llm-tool-defs.ts` — `isWriteTool` consults host action class
- CLAUDE.md, "Agent Hosts" section
