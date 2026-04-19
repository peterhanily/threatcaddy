# Integration Platform

The integration platform is ThreatCaddy's no-code workflow engine for threat-intel enrichment. An **integration template** is a shareable JSON definition that wires together HTTP calls, conditional branches, loops, transforms, and entity CRUD. An **installed integration** is a user's instance of a template with a config (API keys, scope, schedule).

This doc covers the shape of a template, the seven step types, the variable / expression syntax, the trigger model, and the output routing model. It's written for people building a new integration, not for end users running pre-built ones.

## Anatomy of a template

```json
{
  "id": "ti-virustotal-ip",
  "schemaVersion": "1.0",
  "version": "1.2.0",
  "name": "VirusTotal — IP enrichment",
  "description": "Look up an IP on VirusTotal and append the verdict to the IOC.",
  "author": "ThreatCaddy",
  "icon": "🦠",
  "color": "#ff6b35",
  "category": "enrichment",
  "tags": ["virustotal", "ip", "enrichment"],
  "triggers":      [{ "type": "on-entity-create", "iocTypes": ["ipv4", "ipv6"] }],
  "configSchema":  [{ "key": "apiKey", "label": "VirusTotal API key", "type": "password", "required": true, "secret": true }],
  "steps":         [ /* see below */ ],
  "outputs":       [ /* see below */ ],
  "rateLimit":     { "maxPerHour": 240, "maxPerDay": 1000 },
  "requiredDomains": ["www.virustotal.com"],
  "minVersion":    "1.0.0",
  "source":        "user",
  "createdAt":     1735000000000,
  "updatedAt":     1735000000000
}
```

