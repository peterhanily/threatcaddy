# Integration platform

Integration templates are declarative JSON workflows. Installed integrations pair a template with configuration and scope. This document describes the implemented client runtime, not every capability represented by the compatibility schema.

## Availability and triggers

The browser runs integrations through explicit callers: IOC run menus, bulk enrichment, imported-IOC enrichment, and the enrichment tool used by chat. Declaring a trigger does not install a general entity listener, scheduler, or webhook endpoint.

| Declaration | Current behavior |
|---|---|
| `manual` | Available through supported run controls; the IOC menu filters by matching IOC type. |
| `on-entity-create` | Used by the explicit imported-IOC enrichment caller; not a universal create listener. |
| `on-entity-update` | Compatibility metadata; no general automatic update listener. |
| `scheduled` | Compatibility metadata; no supported scheduler for integration templates. |
| `webhook` | Compatibility metadata; no supported inbound integration webhook. |

Server-side integration execution is unavailable. Startup, load, enable, and trigger paths enforce this capability gate. Existing definitions, configuration, saved enable preferences, and history are retained; the admin UI distinguishes a saved preference from an available runtime. Legacy integrations can still be disabled or deleted. Sharing a template with a team does not enable server execution.

HTTP pagination and the `post-to-feed` output are also unavailable. Validation rejects these declarations before execution rather than silently producing incomplete results.

## Minimal inert example

This complete template makes no network requests and does not create entities:

```json
{
  "id": "local-summary-example",
  "schemaVersion": "1.0",
  "version": "1.0.0",
  "name": "Local summary",
  "description": "Render a local demonstration message.",
  "author": "Example",
  "icon": "📋",
  "color": "#0066cc",
  "category": "utility",
  "tags": ["example"],
  "triggers": [{ "type": "manual" }],
  "configSchema": [],
  "requiredDomains": [],
  "steps": [{
    "id": "summary",
    "type": "set-variable",
    "label": "Prepare summary",
    "variables": { "summary": "Local demonstration complete." }
  }],
  "outputs": [{
    "type": "display",
    "template": { "summary": "{{vars.summary}}" }
  }],
  "source": "user",
  "createdAt": 1735000000000,
  "updatedAt": 1735000000000
}
```

The full schema is in `src/types/integration-types.ts`; runtime validation is in `src/lib/integration-plan.ts`. Configuration validates declared types/options and preserves valid `false` and `0` values. Defaults apply to missing values, not every falsy value.

JSON imports always receive a fresh local ID, preserving any installed definition with the supplied ID. Catalog/team installation refuses collisions with stored or built-in templates, including IDs still referenced by installations. There is no automatic replacement/update path: import a separate JSON copy, review it, and configure it explicitly. Import errors preserve the pasted draft.

## Execution graph and limits

There are eight step types: `http`, `transform`, `condition`, `loop`, `create-entity`, `update-entity`, `delay`, and `set-variable`.

Unreferenced steps are roots and execute in declaration order. A branch or loop owns its referenced children: those children are not also run as top-level steps. Reusable children may run on each selected invocation. Duplicate IDs, missing references, cycles, excessive nesting, and malformed declarations are rejected before any step executes.

The runtime caps templates at 256 steps, nesting at eight levels, aggregate execution visits at 10,000, and each loop at 1,000 iterations (default 100). Template JSON is limited to 4 MiB, with separate bounded-data validation. Runs have a five-minute deadline. Logs are capped at 500 entries with an explicit truncation marker. Limits and cancellation are not bypassed by `continueOnError`.

Derived and retained data has a cumulative 8 MiB budget, with 50,000 measured data nodes and a depth cap of 24. Expansion is charged before interpolation, mapping, joining, and serialization allocate their result. Conservative accounting can reject a run before its final output alone reaches 8 MiB; overwriting a variable does not reset the cumulative budget.

A loop's `maxIterations` processes only that prefix; it does not promise every input item was processed. Cancellation or a later error does not roll back earlier acknowledged entity writes. Run counts retain those acknowledged changes.

## Context and substitution

The run context is shaped as follows:

```ts
{
  ioc?: { id, value, type, confidence },
  investigation?: { id, name },
  config: { /* installed configuration */ },
  now: string,
  steps: { /* results keyed by step ID */ },
  vars: { /* explicitly assigned variables and current loop bindings */ },
  loop?: { /* current loop metadata */ }
}
```

Examples:

- HTTP response: `{{steps.lookup.response.data.result}}`, with `status`, `data`, and `headers` under `response`.
- Transform result: `{{steps.extract.score}}`, where `score` is an operation's `as` key.
- Created entity ID: `{{steps.create.id}}`.
- Assigned variable: `{{vars.summary}}`.
- Current IOC: `{{ioc.value}}`.

There is no implicit `trigger.entity`, bare `response`, or bare transform-result variable.

`resolveVariables` substitutes text. An exact object/array reference used in a text field is JSON text, not a typed value. `resolveDeep` recursively substitutes strings while preserving literal non-string values.

Loop items and transform inputs instead use `resolveDataValue`: a single exact `{{path}}` reference preserves the original typed value. Mixed text remains text. Loop items must resolve to an array; `Object.values()` is not an expression feature. Loop item/index bindings live under `vars`, use a zero-based index, and restore previous bindings when a nested loop exits.

