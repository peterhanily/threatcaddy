/**
 * Server-side integration executor.
 * Mirrors client-side src/lib/integration-executor.ts, adapted for Node.js.
 * Uses global fetch (Node 18+), no browser dependencies.
 */

import { nanoid } from 'nanoid';
import { resolveVariables, evaluateCondition, resolveDeep } from '../lib/integration-expression.js';
import type {
  IntegrationTemplate,
  InstalledIntegration,
  IntegrationStep,
  IntegrationRun,
  IntegrationRunLogEntry,
  IntegrationRunStatus,
  HttpStep,
  TransformStep,
  ConditionStep,
  LoopStep,
  CreateEntityStep,
  UpdateEntityStep,
  SetVariableStep,
} from '../types/integration-types.js';

export interface ExecutionInput {
  ioc?: { id: string; value: string; type: string; confidence: string };
  investigation?: { id: string; name: string };
}

export interface ExecutionCallbacks {
  onCreateEntity?: (type: string, fields: Record<string, unknown>) => Promise<string>;
  onUpdateEntity?: (type: string, id: string, fields: Record<string, unknown>) => Promise<void>;
  onNotify?: (message: string) => void;
  onPostToFeed?: (content: string, folderId?: string) => Promise<void>;
  onLog?: (entry: IntegrationRunLogEntry) => void;
  /** Server-side: domain-restricted fetch via BotExecutionContext */
  fetchFn?: (url: string, opts?: RequestInit) => Promise<Response>;
}

interface ExecutionContext {
  [key: string]: unknown;
  ioc?: ExecutionInput['ioc'];
  investigation?: ExecutionInput['investigation'];
  config: Record<string, unknown>;
  now: string;
  steps: Record<string, unknown>;
  vars: Record<string, unknown>;
  loop?: { item: unknown; index: number };
}

const MAX_EXECUTION_MS = 5 * 60 * 1000; // 5 minutes