Field reference (full type in `src/types/integration-types.ts`):

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable slug. User-installed instances reference this. |
| `schemaVersion` | yes | Currently `"1.0"`. Bumped when the template shape changes incompatibly. |
| `version` | yes | Template-author semver; informational. |
| `category` | yes | One of `enrichment`, `threat-feed`, `siem-soar`, `notification`, `export`, `pipeline`, `utility`. |
| `triggers` | yes | At least one. See [Triggers](#triggers). |
| `configSchema` | yes | Field declarations for the install-time config form. `secret: true` flags it for the secret store. |
| `steps` | yes | Ordered execution graph. See [Step types](#step-types). |
| `outputs` | yes | Routing rules from final variables to ThreatCaddy entities. See [Outputs](#outputs). |
| `rateLimit` | no | Soft cap enforced per installed integration. |
| `requiredDomains` | yes | Allowlist of egress hosts. The HTTP step refuses URLs outside this list (SSRF guard). |
| `source` | yes | `builtin` (read-only), `user`, `team`, or `community`. |

## Triggers

| Trigger | When it fires | Optional filters |
|---|---|---|
| `manual` | User clicks Run from the UI | — |
| `on-entity-create` | A matching entity is created | `iocTypes`, `entityTables` |
| `on-entity-update` | A matching entity is updated | `iocTypes`, `entityTables` |
| `scheduled` | Server cron fires | `schedule` (cron string, server-side only) |
| `webhook` | Inbound POST to the integration's webhook URL | — |

Multiple triggers can be declared on a single template — e.g. an enrichment integration that wants both manual runs and on-create runs.

`scheduled` and `webhook` triggers only fire server-side. `manual`, `on-entity-create`, and `on-entity-update` fire client-side too.

## Step types

Seven step types (`IntegrationStepType` in `integration-types.ts`):

```
http | transform | condition | loop | create-entity | update-entity | delay | set-variable
```

All steps share a `StepBase`:

```ts
{
  id: string;            // unique within the template
  type: IntegrationStepType;
  label: string;         // shown in the run log
  continueOnError?: boolean;  // if true, errors don't abort the run
  condition?: string;    // skip the step if this expression is false
}
```

### `http` — outbound HTTP call

```json
{
  "id": "vt-lookup",
  "type": "http",
  "label": "Query VirusTotal",
  "method": "GET",
  "url": "https://www.virustotal.com/api/v3/ip_addresses/{{trigger.entity.value}}",
  "headers": { "x-apikey": "{{config.apiKey}}" },
  "responseType": "json",
  "timeout": 30000,
  "retry": { "maxRetries": 3, "retryOn": [429, 500, 502, 503], "backoffMs": 1000 },
  "pagination": {
    "type": "cursor",
    "nextExpression": "{{response.next_cursor}}",
    "maxPages": 10,
    "resultsPath": "data"
  }
}
```

| Field | Notes |
|---|---|
| `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. |
| `url` | Variable substitution allowed. Must resolve to a host in `requiredDomains`. |
| `headers`, `queryParams`, `body` | Variable substitution allowed throughout. |
| `contentType` | `json` (default), `form`, `text`. Drives serialisation of `body`. |
| `responseType` | `json` (default) parses the body and stores it on `response`. `text` keeps it as a raw string. |
| `timeout` | Milliseconds; default 30 000. Hard cap is enforced server-side. |
| `retry` | Retries with constant backoff on the listed status codes. |
| `pagination` | Three modes — `offset` (uses an offset/limit pair), `cursor` (next-cursor token), `link-header` (RFC 5988). All three concatenate `resultsPath` arrays from each page into one. |

Server-side execution sends the call through the team server's proxy (which enforces SSRF / private-IP blocks again on top of the `requiredDomains` allowlist). Client-side execution goes through the extension's `PROXY_FETCH` for the same reason — direct browser fetches would be CORS-blocked anyway.

### `transform` — reshape variables

```json
{
  "id": "extract-verdict",
  "type": "transform",
  "label": "Pull verdict",
  "input": "{{response}}",
  "operations": [
    { "op": "extract",  "path": "data.attributes.last_analysis_stats.malicious", "as": "maliciousCount" },
    { "op": "lookup",   "path": "maliciousCount", "map": { "0": "clean", "1": "suspicious" }, "default": "malicious", "as": "verdict" },
    { "op": "template", "template": "VT verdict: {{verdict}} ({{maliciousCount}} engines)", "as": "summary" }
  ]
}
```

Seven `op`s:

| Op | Shape | Purpose |
|---|---|---|
| `extract` | `{ path, as }` | Pull a single value out of the input via dot-path. |
| `map` | `{ path, template, as }` | Map an array → array of objects, where each object's keys are filled from `template`. |
| `filter` | `{ path, condition, as }` | Filter an array by a boolean expression evaluated against each element. |
| `flatten` | `{ path, as }` | Flatten one level of nested arrays. |
| `join` | `{ path, separator, as }` | Join array elements with a separator. |
| `template` | `{ template, as }` | Render a `{{var}}` template string into a new variable. |
| `lookup` | `{ path, map, default?, as }` | Map a value through a static lookup table. |

All ops set their result on the `as` variable in the run context.

### `condition` — branching

```json
{
  "id": "is-malicious",
  "type": "condition",
  "label": "If malicious",
  "expression": "verdict == 'malicious'",
  "thenSteps": ["create-block-task"],
  "elseSteps": ["log-clean"]
}
```

`expression` is evaluated by the safe expression module (see [Variables and expressions](#variables-and-expressions)). The runner executes the listed step IDs in order, then resumes after the condition step. `elseSteps` is optional.

### `loop` — iterate

```json
{
  "id": "for-each-engine",
  "type": "loop",
  "label": "Loop engines",
  "items": "{{response.data.attributes.last_analysis_results}}",
  "itemVariable": "engine",
  "indexVariable": "i",
  "bodySteps": ["log-engine"],
  "maxIterations": 100,
  "delayMs": 50
}
```

`items` must resolve to an array (or `Object.values()` of an object). `itemVariable` and optionally `indexVariable` are scoped to the body steps. `maxIterations` and `delayMs` are belt-and-braces protections against runaway loops and rate limits.

### `create-entity` — create a ThreatCaddy entity

```json
{
  "id": "create-block-task",
  "type": "create-entity",
  "label": "Create block task",
  "entityType": "task",
  "fields": {
    "title": "Block {{trigger.entity.value}} (VT verdict: {{verdict}})",
    "priority": "high",
    "tags": ["vt-malicious"]
  }
}
```

`entityType`: `ioc`, `note`, `task`, or `timeline-event`. `fields` is the partial entity payload — variable substitution applies to all string fields. The created entity is added to the run context as `<stepId>.created` so downstream steps can link to it.

### `update-entity` — update by ID

```json
{
  "id": "tag-ioc",
  "type": "update-entity",
  "label": "Tag the IOC as malicious",
  "entityType": "ioc",
  "entityId": "{{trigger.entity.id}}",
  "fields": { "tags": ["vt-malicious"], "confidence": "high" }
}
```

`entityId` is required; without it the update has no target. Same `entityType` enum as `create-entity`.

### `delay` — pause

```json
{ "id": "throttle", "type": "delay", "label": "Be polite", "ms": 2000 }
```

Sleeps for `ms` milliseconds. Used for politeness when looping over external API calls.

### `set-variable` — explicit variable assignment

```json
{
  "id": "init",
  "type": "set-variable",
  "label": "Init",
  "variables": {
    "lookupCount": "0",
    "summary": "verdict={{verdict}} engines={{engineCount}}"
  }
}
```

Useful for initialising counters, naming intermediate values clearly, or templating a string that downstream steps reference repeatedly.

## Variables and expressions

The expression engine lives in `src/lib/integration-expression.ts`. It's a small parser — **no `eval`, no `new Function`** — with three public surfaces:

- `resolveVariables(template, context)` — substitutes `{{path.to.value}}` tokens in a string.
- `evaluateCondition(expr, context)` — evaluates a boolean expression for `condition` steps and `condition` filters on outputs.
- `resolveDeep(value, context)` — recursively substitutes through arrays / objects.

### Run context

A run carries a context object that grows as steps complete:

```
{
  trigger: { type, entity?, payload? },   // what fired the run
  config:  { …configSchema values… },     // user-supplied config
  response: <last http response body>,    // shorthand for the last http step
  <stepId>: <step result>,                // every step writes here
  <as variable>: <value>,                 // transforms write to their `as` keys
  <itemVariable>: <current loop item>,    // inside a loop body
}
```

`{{trigger.entity.value}}`, `{{config.apiKey}}`, `{{response.data.id}}`, `{{verdict}}` are all resolved against the same context.

### Conditions

Supported operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `&&`, `||`, parentheses, plus the unary `!`. Operands can be variable references, string literals (single or double quoted), numbers, `true`/`false`/`null`/`undefined`. Examples:

```
verdict == 'malicious'
maliciousCount > 0 && config.threshold >= 5
!response.error && response.status == 'ok'
```

Anything weirder than this needs a dedicated `transform` step.

## Outputs

After all steps complete, the runner walks `outputs` and routes each one based on its `type`. This is where the run's final values turn into ThreatCaddy entities or notifications.

```json
{
  "type": "create-note",
  "condition": "maliciousCount > 0",
  "template": {
    "title": "VT verdict for {{trigger.entity.value}}",
    "content": "## Verdict: {{verdict}}\n\n{{maliciousCount}} engines flagged this as malicious.",
    "tags": ["virustotal", "{{verdict}}"]
  }
}
```

| Output type | What it does |
|---|---|
| `create-ioc` | Adds a new IOC. `template` populates its fields. |
| `update-ioc` | Updates the triggering IOC. Common for enrichment templates. |
| `create-note` | Creates an analyst note. |
| `create-task` | Creates a follow-up task. |
| `create-timeline-event` | Adds an event to the investigation timeline. |
| `notify` | Sends an in-app toast / push notification. |
| `post-to-feed` | Posts a CaddyShack feed entry. |
| `display` | No persistence — surfaces the rendered template in the run log only (useful for dry-runs). |

`condition` is optional. If present, the output is skipped unless the expression evaluates true.

## Run records

Every execution writes an `IntegrationRun` to Dexie:

| Field | Notes |
|---|---|
| `status` | `running`, `success`, `error`, `timeout`, `cancelled`. |
| `log` | Array of `IntegrationRunLogEntry` — one per step boundary plus HTTP request/response records. |
| `output` | The final context, scrubbed of `password`-typed config values. |
| `error` | Top-level error message if the run aborted. |
| `startedAt`, `finishedAt` | Wall clock. |

The Run History panel in Settings → Integrations renders these. Server-side runs are mirrored back via the sync engine.

## Security model

- **Secret config fields** (`type: 'password'` or `secret: true`) are persisted via `secret-store.ts` server-side and `Settings.integrationSecrets` (encrypted) client-side. They never appear in the run log.
- **`requiredDomains`** is enforced before every HTTP call. A template can't add domains at runtime; the install-time list is the cap.
- **The expression engine has no `eval`**. All dynamic behaviour is template substitution + a recursive-descent parser for boolean expressions.
- **HTTP responses are not auto-trusted as instructions**. They land in the `response` variable; the LLM doesn't see them unless an output is `create-note` and the rendered content is later surfaced into a chat thread. (Compare the agent-soul / observer-note framing for prompt-injection defence.)
- **Rate limits** are advisory client-side and enforced server-side. The server's `BotManager` (see `docs/bot-architecture.md`) gates integration runs the same way it gates other bots.

## Worked example: AbuseIPDB IP lookup

```json
{
  "id": "abuseipdb-ip",
  "schemaVersion": "1.0",
  "version": "1.0.0",
  "name": "AbuseIPDB — IP reputation",
  "description": "Look up an IP on AbuseIPDB and tag it if abusive.",
  "category": "enrichment",
  "triggers": [{ "type": "on-entity-create", "iocTypes": ["ipv4"] }],
  "requiredDomains": ["api.abuseipdb.com"],
  "configSchema": [
    { "key": "apiKey", "label": "AbuseIPDB API key", "type": "password", "required": true, "secret": true },
    { "key": "abuseThreshold", "label": "Abuse score threshold", "type": "number", "required": true, "default": 50 }
  ],
  "steps": [
    {
      "id": "lookup",
      "type": "http",
      "label": "Query AbuseIPDB",
      "method": "GET",
      "url": "https://api.abuseipdb.com/api/v2/check?ipAddress={{trigger.entity.value}}&maxAgeInDays=90",
      "headers": { "Key": "{{config.apiKey}}", "Accept": "application/json" },
      "responseType": "json",
      "timeout": 15000,
      "retry": { "maxRetries": 2, "retryOn": [429, 500, 502, 503], "backoffMs": 1000 }
    },
    {
      "id": "extract",
      "type": "transform",
      "label": "Extract score",
      "input": "{{response}}",
      "operations": [
        { "op": "extract",  "path": "data.abuseConfidenceScore", "as": "score" },
        { "op": "extract",  "path": "data.countryCode",          "as": "country" },
        { "op": "template", "template": "AbuseIPDB score {{score}}/100 ({{country}})", "as": "summary" }
      ]
    }
  ],
  "outputs": [
    {
      "type": "update-ioc",
      "condition": "score >= config.abuseThreshold",
      "template": { "tags": ["abuseipdb-malicious"], "confidence": "high", "analystNotes": "{{summary}}" }
    },
    {
      "type": "create-note",
      "template": {
        "title": "AbuseIPDB lookup: {{trigger.entity.value}}",
        "content": "Score: {{score}}/100\nCountry: {{country}}\nThreshold: {{config.abuseThreshold}}",
        "tags": ["abuseipdb"]
      }
    }
  ],
  "source": "user",
  "createdAt": 1735000000000,
  "updatedAt": 1735000000000,
  "author": "ThreatCaddy",
  "icon": "🛡️",
  "color": "#0066cc",
  "tags": ["abuseipdb", "ip", "enrichment"]
}
```

This template fires on every new IPv4 IOC, hits AbuseIPDB once, tags the IOC if the abuse score meets the user-configured threshold, and writes a note either way for traceability.

## Related

- `src/lib/integration-executor.ts` — the runner
- `src/lib/integration-expression.ts` — the expression engine
- `src/types/integration-types.ts` — full type surface
- `docs/bot-architecture.md` — server-side execution as `integration` bots
- `docs/api-reference.md` — `/api/integrations/*` endpoints