### Conditions

Supported comparisons are `==`, `!=`, `>`, `>=`, `<`, `<=`, `exists`, `not-exists`, `contains`, `startsWith`, and `endsWith`.

Use explicit references and spaces, for example:

```text
{{config.enabled}} == true
{{steps.lookup.response.status}} == 200
{{ioc.value}} exists
```

The words `and` and `or` combine conditions left to right without operator precedence. This is not JavaScript: `&&`, `||`, unary `!`, parentheses, and JavaScript quoted-literal syntax are not supported. A nonempty standalone string, including the text `false`, is truthy for compatibility; use an explicit comparison for boolean configuration.

## Step behavior

### HTTP

Methods are `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. URL, headers, query parameters, and body support substitution. Body encoding is `json`, `form`, or `text`; response decoding is `json` or `text`. The default timeout is 30 seconds. Configured retries are bounded and use increasing backoff for eligible status codes.

Client transport may use the configured team proxy, the extension, or direct browser fetch. Direct fetch remains subject to browser CORS and the application's content security policy; not every declared endpoint will be reachable. Direct response bodies are bounded at 5 MiB, including streamed bodies, and cancellation remains active through body consumption.

`requiredDomains` is a bare-hostname allowlist checked before dispatch. It is not by itself a DNS-aware private-network/SSRF defense. Each transport has its own additional restrictions. Only actual dispatched HTTP attempts count toward API usage.

### Transform

Operations are `extract`, `map`, `filter`, `flatten`, `join`, `template`, and `lookup`. Each result is stored under `steps.<stepId>.<as>`, not automatically promoted to the top-level context.

`extract` reads the original transform input. Other data operations work from the preceding intermediate result. Mapping and filtering expose the current element as `item`. Template formatting resolves the ordinary run context; it does not automatically expose prior `as` names as bare variables.

### Branches and loops

A condition selects `thenSteps` or `elseSteps`. A loop resolves `items`, assigns `itemVariable` and optional `indexVariable` under `vars`, and executes `bodySteps`. Selected child steps run in their listed order. The shared budget covers nested work.

### Entity writes, delays, variables

The schema describes IOC, note, task, and timeline-event callbacks, but available callbacks and current scope determine what a caller can persist. Update steps require an explicit entity ID. A supplied callback rejects unsupported types or missing/deleted targets; it must not acknowledge a write that did not happen.

| Current caller | Creation callback | Update callback |
|---|---|---|
| IOC run menu | Notes, IOCs, tasks | Existing, non-trashed IOCs |
| Bulk enrichment | Notes, when Create notes is enabled | Existing, non-trashed IOCs |
| Imported-IOC enrichment | Not supplied | Existing, non-trashed IOCs |
| Chat enrichment tool | Notes and IOCs | Existing, non-trashed IOCs |

No current browser caller supplies timeline-event creation or note/task/timeline update support. A disabled/absent output callback does not create an entity or increment a write count. Do not assume that a schema-compatible template can perform every output in every caller.

`delay` waits abortably. `set-variable` writes under `vars`; string values use text substitution.

## Outputs and history

Supported outputs are `create-ioc`, `update-ioc`, `create-note`, `create-task`, `create-timeline-event`, `notify`, and `display`. Optional conditions use the same expression syntax. An `update-ioc` output needs an explicit target ID in its template.

`notify` invokes the caller's notification callback; it does not guarantee OS notification permission or delivery. `display` adds display results without a write of its own. It is not a dry-run switch: preceding steps and other outputs may already have changed data.

The executor returns a run record; UI callers persist history in local Dexie. Records include status, input/output summaries, duration, created/updated counts, actual API calls, bounded logs, error/display results, and `createdAt`. They do not contain a promised full final context or `startedAt`/`finishedAt` pair. Server-run mirroring is not available.

## Configuration and trust

Installed configuration, including API keys, is stored in `installedIntegrations.config`. Password fields and `secret: true` control form behavior and configured-value log redaction; they do not create a separate secret store. The app's actual vault/backup settings determine at-rest and export protection.

Do not hardcode secrets in templates or share a configured template as though it were credential-free. Exact configured-secret redaction is not a data-loss prevention guarantee: transformed/encoded secrets and values deliberately copied into response fields or entities can still be retained. Review imported domains, step behavior, and outputs before configuring or running a template.

Template `rateLimit` values are compatibility metadata, not enforced quotas in the current client runtime. Execution deadlines and resource budgets are separate safeguards; they do not implement the declared hourly/daily quotas. The expression engine does not evaluate arbitrary JavaScript. External responses remain untrusted data, including if an output later places them in notes used by an AI conversation.

## Source reference

- `src/lib/integration-executor.ts`: browser execution and callback contract.
- `src/lib/integration-expression.ts`: supported substitutions and conditions.
- `src/lib/integration-plan.ts`: preflight validation and graph compilation.
- `src/hooks/useIntegrations.ts`: import, installation, and local run history.
- `server/src/bots/runtime-availability.ts`: server runtime capability gate.
- `docs/api-reference.md`: template-sharing endpoints; sharing is separate from execution.
