import { nanoid } from 'nanoid';
import { resolveVariables, resolveDataValue, evaluateCondition, resolveDeep } from './integration-expression';
import { compileIntegrationPlan, INTEGRATION_LIMITS } from './integration-plan';
import type { IntegrationPlan } from './integration-plan';
import { postMessageOrigin } from './utils';
import { resolveIntegrationConfig, validateIntegrationConfig } from './integration-config';
import { cancellableRequest } from './request-cancellation';
import { awaitIntegrationResult, integrationDelay } from './integration-cancellation';
import { readIntegrationResponse } from './integration-response';
import { IntegrationDataBudget } from './integration-data-budget';
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
} from '../types/integration-types';

export interface ExecutionInput {
  ioc?: { id: string; value: string; type: string; confidence: string };
  investigation?: { id: string; name: string };
}

export interface ExecutionCallbacks {
  onCreateEntity?: (type: string, fields: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
  onUpdateEntity?: (type: string, id: string, fields: Record<string, unknown>, signal?: AbortSignal) => Promise<void>;
  onNotify?: (message: string) => void;
  onLog?: (entry: IntegrationRunLogEntry) => void;
}

export interface ExecutionOptions {
  /** Optional lower bound for a bounded/manual run; cannot raise the hard limit. */
  maxStepVisits?: number;
  /** May lower, never raise, the cumulative derived-data limit. */
  maxDerivedBytes?: number;
  /**
   * When set, HTTP requests are routed through `POST <serverUrl>/api/proxy-fetch`
   * instead of going directly from the browser. This lets the server enforce
   * DNS-level SSRF checks that the client cannot perform.
   */
  useServerProxy?: {
    serverUrl: string;
    getAccessToken: () => Promise<string | null>;
  };
}

/**
 * Proxy fetch via the team server (`POST /api/proxy-fetch`).
 * The server can perform DNS resolution to block private IPs.
 */
async function serverProxyFetch(
  serverUrl: string,
  getAccessToken: () => Promise<string | null>,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  signal: AbortSignal,
  onDispatch: () => void,
): Promise<{ ok: boolean; status: number; statusText: string; data: unknown; headers: Record<string, string> }> {
  signal.throwIfAborted();
  const token = await awaitIntegrationResult(getAccessToken(), signal);
  signal.throwIfAborted();
  onDispatch();
  const resp = await fetch(`${serverUrl}/api/proxy-fetch`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url, method, headers, body }),
  });
  const result = await awaitIntegrationResult(resp.json(), signal);
  signal.throwIfAborted();
  if (!resp.ok) {
    throw new Error(result.error || `Server proxy error: ${resp.status}`);
  }
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    statusText: result.statusText || '',
    data: result.data,
    headers: result.headers || {},
  };
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

/**
 * Collect secret values from the installation config based on the template's
 * configSchema.  Used to redact secrets from log entries.
 */
function collectSecretValues(
  template: IntegrationTemplate,
  config: Record<string, unknown>,
): string[] {
  const secrets: string[] = [];
  for (const field of template.configSchema) {
    if ((field.secret || field.type === 'password') && config[field.key]) {
      const val = String(config[field.key]);
      if (val.length > 0) secrets.push(val);
    }
  }
  return secrets;
}

/** Replace known secret values in a string with [REDACTED]. */
function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    // Only redact secrets that are at least 4 chars to avoid false positives
    if (secret.length >= 4) {
      result = result.replaceAll(secret, '[REDACTED]');
    }
  }
  return result;
}

/**
 * Enforce that a resolved URL's hostname matches the template's requiredDomains.
 * Prevents a tampered template from exfiltrating secrets to arbitrary domains.
 */
function enforceRequiredDomains(url: URL, requiredDomains: string[]): void {
  if (!requiredDomains || requiredDomains.length === 0) return;
  const host = url.hostname;
  const allowed = requiredDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!allowed) {
    throw new Error(
      `Blocked request to ${host} — not in allowed domains: ${requiredDomains.join(', ')}`,
    );
  }
}