export class IntegrationExecutor {
  async run(
    template: IntegrationTemplate,
    installation: InstalledIntegration,
    input: ExecutionInput,
    callbacks: ExecutionCallbacks,
    signal?: AbortSignal,
  ): Promise<IntegrationRun> {
    const runId = nanoid();
    const startTime = Date.now();
    const log: IntegrationRunLogEntry[] = [];
    let status: IntegrationRunStatus = 'running';
    let error: string | undefined;
    let apiCallsMade = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let displayResults: unknown;

    const context: ExecutionContext = {
      ioc: input.ioc,
      investigation: input.investigation,
      config: installation.config,
      now: new Date().toISOString(),
      steps: {},
      vars: {},
    };

    const addLog = (entry: IntegrationRunLogEntry) => {
      // Cap at 500 entries to prevent unbounded growth on the server
      if (log.length < 500) {
        log.push(entry);
      }
      callbacks.onLog?.(entry);
    };

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), MAX_EXECUTION_MS);

    try {
      for (const step of template.steps) {
        const stepResult = await this.executeStep(
          step,
          template,
          context,
          callbacks,
          addLog,
          signal,
          timeoutController.signal,
        );

        if (stepResult.skipped) continue;

        apiCallsMade += stepResult.apiCalls;
        entitiesCreated += stepResult.entitiesCreated;
        entitiesUpdated += stepResult.entitiesUpdated;

        if (stepResult.error) {
          if (!step.continueOnError) {
            error = stepResult.error;
            status = 'error';
            break;
          }
        }

        if (signal?.aborted) {
          status = 'cancelled';
          break;
        }
        if (timeoutController.signal.aborted) {
          status = 'timeout';
          error = 'Execution exceeded 5 minute timeout';
          break;
        }
      }

      if (status === 'running') {
        // Process outputs
        const outputResult = await this.processOutputs(template, context, callbacks, addLog);
        entitiesCreated += outputResult.entitiesCreated;
        entitiesUpdated += outputResult.entitiesUpdated;
        displayResults = outputResult.displayResults;
        status = 'success';
      }
    } catch (err) {
      if (signal?.aborted) {
        status = 'cancelled';
      } else if (timeoutController.signal.aborted) {
        status = 'timeout';
        error = 'Execution exceeded 5 minute timeout';
      } else {
        status = 'error';
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startTime;

    return {
      id: runId,
      integrationId: installation.id,
      templateId: template.id,
      status,
      trigger: 'manual',
      inputSummary: this.buildInputSummary(input),
      outputSummary: this.buildOutputSummary(status, entitiesCreated, entitiesUpdated, apiCallsMade),
      durationMs,
      error,
      entitiesCreated,
      entitiesUpdated,
      apiCallsMade,
      log,
      displayResults,
      createdAt: startTime,
    };
  }

  private async executeStep(
    step: IntegrationStep,
    template: IntegrationTemplate,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
    signal?: AbortSignal,
    timeoutSignal?: AbortSignal,
  ): Promise<{
    skipped: boolean;
    error?: string;
    apiCalls: number;
    entitiesCreated: number;
    entitiesUpdated: number;
  }> {
    // Check condition
    if (step.condition) {
      const shouldRun = evaluateCondition(step.condition, context);
      if (!shouldRun) {
        return { skipped: true, apiCalls: 0, entitiesCreated: 0, entitiesUpdated: 0 };
      }
    }

    // Check abort
    if (signal?.aborted || timeoutSignal?.aborted) {
      return { skipped: true, apiCalls: 0, entitiesCreated: 0, entitiesUpdated: 0 };
    }

    const stepStart = Date.now();
    addLog({
      ts: stepStart,
      stepId: step.id,
      stepLabel: step.label,
      type: 'step-start',
    });

    let apiCalls = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;

    try {
      switch (step.type) {
        case 'http': {
          const result = await this.executeHttpStep(step, context, callbacks, addLog, signal, timeoutSignal);
          context.steps[step.id] = result;
          apiCalls += (result._apiCalls as number) ?? 1;
          break;
        }
        case 'transform': {
          const result = this.executeTransformStep(step, context);
          context.steps[step.id] = result;
          break;
        }
        case 'condition': {
          const result = await this.executeConditionStep(
            step, template, context, callbacks, addLog, signal, timeoutSignal,
          );
          context.steps[step.id] = { branch: result.branch };
          apiCalls += result.apiCalls;
          entitiesCreated += result.entitiesCreated;
          entitiesUpdated += result.entitiesUpdated;
          break;
        }
        case 'loop': {
          const result = await this.executeLoopStep(
            step, template, context, callbacks, addLog, signal, timeoutSignal,
          );
          context.steps[step.id] = { iterations: result.iterations };
          apiCalls += result.apiCalls;
          entitiesCreated += result.entitiesCreated;
          entitiesUpdated += result.entitiesUpdated;
          break;
        }
        case 'create-entity': {
          const id = await this.executeCreateEntityStep(step, context, callbacks, addLog);
          context.steps[step.id] = { id };
          entitiesCreated += 1;
          break;
        }
        case 'update-entity': {
          await this.executeUpdateEntityStep(step, context, callbacks, addLog);
          context.steps[step.id] = { updated: true };
          entitiesUpdated += 1;
          break;
        }
        case 'set-variable': {
          this.executeSetVariableStep(step, context, addLog);
          context.steps[step.id] = { set: true };
          break;
        }
        case 'delay': {
          await new Promise((r) => setTimeout(r, step.ms));
          context.steps[step.id] = { delayed: step.ms };
          break;
        }
      }

      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'step-complete',
        durationMs: Date.now() - stepStart,
      });

      return { skipped: false, apiCalls, entitiesCreated, entitiesUpdated };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'step-error',
        detail: errorMessage,
        durationMs: Date.now() - stepStart,
      });

      return { skipped: false, error: errorMessage, apiCalls, entitiesCreated, entitiesUpdated };
    }
  }

  private async executeHttpStep(
    step: HttpStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
    signal?: AbortSignal,
    timeoutSignal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const resolvedUrl = resolveVariables(step.url, context);
    const resolvedHeaders = step.headers
      ? (resolveDeep(step.headers, context) as Record<string, string>)
      : {};
    const resolvedParams = step.queryParams
      ? (resolveDeep(step.queryParams, context) as Record<string, string>)
      : {};
    const resolvedBody = step.body != null ? resolveDeep(step.body, context) : undefined;

    // Build URL with query params
    const url = new URL(resolvedUrl);
    for (const [key, value] of Object.entries(resolvedParams)) {
      url.searchParams.set(key, String(value));
    }

    const maxRetries = step.retry?.maxRetries ?? 0;
    const retryOn = step.retry?.retryOn ?? [];
    const backoffMs = step.retry?.backoffMs ?? 1000;
    let apiCalls = 0;

    // Choose the fetch function: prefer the domain-restricted one from callbacks
    const fetchFn = callbacks.fetchFn ?? globalThis.fetch;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Build fetch options
      const fetchOptions: RequestInit = {
        method: step.method,
        headers: { ...resolvedHeaders },
      };

      if (resolvedBody != null && step.method !== 'GET') {
        if (step.contentType === 'form') {
          fetchOptions.body = new URLSearchParams(resolvedBody as Record<string, string>).toString();
        } else if (step.contentType === 'text') {
          fetchOptions.body = String(resolvedBody);
        } else {
          fetchOptions.body = JSON.stringify(resolvedBody);
          if (!resolvedHeaders['Content-Type'] && !resolvedHeaders['content-type']) {
            (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
          }
        }
      }

      // Combine abort signals
      const timeoutMs = step.timeout ?? 30000;
      const stepTimeout = AbortSignal.timeout(timeoutMs);
      const combinedSignals = [stepTimeout];
      if (signal) combinedSignals.push(signal);
      if (timeoutSignal) combinedSignals.push(timeoutSignal);
      fetchOptions.signal = AbortSignal.any(combinedSignals);

      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'http-request',
        detail: `${step.method} ${url.toString()}${attempt > 0 ? ` (retry ${attempt})` : ''}`,
      });

      apiCalls++;
      const response = await fetchFn(url.toString(), fetchOptions);

      const responseData =
        step.responseType === 'text' ? await response.text() : await response.json().catch(() => null);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'http-response',
        detail: `${response.status} ${response.statusText}`,
      });

      // Check if we should retry
      if (!response.ok && attempt < maxRetries && retryOn.includes(response.status)) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        response: {
          status: response.status,
          data: responseData,
          headers: responseHeaders,
        },
        _apiCalls: apiCalls,
      };
    }

    // Should not reach here, but safety net
    throw new Error('HTTP request failed after all retries');
  }

  private executeTransformStep(
    step: TransformStep,
    context: ExecutionContext,
  ): Record<string, unknown> {
    const sourceData = resolveVariables(step.input, context);
    const result: Record<string, unknown> = {};

    // Make sourceData available as a working value
    let working: unknown = sourceData;

    for (const op of step.operations) {
      switch (op.op) {
        case 'extract': {
          const value = getNestedValue(working, op.path);
          result[op.as] = value;
          break;
        }
        case 'map': {
          const arr = getNestedValue(working, op.path);
          if (!Array.isArray(arr)) {
            result[op.as] = [];
            break;
          }
          result[op.as] = arr.map((item) => {
            const itemContext = { ...context, item };
            return resolveDeep(op.template, itemContext);
          });
          break;
        }
        case 'filter': {
          const arr = getNestedValue(working, op.path);
          if (!Array.isArray(arr)) {
            result[op.as] = [];
            break;
          }
          result[op.as] = arr.filter((item) => {
            const itemContext = { ...context, item };
            return evaluateCondition(op.condition, itemContext);
          });
          break;
        }
        case 'flatten': {
          const arr = getNestedValue(working, op.path);
          result[op.as] = Array.isArray(arr) ? arr.flat() : arr;
          break;
        }
        case 'join': {
          const arr = getNestedValue(working, op.path);
          result[op.as] = Array.isArray(arr) ? arr.join(op.separator) : String(arr ?? '');
          break;
        }
        case 'template': {
          result[op.as] = resolveVariables(op.template, context);
          break;
        }
        case 'lookup': {
          const value = String(getNestedValue(working, op.path) ?? '');
          result[op.as] = op.map[value] ?? op.default ?? value;
          break;
        }
      }

      // Each operation's result feeds into working for chaining
      if ('as' in op) {
        working = result[op.as];
      }
    }

    return result;
  }

  private async executeConditionStep(
    step: ConditionStep,
    template: IntegrationTemplate,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
    signal?: AbortSignal,
    timeoutSignal?: AbortSignal,
  ): Promise<{
    branch: 'then' | 'else';
    apiCalls: number;
    entitiesCreated: number;
    entitiesUpdated: number;
  }> {
    const conditionResult = evaluateCondition(step.expression, context);
    const stepIds = conditionResult ? step.thenSteps : (step.elseSteps ?? []);
    let apiCalls = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;

    for (const stepId of stepIds) {
      const subStep = template.steps.find((s) => s.id === stepId);
      if (!subStep) continue;

      const result = await this.executeStep(
        subStep, template, context, callbacks, addLog, signal, timeoutSignal,
      );
      apiCalls += result.apiCalls;
      entitiesCreated += result.entitiesCreated;
      entitiesUpdated += result.entitiesUpdated;

      if (result.error && !subStep.continueOnError) {
        throw new Error(result.error);
      }
    }

    return {
      branch: conditionResult ? 'then' : 'else',
      apiCalls,
      entitiesCreated,
      entitiesUpdated,
    };
  }

  private async executeLoopStep(
    step: LoopStep,
    template: IntegrationTemplate,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
    signal?: AbortSignal,
    timeoutSignal?: AbortSignal,
  ): Promise<{ iterations: number; apiCalls: number; entitiesCreated: number; entitiesUpdated: number }> {
    const items = resolveVariables(step.items, context);
    if (!Array.isArray(items)) {
      throw new Error('Loop items expression did not resolve to an array');
    }

    const maxIterations = step.maxIterations ?? 100;
    let apiCalls = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let iterations = 0;

    for (let i = 0; i < Math.min(items.length, maxIterations); i++) {
      if (signal?.aborted || timeoutSignal?.aborted) break;

      const item = items[i];
      context.loop = { item, index: i };
      context.vars[step.itemVariable] = item;
      if (step.indexVariable) {
        context.vars[step.indexVariable] = i;
      }

      for (const stepId of step.bodySteps) {
        const subStep = template.steps.find((s) => s.id === stepId);
        if (!subStep) continue;

        const result = await this.executeStep(
          subStep, template, context, callbacks, addLog, signal, timeoutSignal,
        );
        apiCalls += result.apiCalls;
        entitiesCreated += result.entitiesCreated;
        entitiesUpdated += result.entitiesUpdated;

        if (result.error && !subStep.continueOnError) {
          throw new Error(result.error);
        }
      }

      iterations++;

      if (step.delayMs && i < items.length - 1) {
        await new Promise((r) => setTimeout(r, step.delayMs));
      }
    }

    // Clean up loop context
    delete context.loop;

    return { iterations, apiCalls, entitiesCreated, entitiesUpdated };
  }

  private async executeCreateEntityStep(
    step: CreateEntityStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
  ): Promise<string> {
    const resolvedFields = resolveDeep(step.fields, context) as Record<string, unknown>;

    if (!callbacks.onCreateEntity) {
      throw new Error('No onCreateEntity callback provided');
    }

    const id = await callbacks.onCreateEntity(step.entityType, resolvedFields);

    addLog({
      ts: Date.now(),
      stepId: step.id,
      stepLabel: step.label,
      type: 'entity-created',
      detail: `Created ${step.entityType}: ${id}`,
    });

    return id;
  }

  private async executeUpdateEntityStep(
    step: UpdateEntityStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
  ): Promise<void> {
    const resolvedFields = resolveDeep(step.fields, context) as Record<string, unknown>;
    const resolvedId = resolveVariables(step.entityId, context) as string;

    if (!callbacks.onUpdateEntity) {
      throw new Error('No onUpdateEntity callback provided');
    }

    await callbacks.onUpdateEntity(step.entityType, resolvedId, resolvedFields);

    addLog({
      ts: Date.now(),
      stepId: step.id,
      stepLabel: step.label,
      type: 'entity-created',
      detail: `Updated ${step.entityType}: ${resolvedId}`,
    });
  }

  private executeSetVariableStep(
    step: SetVariableStep,
    context: ExecutionContext,
    addLog: (entry: IntegrationRunLogEntry) => void,
  ): void {
    for (const [key, expr] of Object.entries(step.variables)) {
      const value = resolveVariables(expr, context);
      context.vars[key] = value;

      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'variable-set',
        detail: `${key} = ${typeof value === 'string' ? value : JSON.stringify(value)}`,
      });
    }
  }

  private async processOutputs(
    template: IntegrationTemplate,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    addLog: (entry: IntegrationRunLogEntry) => void,
  ): Promise<{ displayResults: unknown; entitiesCreated: number; entitiesUpdated: number }> {
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let displayResults: unknown;

    for (const output of template.outputs) {
      if (output.condition) {
        const shouldProcess = evaluateCondition(output.condition, context);
        if (!shouldProcess) continue;
      }

      const resolved = resolveDeep(output.template, context) as Record<string, unknown>;

      switch (output.type) {
        case 'display':
          displayResults = resolved;
          break;

        case 'create-ioc':
        case 'create-note':
        case 'create-task':
        case 'create-timeline-event': {
          if (callbacks.onCreateEntity) {
            const entityType = output.type.replace('create-', '') as string;
            await callbacks.onCreateEntity(entityType, resolved);
            entitiesCreated++;
            addLog({
              ts: Date.now(),
              stepId: 'output',
              stepLabel: `Output: ${output.type}`,
              type: 'entity-created',
              detail: `Created ${entityType} from output`,
            });
          }
          break;
        }

        case 'update-ioc': {
          if (callbacks.onUpdateEntity) {
            const id = resolved.id as string;
            const fields = { ...resolved };
            delete fields.id;
            await callbacks.onUpdateEntity('ioc', id, fields);
            entitiesUpdated++;
          }
          break;
        }

        case 'notify': {
          const message =
            typeof resolved.message === 'string' ? resolved.message : JSON.stringify(resolved);
          callbacks.onNotify?.(message);
          break;
        }

        case 'post-to-feed': {
          if (callbacks.onPostToFeed) {
            const content = typeof resolved.content === 'string' ? resolved.content : JSON.stringify(resolved);
            const folderId = resolved.folderId as string | undefined;
            await callbacks.onPostToFeed(content, folderId);
          }
          break;
        }
      }
    }

    return { displayResults, entitiesCreated, entitiesUpdated };
  }

  private buildInputSummary(input: ExecutionInput): string {
    const parts: string[] = [];
    if (input.ioc) {
      parts.push(`IOC: ${input.ioc.value} (${input.ioc.type})`);
    }
    if (input.investigation) {
      parts.push(`Investigation: ${input.investigation.name}`);
    }
    return parts.join(', ') || 'No input';
  }

  private buildOutputSummary(
    status: IntegrationRunStatus,
    entitiesCreated: number,
    entitiesUpdated: number,
    apiCallsMade: number,
  ): string {
    if (status === 'error') return 'Failed';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'timeout') return 'Timed out';

    const parts: string[] = [];
    if (apiCallsMade > 0) parts.push(`${apiCallsMade} API call${apiCallsMade !== 1 ? 's' : ''}`);
    if (entitiesCreated > 0) parts.push(`${entitiesCreated} created`);
    if (entitiesUpdated > 0) parts.push(`${entitiesUpdated} updated`);
    return parts.join(', ') || 'Completed';
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
