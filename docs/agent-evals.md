# Agent evals

An opt-in harness that scores AgentCaddy cycles against the built-in realistic
sample investigation ("Mailbox Compromise — Synthetic Exercise",
`src/lib/sample-investigation-realistic.ts`). It measures output, not safety:
the safety tests are `src/__tests__/ai-agent-chains.test.ts` and its neighbours.

## What it does

`runAgentEval` (`src/evals/agent-eval.ts`) seeds the sample case into an empty
test database **without its three IOC records**. The indicators remain in the
notes and evidence as text, so they are the answer key. It then runs the real
agent cycle (`runAgentCycle`, with the real tool gates and dispatcher) one or
more times and counts what the cycles left behind. No model grades anything.

| Metric | Meaning |
|---|---|
| `iocsFound` / `iocsPresent` | Planted indicators the agent recorded as IOCs, of the three in the source material |
| `entitiesCreated` | Notes, tasks, timeline events and IOCs the agent created |
| `entitiesInvented`, `invented` | Created IOCs whose value is nowhere in the source material, and created notes, tasks or events that name such an indicator |
| `toolCalls`, `toolCallsFailed`, `failedShare` | Tool calls made, and those that errored or were refused |
| `proposed` | Calls queued for the analyst instead of run |
| `turns`, `tokens`, `costUSD` | Model turns, tokens, and cost from `src/lib/model-pricing.ts` (0 for a model it does not price) |
| `outcomes`, `errors` | Each cycle's outcome, and any cycle that could not run |

The eval investigation lets reads, creates and changes run and holds enrichment
and web fetches for approval, so a run sends nothing to an enrichment vendor or
a web page. Later cycles receive the agent's cross-cycle memory, so a run of two
or more cycles also shows whether the agent repeats itself.

The model is whatever "send" function the caller passes (`EvalSend` in
`src/evals/eval-router.ts`, the same shape as the app's router functions).

## Offline: the scripted check

`src/__tests__/agent-eval.test.ts` runs the harness with the scripted model
(`src/__tests__/helpers/scripted-llm.ts`): one run that records every indicator
and one that invents an indicator, misses two and calls a tool it does not
have. It is part of `pnpm test:run` and makes no network request.

## Opt-in: a real model

```sh
ANTHROPIC_API_KEY=... pnpm eval:agents
```

This runs `src/evals/agent-cycles.eval.ts` through `vitest.eval.config.ts` and
prints one JSON score per profile. It sends the synthetic sample case, the
agent prompts and the tool definitions to the Anthropic Messages API and costs
real money. Without `ANTHROPIC_API_KEY` the run is skipped and nothing is sent.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required. Read from the environment only; never written anywhere |
| `AGENT_EVAL_MODEL` | the app's default model | Model id to test and price |
| `AGENT_EVAL_CYCLES` | `2` | Cycles per run |
| `AGENT_EVAL_PROFILES` | none | Comma-separated builtin profile ids (for example `ap-ioc-enricher,ap-case-analyst`) to run in addition to the legacy single agent |

`pnpm test:run` and CI never run it: their Vitest config only collects
`*.test.*` and `*.spec.*` files, and the eval file is `*.eval.ts`.

To compare a prompt or loop change, run the command before and after with the
same model and compare the numbers; one run is one sample, so repeat it before
drawing a conclusion. For another provider, write a second `EvalSend` beside
`anthropicSend` in `agent-cycles.eval.ts`.

The real-model path was written against the Messages API and has not been run
as part of the change that added it; the scripted check covers the scoring.
