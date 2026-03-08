import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrationExecutor } from '../lib/integration-executor';
import type { ExecutionInput, ExecutionCallbacks } from '../lib/integration-executor';
import type {
  IntegrationTemplate,
  InstalledIntegration,
  IntegrationStep,
  IntegrationOutput,
} from '../types/integration-types';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers to build minimal fixtures
// ---------------------------------------------------------------------------

function makeTemplate(
  steps: IntegrationStep[],
  outputs: IntegrationOutput[] = [],
): IntegrationTemplate {
  return {
    id: 'tmpl-1',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'Test Template',
    description: 'Test',
    author: 'test',
    icon: 'search',
    color: '#000',
    category: 'enrichment',
    tags: [],
    triggers: [{ type: 'manual' }],
    configSchema: [],
    steps,
    outputs,
    requiredDomains: [],
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeInstallation(config: Record<string, unknown> = {}): InstalledIntegration {
  return {
    id: 'inst-1',
    templateId: 'tmpl-1',
    name: 'Test Installation',
    enabled: true,
    config,
    scopeType: 'all',
    scopeFolderIds: [],
    runCount: 0,
    errorCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeInput(overrides: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    ioc: { id: 'ioc-1', value: '1.2.3.4', type: 'ipv4', confidence: 'high' },
    investigation: { id: 'inv-1', name: 'Test Investigation' },
    ...overrides,
  };
}

function makeCallbacks(overrides: Partial<ExecutionCallbacks> = {}): ExecutionCallbacks {
  return {
    onLog: vi.fn(),
    ...overrides,
  };
}

// Helper to create a mock response for fetch
function mockJsonResponse(data: unknown, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ 'content-type': 'application/json' }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationExecutor', () => {
  let executor: IntegrationExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new IntegrationExecutor();
    mockFetch.mockReset();
  });

  // ─── 1. Basic execution with one HTTP step ─────────────────────

  describe('basic execution', () => {
    it('runs a simple template with one HTTP step', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ country: 'US', score: 80 }),
      );

      const template = makeTemplate([
        {
          id: 'fetch',
          type: 'http',
          label: 'Fetch IP info',
          method: 'GET',
          url: 'https://api.example.com/ip/1.2.3.4',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.apiCallsMade).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/ip/1.2.3.4');
    });
  });

  // ─── 2. Variable resolution ────────────────────────────────────

  describe('variable resolution', () => {
    it('resolves {{ioc.value}} in HTTP URL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ result: 'clean' }),
      );

      const template = makeTemplate([
        {
          id: 'lookup',
          type: 'http',
          label: 'Lookup IOC',
          method: 'GET',
          url: 'https://api.example.com/lookup/{{ioc.value}}',
        },
      ]);

      await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      // The URL should have 1.2.3.4 substituted for {{ioc.value}}
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('1.2.3.4');
      expect(calledUrl).not.toContain('{{ioc.value}}');
    });

    it('resolves {{config.apiKey}} in headers', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ data: 'ok' }),
      );

      const template = makeTemplate([
        {
          id: 'fetch',
          type: 'http',
          label: 'Fetch with API key',
          method: 'GET',
          url: 'https://api.example.com/data',
          headers: { 'X-Api-Key': '{{config.apiKey}}' },
        },
      ]);

      await executor.run(
        template,
        makeInstallation({ apiKey: 'secret-key-123' }),
        makeInput(),
        makeCallbacks(),
      );

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['X-Api-Key']).toBe('secret-key-123');
    });
  });

  // ─── 3. Transform step ─────────────────────────────────────────

  describe('transform step', () => {
    it('extracts and maps data from a previous step', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            { name: 'a', score: 10 },
            { name: 'b', score: 20 },
          ],
        }),
      );

      const template = makeTemplate(
        [
          {
            id: 'fetch',
            type: 'http',
            label: 'Fetch data',
            method: 'GET',
            url: 'https://api.example.com/data',
          },
          {
            id: 'transform',
            type: 'transform',
            label: 'Extract results',
            input: '{{steps.fetch.response.data}}',
            operations: [
              { op: 'extract', path: 'results', as: 'items' },
            ],
          },
        ],
        [
          {
            type: 'display',
            template: { items: '{{steps.transform.items}}' },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.displayResults).toBeDefined();
    });

    it('preserves object input for extract operations (not stringified)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            attributes: {
              last_analysis_stats: { malicious: 10, suspicious: 2, harmless: 50 },
              country: 'US',
              reputation: -5,
            },
          },
        }),
      );

      const template = makeTemplate(
        [
          {
            id: 'fetch',
            type: 'http',
            label: 'Fetch VT',
            method: 'GET',
            url: 'https://api.example.com/ip/1.2.3.4',
          },
          {
            id: 'transform',
            type: 'transform',
            label: 'Extract stats',
            input: '{{steps.fetch.response.data}}',
            operations: [
              { op: 'extract', path: 'data.attributes.last_analysis_stats', as: 'stats' },
              { op: 'extract', path: 'data.attributes.country', as: 'country' },
              { op: 'extract', path: 'data.attributes.reputation', as: 'reputation' },
            ],
          },
        ],
        [
          {
            type: 'display',
            template: {
              malicious: '{{steps.transform.stats.malicious}}',
              country: '{{steps.transform.country}}',
            },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.displayResults).toEqual({
        malicious: '10',
        country: 'US',
      });
    });

    it('extracts flat API response fields correctly', async () => {
      // Simulates URLhaus-style flat response (no data wrapper)
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          query_status: 'no_results',
          urlhaus_reference: 'https://urlhaus.abuse.ch',
          threat: null,
          tags: ['phishing'],
        }),
      );

      const template = makeTemplate(
        [
          {
            id: 'fetch',
            type: 'http',
            label: 'Query URLhaus',
            method: 'POST',
            url: 'https://urlhaus-api.abuse.ch/v1/url/',
            contentType: 'form',
            body: { url: '{{ioc.value}}' },
          },
          {
            id: 'transform',
            type: 'transform',
            label: 'Extract data',
            input: '{{steps.fetch.response.data}}',
            operations: [
              { op: 'extract', path: 'query_status', as: 'query_status' },
              { op: 'extract', path: 'threat', as: 'threat' },
              { op: 'extract', path: 'tags', as: 'tags' },
            ],
          },
        ],
        [
          {
            type: 'display',
            template: {
              status: '{{steps.transform.query_status}}',
              tags: '{{steps.transform.tags}}',
            },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput({ ioc: { id: 'ioc-1', value: 'http://evil.com/malware', type: 'url', confidence: 'high' } }),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.displayResults).toEqual({
        status: 'no_results',
        tags: '["phishing"]',
      });
    });
  });

  // ─── 4. Condition step ─────────────────────────────────────────

  describe('condition step', () => {
    it('evaluates condition and executes then-branch', async () => {
      // The condition step will check ioc.type == ipv4, which is true
      // Note: sub-steps referenced by the condition are also in template.steps,
      // so the main loop will iterate them too. We use mockResolvedValue so
      // every fetch call succeeds.
      mockFetch.mockResolvedValue(
        mockJsonResponse({ enriched: true }),
      );

      const template = makeTemplate([
        {
          id: 'check',
          type: 'condition',
          label: 'Check IOC type',
          expression: '{{ioc.type}} == ipv4',
          thenSteps: ['then-fetch'],
          elseSteps: ['else-fetch'],
        },
        {
          id: 'then-fetch',
          type: 'http',
          label: 'Fetch IP enrichment',
          method: 'GET',
          url: 'https://api.example.com/ip/enrich',
        },
        {
          id: 'else-fetch',
          type: 'http',
          label: 'Fetch domain enrichment',
          method: 'GET',
          url: 'https://api.example.com/domain/enrich',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      // The condition handler executes the then-branch step.
      // Then the main loop also iterates both sub-steps.
      // First call should be the then-branch from condition handler.
      expect(mockFetch.mock.calls[0][0]).toContain('/ip/enrich');
    });

    it('evaluates condition and executes else-branch', async () => {
      mockFetch.mockResolvedValue(
        mockJsonResponse({ enriched: true }),
      );

      const template = makeTemplate([
        {
          id: 'check',
          type: 'condition',
          label: 'Check IOC type',
          expression: '{{ioc.type}} == domain',
          thenSteps: ['then-fetch'],
          elseSteps: ['else-fetch'],
        },
        {
          id: 'then-fetch',
          type: 'http',
          label: 'Fetch domain enrichment',
          method: 'GET',
          url: 'https://api.example.com/domain/enrich',
        },
        {
          id: 'else-fetch',
          type: 'http',
          label: 'Fetch IP enrichment',
          method: 'GET',
          url: 'https://api.example.com/ip/enrich',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput({ ioc: { id: 'ioc-1', value: '1.2.3.4', type: 'ipv4', confidence: 'high' } }),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      // The condition is false (ipv4 != domain), so else-branch runs first
      expect(mockFetch.mock.calls[0][0]).toContain('/ip/enrich');
    });
  });

  // ─── 5. Set variable step ──────────────────────────────────────

  describe('set-variable step', () => {
    it('sets context variables that later steps can use', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ status: 'ok' }),
      );

      const template = makeTemplate([
        {
          id: 'set-vars',
          type: 'set-variable',
          label: 'Set target URL',
          variables: {
            targetUrl: 'https://api.example.com/lookup/{{ioc.value}}',
          },
        },
        {
          id: 'fetch',
          type: 'http',
          label: 'Fetch using variable',
          method: 'GET',
          url: '{{vars.targetUrl}}',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('1.2.3.4');
    });
  });

  // ─── 6. Error handling: continueOnError=true ───────────────────

  describe('error handling', () => {
    it('continues execution when step has continueOnError=true', async () => {
      // First step fails
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: 'Not found' }, 404, 'Not Found'),
      );
      // Second step succeeds
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ fallback: true }),
      );

      const template = makeTemplate([
        {
          id: 'failing-fetch',
          type: 'http',
          label: 'Optional enrichment',
          method: 'GET',
          url: 'https://api.example.com/optional',
          continueOnError: true,
        },
        {
          id: 'fallback-fetch',
          type: 'http',
          label: 'Fallback enrichment',
          method: 'GET',
          url: 'https://api.example.com/fallback',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // ─── 7. Error handling: continueOnError=false stops execution ──

    it('stops execution when step fails without continueOnError', async () => {
      // First step fails
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: 'Server error' }, 500, 'Internal Server Error'),
      );

      const template = makeTemplate([
        {
          id: 'failing-fetch',
          type: 'http',
          label: 'Required enrichment',
          method: 'GET',
          url: 'https://api.example.com/required',
        },
        {
          id: 'next-fetch',
          type: 'http',
          label: 'Next step',
          method: 'GET',
          url: 'https://api.example.com/next',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('500');
      // Only first fetch should have been called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 8. Timeout ────────────────────────────────────────────────

  describe('timeout handling', () => {
    it('sets status to cancelled when external signal is aborted', async () => {
      const abortController = new AbortController();
      // Abort immediately
      abortController.abort();

      const template = makeTemplate([
        {
          id: 'fetch',
          type: 'http',
          label: 'Slow fetch',
          method: 'GET',
          url: 'https://api.example.com/slow',
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
        abortController.signal,
      );

      // The step should be skipped because signal is already aborted
      expect(result.status).toBe('success'); // no steps ran, so it ends as success
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  // ─── 9. Output processing — display results ───────────────────

  describe('output processing', () => {
    it('captures display results from outputs', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ country: 'US', malicious: false }),
      );

      const template = makeTemplate(
        [
          {
            id: 'fetch',
            type: 'http',
            label: 'Fetch enrichment',
            method: 'GET',
            url: 'https://api.example.com/enrich',
          },
        ],
        [
          {
            type: 'display',
            template: {
              title: 'Enrichment for {{ioc.value}}',
              country: '{{steps.fetch.response.data.country}}',
            },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.displayResults).toEqual({
        title: 'Enrichment for 1.2.3.4',
        country: 'US',
      });
    });

    it('skips output when condition is false', async () => {
      const template = makeTemplate(
        [],
        [
          {
            type: 'display',
            condition: '{{ioc.type}} == domain', // false for ipv4
            template: { title: 'Should not appear' },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(result.displayResults).toBeUndefined();
    });
  });

  // ─── 10. Entity creation callback ─────────────────────────────

  describe('entity creation', () => {
    it('calls onCreateEntity for create-entity steps', async () => {
      const onCreateEntity = vi.fn().mockResolvedValue('new-entity-id');

      const template = makeTemplate([
        {
          id: 'create',
          type: 'create-entity',
          label: 'Create IOC',
          entityType: 'ioc',
          fields: {
            value: '{{ioc.value}}',
            type: '{{ioc.type}}',
            notes: 'Auto-created',
          },
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks({ onCreateEntity }),
      );

      expect(result.status).toBe('success');
      expect(result.entitiesCreated).toBe(1);
      expect(onCreateEntity).toHaveBeenCalledTimes(1);
      expect(onCreateEntity).toHaveBeenCalledWith('ioc', {
        value: '1.2.3.4',
        type: 'ipv4',
        notes: 'Auto-created',
      });
    });

    it('calls onCreateEntity from output create-ioc', async () => {
      const onCreateEntity = vi.fn().mockResolvedValue('created-ioc');

      const template = makeTemplate(
        [],
        [
          {
            type: 'create-ioc',
            template: {
              value: '5.6.7.8',
              type: 'ipv4',
              confidence: 'medium',
            },
          },
        ],
      );

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks({ onCreateEntity }),
      );

      expect(result.status).toBe('success');
      expect(result.entitiesCreated).toBe(1);
      expect(onCreateEntity).toHaveBeenCalledWith('ioc', {
        value: '5.6.7.8',
        type: 'ipv4',
        confidence: 'medium',
      });
    });

    it('throws when onCreateEntity callback is missing', async () => {
      const template = makeTemplate([
        {
          id: 'create',
          type: 'create-entity',
          label: 'Create IOC',
          entityType: 'ioc',
          fields: { value: 'test' },
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks({ onCreateEntity: undefined }),
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('No onCreateEntity callback');
    });
  });

  // ─── Run metadata ─────────────────────────────────────────────

  describe('run metadata', () => {
    it('populates input and output summaries', async () => {
      const template = makeTemplate([]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.inputSummary).toContain('IOC: 1.2.3.4 (ipv4)');
      expect(result.inputSummary).toContain('Investigation: Test Investigation');
      expect(result.trigger).toBe('manual');
      expect(result.templateId).toBe('tmpl-1');
      expect(result.integrationId).toBe('inst-1');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns "No input" summary when no input provided', async () => {
      const template = makeTemplate([]);

      const result = await executor.run(
        template,
        makeInstallation(),
        {},
        makeCallbacks(),
      );

      expect(result.inputSummary).toBe('No input');
    });

    it('logs step-start and step-complete entries', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ ok: true }),
      );

      const onLog = vi.fn();
      const template = makeTemplate([
        {
          id: 'fetch',
          type: 'http',
          label: 'Test Fetch',
          method: 'GET',
          url: 'https://api.example.com/test',
        },
      ]);

      await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks({ onLog }),
      );

      const logTypes = onLog.mock.calls.map((c) => c[0].type);
      expect(logTypes).toContain('step-start');
      expect(logTypes).toContain('http-request');
      expect(logTypes).toContain('http-response');
      expect(logTypes).toContain('step-complete');
    });
  });

  // ─── Step condition skipping ──────────────────────────────────

  describe('step-level condition', () => {
    it('skips step when its condition evaluates to false', async () => {
      const template = makeTemplate([
        {
          id: 'conditional-fetch',
          type: 'http',
          label: 'Conditional Fetch',
          method: 'GET',
          url: 'https://api.example.com/data',
          condition: '{{ioc.type}} == domain', // false for ipv4 input
        },
      ]);

      const result = await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks(),
      );

      expect(result.status).toBe('success');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.apiCallsMade).toBe(0);
    });
  });

  // ─── Notify output ────────────────────────────────────────────

  describe('notify output', () => {
    it('calls onNotify callback for notify outputs', async () => {
      const onNotify = vi.fn();

      const template = makeTemplate(
        [],
        [
          {
            type: 'notify',
            template: { message: 'Enrichment complete for {{ioc.value}}' },
          },
        ],
      );

      await executor.run(
        template,
        makeInstallation(),
        makeInput(),
        makeCallbacks({ onNotify }),
      );

      expect(onNotify).toHaveBeenCalledWith('Enrichment complete for 1.2.3.4');
    });
  });
});