/**
 * Validate that a URL is safe to fetch (SSRF mitigation).
 *
 * Limitation: this is a client-side check on the literal hostname string.
 * It cannot perform DNS resolution, so a public hostname that resolves to
 * a private IP (DNS rebinding) will bypass this filter. When a team server
 * is available, callers should route requests through `POST /api/proxy-fetch`
 * which can enforce server-side DNS checks.
 */
function validateHttpUrl(urlStr: string): URL {
  const url = new URL(urlStr);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Blocked URL scheme: ${url.protocol} — only HTTP/HTTPS allowed`);
  }
  const host = url.hostname;
  if (
    ['169.254.169.254', 'localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) ||
    host === '::ffff:127.0.0.1' ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`Blocked request to private/internal address: ${host}`);
  }
  return url;
}

/**
 * Proxy fetch via the extension bridge (postMessage → bridge.js → background.js).
 * Returns a Response-like object. Used to bypass CSP/CORS in extension context.
 */
function bridgeProxyFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; statusText: string; data: unknown; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const requestId = nanoid();
    const cleanup = () => {
      window.removeEventListener('message', handler);
      signal.removeEventListener('abort', abort);
      clearTimeout(timeout);
    };
    const cancelTransport = () => {
      try { window.postMessage({ type: 'TC_PROXY_ABORT', requestId }, postMessageOrigin()); } catch { /* no receiver */ }
    };
    const abort = () => { cleanup(); cancelTransport(); reject(signal.reason); };
    const timeout = setTimeout(() => {
      cleanup();
      cancelTransport();
      reject(new Error('Bridge proxy fetch timed out (30s)'));
    }, 30000);

    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== 'TC_PROXY_FETCH_RESULT') return;
      if (event.data.requestId !== requestId) return;
      cleanup();

      if (!event.data.success && event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve({
          ok: event.data.status >= 200 && event.data.status < 300,
          status: event.data.status,
          statusText: event.data.statusText || '',
          data: event.data.data,
          headers: event.data.headers || {},
        });
      }
    }

    window.addEventListener('message', handler);
    signal.addEventListener('abort', abort, { once: true });
    try { window.postMessage({
      type: 'TC_PROXY_FETCH',
      requestId,
      url,
      method,
      headers,
      body,
    }, postMessageOrigin()); } catch (error) { cleanup(); reject(error); }
  });
}

/** Sync allowed proxy domains to the extension so the background script can enforce an allowlist. */
export function syncProxyAllowedDomains(templates: IntegrationTemplate[]): void {
  const domains = new Set<string>();
  for (const t of templates) {
    for (const d of t.requiredDomains ?? []) {
      domains.add(d);
    }
  }
  try {
    window.postMessage({ type: 'TC_SET_PROXY_DOMAINS', domains: [...domains] }, postMessageOrigin());
  } catch { /* extension not present */ }
}

/** Check if the extension bridge supports proxy_fetch */
function hasBridgeProxyFetch(): boolean {
  try {
    const caps = document.documentElement.dataset.tcBridgeCaps || '';
    return caps.split(',').includes('proxy_fetch');
  } catch {
    return false;
  }
}

export class IntegrationExecutor {
  private readonly executions = new WeakMap<ExecutionContext, { plan: IntegrationPlan; visits: number; limit: number; apiCalls: number; data: IntegrationDataBudget; fatal?: string }>();

  private dataBudget(context: ExecutionContext): IntegrationDataBudget {
    const execution = this.executions.get(context);
    if (!execution) throw new Error('Integration execution state is unavailable');
    return execution.data;
  }

  async run(
    template: IntegrationTemplate,
    installation: InstalledIntegration,
    input: ExecutionInput,
    callbacks: ExecutionCallbacks,
    signal?: AbortSignal,
    options?: ExecutionOptions,
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

    let plan: IntegrationPlan | undefined;
    let config: Record<string, unknown> = {};
    let preflightError: string | undefined;
    let dataBudget: IntegrationDataBudget | undefined;
    try {
      dataBudget = new IntegrationDataBudget(options?.maxDerivedBytes);
      plan = compileIntegrationPlan(template);
      template = plan.template as unknown as IntegrationTemplate;
      if (options?.maxStepVisits !== undefined && (!Number.isSafeInteger(options.maxStepVisits) || options.maxStepVisits < 1 || options.maxStepVisits > INTEGRATION_LIMITS.visits)) {
        throw new Error('Integration step budget is outside its supported range');
      }
      config = structuredClone(resolveIntegrationConfig(template.configSchema, installation.config));
      input = structuredClone(input);
      const missingConfig = validateIntegrationConfig(template.configSchema, config);
      if (missingConfig.length) preflightError = `Configure valid integration settings before running: ${missingConfig.map(field => field.label).join(', ')}.`;
    } catch (err) {
      preflightError = err instanceof Error ? err.message : 'Invalid integration template';
    }
    if (preflightError || !plan || !dataBudget) {
      return {
        id: runId,
        integrationId: installation.id,
        templateId: typeof template?.id === 'string' ? template.id : '',
        status: 'error',
        trigger: 'manual',
        inputSummary: this.buildInputSummary(input),
        outputSummary: this.buildOutputSummary('error', 0, 0, 0),
        durationMs: Date.now() - startTime,
        error: preflightError,
        entitiesCreated: 0,
        entitiesUpdated: 0,
        apiCallsMade: 0,
        log: [],
        createdAt: startTime,
      };
    }

    const context: ExecutionContext = {
      ioc: input.ioc,
      investigation: input.investigation,
      config,
      now: new Date().toISOString(),
      steps: Object.create(null) as Record<string, unknown>,
      vars: Object.create(null) as Record<string, unknown>,
    };
    const execution = { plan, visits: 0, limit: options?.maxStepVisits ?? INTEGRATION_LIMITS.visits, apiCalls: 0, data: dataBudget, fatal: undefined as string | undefined };
    this.executions.set(context, execution);

    const secrets = collectSecretValues(template, config);

    const addLog = (entry: IntegrationRunLogEntry) => {
      // Redact any secret values that leaked into log detail strings
      const redacted = entry.detail
        ? { ...entry, detail: redactSecrets(entry.detail, secrets) }
        : entry;
      if (log.length < INTEGRATION_LIMITS.logs - 1) {
        log.push(redacted);
        callbacks.onLog?.(redacted);
      } else if (log.length === INTEGRATION_LIMITS.logs - 1) {
        const marker: IntegrationRunLogEntry = { ts: Date.now(), stepId: 'log-limit', stepLabel: 'Log limit', type: 'step-complete', detail: 'Further log entries omitted after the bounded log limit.' };
        log.push(marker);
        callbacks.onLog?.(marker);
      }
    };

    const lifecycle = cancellableRequest(signal);
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), MAX_EXECUTION_MS);
    const runSignal = AbortSignal.any([lifecycle.signal, timeoutController.signal]);

    try {
      runSignal.throwIfAborted();
      for (const id of plan.roots) {
        const step = plan.byId.get(id) as unknown as IntegrationStep;
        const stepResult = await this.executeStep(
          step,
          template,
          context,
          callbacks,
          addLog,
          runSignal,
          timeoutController.signal,
          options,
        );

        apiCallsMade += stepResult.apiCalls;
        entitiesCreated += stepResult.entitiesCreated;
        entitiesUpdated += stepResult.entitiesUpdated;
        runSignal.throwIfAborted();
        if (execution.fatal || execution.data.exceeded) throw new Error(execution.fatal ?? 'Integration exceeded its derived-data budget');
        if (stepResult.skipped) continue;

        if (stepResult.error) {
          if (!step.continueOnError) {
            error = redactSecrets(stepResult.error, secrets);
            status = 'error';
            break;
          }
        }
      }

      if (status === 'running') {
        // Process outputs
        runSignal.throwIfAborted();
        const outputResult = await this.processOutputs(template, context, callbacks, addLog, runSignal);
        entitiesCreated += outputResult.entitiesCreated;
        entitiesUpdated += outputResult.entitiesUpdated;
        displayResults = outputResult.displayResults;
        if (outputResult.failure) throw outputResult.failure.error;
        runSignal.throwIfAborted();
        status = 'success';
      }
    } catch (err) {
      if (lifecycle.signal.aborted) {
        status = 'cancelled';
      } else if (timeoutController.signal.aborted) {
        status = 'timeout';
        error = 'Execution exceeded 5 minute timeout';
      } else {
        status = 'error';
        error = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
      }
    } finally {
      // Count attempted requests even when a response/read/retry ultimately fails.
      apiCallsMade = execution.apiCalls;
      clearTimeout(timeoutId);
      lifecycle.dispose();
      this.executions.delete(context);
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
    options?: ExecutionOptions,
  ): Promise<{
    skipped: boolean;
    error?: string;
    apiCalls: number;
    entitiesCreated: number;
    entitiesUpdated: number;
  }> {
    const execution = this.executions.get(context);
    if (!execution) throw new Error('Integration execution state is unavailable');
    if (execution.fatal || execution.data.exceeded || ++execution.visits > execution.limit) {
      execution.fatal ??= execution.data.exceeded ? 'Integration exceeded its derived-data budget' : 'Integration exceeded its total step budget';
      return { skipped: false, error: execution.fatal, apiCalls: 0, entitiesCreated: 0, entitiesUpdated: 0 };
    }
    // Check condition
    if (step.condition) {
      try {
        const shouldRun = evaluateCondition(step.condition, context, execution.data);
        if (!shouldRun) return { skipped: true, apiCalls: 0, entitiesCreated: 0, entitiesUpdated: 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Integration condition failed';
        if (execution.data.exceeded) execution.fatal = message;
        return { skipped: false, error: message, apiCalls: 0, entitiesCreated: 0, entitiesUpdated: 0 };
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
          const result = await this.executeHttpStep(step, template, context, addLog, signal, timeoutSignal, options);
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
            step,
            template,
            context,
            callbacks,
            addLog,
            signal,
            timeoutSignal,
            options,
          );
          context.steps[step.id] = { branch: result.branch };
          apiCalls += result.apiCalls;
          entitiesCreated += result.entitiesCreated;
          entitiesUpdated += result.entitiesUpdated;
          if (result.error) return { skipped: false, error: result.error, apiCalls, entitiesCreated, entitiesUpdated };
          break;
        }
        case 'loop': {
          const result = await this.executeLoopStep(
            step,
            template,
            context,
            callbacks,
            addLog,
            signal,
            timeoutSignal,
            options,
          );
          context.steps[step.id] = { iterations: result.iterations };
          apiCalls += result.apiCalls;
          entitiesCreated += result.entitiesCreated;
          entitiesUpdated += result.entitiesUpdated;
          if (result.error) return { skipped: false, error: result.error, apiCalls, entitiesCreated, entitiesUpdated };
          break;
        }
        case 'create-entity': {
          const id = await this.executeCreateEntityStep(step, context, callbacks, signal);
          context.steps[step.id] = { id };
          entitiesCreated += 1;
          addLog({ ts: Date.now(), stepId: step.id, stepLabel: step.label,
            type: 'entity-created', detail: `Created ${step.entityType}: ${id}` });
          break;
        }
        case 'update-entity': {
          const id = await this.executeUpdateEntityStep(step, context, callbacks, signal);
          context.steps[step.id] = { updated: true };
          entitiesUpdated += 1;
          addLog({ ts: Date.now(), stepId: step.id, stepLabel: step.label,
            type: 'entity-created', detail: `Updated ${step.entityType}: ${id}` });
          break;
        }
        case 'set-variable': {
          this.executeSetVariableStep(step, context, addLog);
          context.steps[step.id] = { set: true };
          break;
        }
        case 'delay': {
          await integrationDelay(step.ms, signal);
          context.steps[step.id] = { delayed: step.ms };
          break;
        }
      }

      signal?.throwIfAborted();
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
      if (execution.data.exceeded) execution.fatal = errorMessage;
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
    template: IntegrationTemplate,
    context: ExecutionContext,
    addLog: (entry: IntegrationRunLogEntry) => void,
    signal?: AbortSignal,
    timeoutSignal?: AbortSignal,
    options?: ExecutionOptions,
  ): Promise<Record<string, unknown>> {
    const budget = this.dataBudget(context);
    const resolvedUrl = resolveVariables(step.url, context, budget);
    const resolvedHeaders = step.headers
      ? (resolveDeep(step.headers, context, budget) as Record<string, string>)
      : {};
    const resolvedParams = step.queryParams
      ? (resolveDeep(step.queryParams, context, budget) as Record<string, string>)
      : {};
    const resolvedBody = step.body != null ? resolveDeep(step.body, context, budget) : undefined;

    // Validate URL before fetching (SSRF protection)
    const url = validateHttpUrl(resolvedUrl);
    for (const [key, value] of Object.entries(resolvedParams)) {
      url.searchParams.set(key, String(value));
    }

    // Enforce required domains — prevents templates from exfiltrating secrets
    enforceRequiredDomains(url, template.requiredDomains);

    const maxRetries = step.retry?.maxRetries ?? 0;
    const retryOn = step.retry?.retryOn ?? [];
    const backoffMs = step.retry?.backoffMs ?? 1000;
    let apiCalls = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      signal?.throwIfAborted();
      timeoutSignal?.throwIfAborted();
      // Build fetch options
      const fetchOptions: RequestInit = {
        method: step.method,
        headers: resolvedHeaders,
      };

      if (resolvedBody != null && step.method !== 'GET') {
        if (step.contentType === 'form') {
          // Percent encoding expands each UTF-8 byte by at most three. Reserve
          // that conservative bound before URLSearchParams allocates the body.
          budget.chargeJSON(resolvedBody);
          budget.chargeJSON(resolvedBody);
          budget.chargeJSON(resolvedBody);
          fetchOptions.body = new URLSearchParams(resolvedBody as Record<string, string>);
        } else if (step.contentType === 'text') {
          fetchOptions.body = budget.join([resolvedBody], '');
        } else {
          fetchOptions.body = budget.stringify(resolvedBody);
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
      const onDispatch = () => {
        const execution = this.executions.get(context);
        if (execution) execution.apiCalls++;
      };

      let responseStatus: number;
      let responseStatusText: string;
      let responseData: unknown;
      let responseHeaders: Record<string, string> = {};

      // Serialize body for proxy transports
      const serializeBody = () =>
        fetchOptions.body instanceof URLSearchParams
          ? fetchOptions.body.toString()
          : typeof fetchOptions.body === 'string'
            ? fetchOptions.body
            : fetchOptions.body != null ? String(fetchOptions.body) : null;

      if (options?.useServerProxy) {
        // Route through team server — server can enforce DNS-level SSRF checks
        const proxyHeaders = { ...(fetchOptions.headers as Record<string, string>) };
        if (fetchOptions.body instanceof URLSearchParams && !proxyHeaders['Content-Type'] && !proxyHeaders['content-type']) {
          proxyHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        const proxyResult = await serverProxyFetch(
          options.useServerProxy.serverUrl,
          options.useServerProxy.getAccessToken,
          url.toString(), step.method, proxyHeaders, serializeBody(), fetchOptions.signal, onDispatch,
        );
        responseStatus = proxyResult.status;
        responseStatusText = proxyResult.statusText;
        responseData = step.responseType === 'text' ? String(proxyResult.data) : proxyResult.data;
        responseHeaders = proxyResult.headers;
      } else if (hasBridgeProxyFetch()) {
        // Route through extension background script to bypass CSP/CORS
        const proxyHeaders = { ...(fetchOptions.headers as Record<string, string>) };
        if (fetchOptions.body instanceof URLSearchParams && !proxyHeaders['Content-Type'] && !proxyHeaders['content-type']) {
          proxyHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        onDispatch();
        const proxyResult = await bridgeProxyFetch(url.toString(), step.method, proxyHeaders, serializeBody(), fetchOptions.signal);
        responseStatus = proxyResult.status;
        responseStatusText = proxyResult.statusText;
        responseData = step.responseType === 'text' ? String(proxyResult.data) : proxyResult.data;
        responseHeaders = proxyResult.headers;
      } else {
        // Direct fetch (standalone mode)
        onDispatch();
        const response = await fetch(url.toString(), fetchOptions);
        responseStatus = response.status;
        responseStatusText = response.statusText;
        const text = await readIntegrationResponse(response, fetchOptions.signal);
        if (step.responseType === 'text') responseData = text;
        else {
          try { responseData = JSON.parse(text); } catch { responseData = null; }
        }
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
      }

      fetchOptions.signal.throwIfAborted();
      addLog({
        ts: Date.now(),
        stepId: step.id,
        stepLabel: step.label,
        type: 'http-response',
        detail: `${responseStatus} ${responseStatusText}`,
      });

      // Check if we should retry
      if (responseStatus >= 400 && attempt < maxRetries && retryOn.includes(responseStatus)) {
        await integrationDelay(backoffMs * (attempt + 1), signal);
        continue;
      }

      if (responseStatus >= 400) {
        throw new Error(`HTTP ${responseStatus}: ${responseStatusText}`);
      }

      // Step results remain reachable for the whole run. Charge them before
      // retaining another response, not only when a later transform reads it.
      budget.chargeJSON(responseData);
      budget.chargeJSON(responseHeaders);
      return {
        response: {
          status: responseStatus,
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
    // Resolve the input — if it's a single {{path}} expression, preserve the
    // raw object so extract/map/filter can traverse its properties. When the
    // template contains surrounding text or multiple expressions we fall back
    // to the stringified value.
    const budget = this.dataBudget(context);
    const sourceData = resolveDataValue(step.input, context, budget);
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

    // Make sourceData available as a working value
    let working: unknown = sourceData;

    for (const op of step.operations) {
      const execution = this.executions.get(context);
      const value = 'path' in op ? getNestedValue(op.op === 'extract' ? sourceData : working, op.path) : undefined;
      const remaining = execution ? execution.limit - execution.visits : 0;
      const work = boundedDataWork(value, remaining);
      if (!execution || work > remaining) {
        if (execution) execution.fatal = 'Integration exceeded its total step budget';
        throw new Error('Integration exceeded its total step budget');
      }
      execution.visits += work;
      switch (op.op) {
        case 'extract': {
          // Extract always reads from the original sourceData so multiple
          // independent extracts don't interfere with each other.
          const value = getNestedValue(sourceData, op.path);
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
            return resolveDeep(op.template, itemContext, budget);
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
            return evaluateCondition(op.condition, itemContext, budget);
          });
          break;
        }
        case 'flatten': {
          const arr = getNestedValue(working, op.path);
          budget.chargeJSON(arr);
          result[op.as] = Array.isArray(arr) ? arr.flat() : arr;
          break;
        }
        case 'join': {
          const arr = getNestedValue(working, op.path);
          result[op.as] = budget.join(Array.isArray(arr) ? arr : [arr], op.separator);
          break;
        }
        case 'template': {
          result[op.as] = resolveVariables(op.template, context, budget);
          break;
        }
        case 'lookup': {
          const value = budget.join([getNestedValue(working, op.path)], '');
          result[op.as] = (Object.hasOwn(op.map, value) ? op.map[value] : undefined) ?? op.default ?? value;
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
    options?: ExecutionOptions,
  ): Promise<{
    branch: 'then' | 'else';
    apiCalls: number;
    entitiesCreated: number;
    entitiesUpdated: number;
    error?: string;
  }> {
    const conditionResult = evaluateCondition(step.expression, context, this.dataBudget(context));
    const stepIds = conditionResult ? step.thenSteps : (step.elseSteps ?? []);
    let apiCalls = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;

    for (const stepId of stepIds) {
      const subStep = this.executions.get(context)?.plan.byId.get(stepId) as unknown as IntegrationStep;

      const result = await this.executeStep(
        subStep,
        template,
        context,
        callbacks,
        addLog,
        signal,
        timeoutSignal,
        options,
      );
      apiCalls += result.apiCalls;
      entitiesCreated += result.entitiesCreated;
      entitiesUpdated += result.entitiesUpdated;

      // Return committed child counts to the parent before its cancellation gate.
      if (signal?.aborted || timeoutSignal?.aborted) break;
      if (result.error && (!subStep.continueOnError || this.executions.get(context)?.fatal)) {
        return { branch: conditionResult ? 'then' : 'else', error: result.error, apiCalls, entitiesCreated, entitiesUpdated };
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
    options?: ExecutionOptions,
  ): Promise<{ iterations: number; apiCalls: number; entitiesCreated: number; entitiesUpdated: number; error?: string }> {
    const items = resolveDataValue(step.items, context, this.dataBudget(context));
    if (!Array.isArray(items)) {
      throw new Error(`Loop items expression did not resolve to an array`);
    }

    const maxIterations = step.maxIterations ?? 100;
    let apiCalls = 0;
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let iterations = 0;
    const count = Math.min(items.length, maxIterations);
    const outerLoop = context.loop;
    const variables = new Map([step.itemVariable, ...(step.indexVariable ? [step.indexVariable] : [])]
      .map(key => [key, Object.getOwnPropertyDescriptor(context.vars, key)]));
    try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted || timeoutSignal?.aborted) break;
      const execution = this.executions.get(context);
      if (!execution || ++execution.visits > execution.limit) {
        if (execution) execution.fatal = 'Integration exceeded its total step budget';
        return { iterations, error: 'Integration exceeded its total step budget', apiCalls, entitiesCreated, entitiesUpdated };
      }

      const item = items[i];
      context.loop = { item, index: i };
      context.vars[step.itemVariable] = item;
      if (step.indexVariable) {
        context.vars[step.indexVariable] = i;
      }

      for (const stepId of step.bodySteps) {
        const subStep = execution.plan.byId.get(stepId) as unknown as IntegrationStep;

        const result = await this.executeStep(
          subStep,
          template,
          context,
          callbacks,
          addLog,
          signal,
          timeoutSignal,
          options,
        );
        apiCalls += result.apiCalls;
        entitiesCreated += result.entitiesCreated;
        entitiesUpdated += result.entitiesUpdated;

        if (signal?.aborted || timeoutSignal?.aborted) return { iterations, apiCalls, entitiesCreated, entitiesUpdated };
        if (result.error && (!subStep.continueOnError || execution.fatal)) {
          return { iterations, error: result.error, apiCalls, entitiesCreated, entitiesUpdated };
        }
      }

      iterations++;

      if (step.delayMs && i < count - 1) {
        await integrationDelay(step.delayMs, signal);
      }
    }
    } catch (error) {
      return { iterations, error: error instanceof Error ? error.message : 'Loop failed', apiCalls, entitiesCreated, entitiesUpdated };
    } finally {
      if (outerLoop === undefined) delete context.loop;
      else context.loop = outerLoop;
      for (const [key, descriptor] of variables) {
        if (descriptor) Object.defineProperty(context.vars, key, descriptor);
        else delete context.vars[key];
      }
    }

    return { iterations, apiCalls, entitiesCreated, entitiesUpdated };
  }

  private async executeCreateEntityStep(
    step: CreateEntityStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    signal?: AbortSignal,
  ): Promise<string> {
    const resolvedFields = resolveDeep(step.fields, context, this.dataBudget(context)) as Record<string, unknown>;

    if (!callbacks.onCreateEntity) {
      throw new Error('No onCreateEntity callback provided');
    }

    signal?.throwIfAborted();
    const id = await callbacks.onCreateEntity(step.entityType, resolvedFields, signal);
    return id;
  }

  private async executeUpdateEntityStep(
    step: UpdateEntityStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks,
    signal?: AbortSignal,
  ): Promise<string> {
    const resolvedFields = resolveDeep(step.fields, context, this.dataBudget(context)) as Record<string, unknown>;
    const resolvedId = resolveVariables(step.entityId, context, this.dataBudget(context)) as string;

    if (!callbacks.onUpdateEntity) {
      throw new Error('No onUpdateEntity callback provided');
    }

    signal?.throwIfAborted();
    await callbacks.onUpdateEntity(step.entityType, resolvedId, resolvedFields, signal);
    return resolvedId;
  }

  private executeSetVariableStep(
    step: SetVariableStep,
    context: ExecutionContext,
    addLog: (entry: IntegrationRunLogEntry) => void,
  ): void {
    for (const [key, expr] of Object.entries(step.variables)) {
      const value = resolveVariables(expr, context, this.dataBudget(context));
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
    signal: AbortSignal,
  ): Promise<{ displayResults: unknown; entitiesCreated: number; entitiesUpdated: number; failure?: { error: unknown } }> {
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let displayResults: unknown;

    for (const output of template.outputs) {
      try {
        signal.throwIfAborted();
        if (output.condition) {
          const shouldProcess = evaluateCondition(output.condition, context, this.dataBudget(context));
          if (!shouldProcess) continue;
        }

        const resolved = resolveDeep(output.template, context, this.dataBudget(context)) as Record<string, unknown>;

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
              // For notes, attach raw API responses and transform results for rich formatting
              if (output.type === 'create-note') {
                const httpResponses: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
                const transformResults: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
                for (const [stepId, stepData] of Object.entries(context.steps)) {
                  const data = stepData as Record<string, unknown>;
                  if (data?.response) {
                    httpResponses[stepId] = (data.response as Record<string, unknown>).data;
                  } else if (!data?._apiCalls && !data?.branch) {
                    // Transform step results (no _apiCalls or branch property)
                    transformResults[stepId] = data;
                  }
                }
                resolved._rawResponses = httpResponses;
                resolved._transformResults = transformResults;
                // Note formatters materialize these references as text, including
                // repeated aliases. Reserve that complete payload before handing
                // it to a callback that can allocate and persist the note.
                this.dataBudget(context).chargeJSON(resolved);
              }
              await callbacks.onCreateEntity(entityType, resolved, signal);
              entitiesCreated++;
              signal.throwIfAborted();
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
              await callbacks.onUpdateEntity('ioc', id, fields, signal);
              entitiesUpdated++;
              signal.throwIfAborted();
            }
            break;
          }

          case 'notify': {
            const message =
              typeof resolved.message === 'string' ? resolved.message : this.dataBudget(context).stringify(resolved);
            callbacks.onNotify?.(message);
            break;
          }

          case 'post-to-feed':
            // post-to-feed is handled at a higher level
            break;
        }
      } catch (error) {
        // Preserve acknowledgements from completed callbacks even when this or
        // a later output is cancelled. The caller records them before failing.
        return { displayResults, entitiesCreated, entitiesUpdated, failure: { error } };
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
      if (!Object.hasOwn(current, part)) return undefined;
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Charge nested materialization before map/flatten allocate their result. */
function boundedDataWork(value: unknown, remaining: number): number {
  const pending: unknown[] = [value];
  let work = 0;
  while (pending.length && work <= remaining) {
    const item = pending.pop();
    work++;
    if (item && typeof item === 'object') {
      // Do not allocate an unbounded temporary Object.values array.
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (pending.length + work > remaining) return remaining + 1;
        pending.push((item as Record<string, unknown>)[key]);
      }
    }
  }
  return pending.length ? remaining + 1 : work;
}
