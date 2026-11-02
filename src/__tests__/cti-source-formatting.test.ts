import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown';
import {
  CTI_CENSYS_TOOL,
  CTI_FLASHPOINT_COMMUNITIES_TOOL,
  CTI_VIRUSTOTAL_BUNDLE_TOOL,
  CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL,
  CTI_VIRUSTOTAL_TOOL,
  DEFAULT_CTI_SOURCE_TEMPLATES,
  normalizeCtiSourceRunResult,
  parseCtiSlashCommand,
  parseCtiTemplatePatchJson,
  parseHostSkillResult,
  planCtiSourceRequests,
  renderCtiRunMarkdown,
  validateCtiTemplate,
} from '../lib/cti-source-formatting';

describe('cti-source-formatting', () => {
  it.each(['`[link](https://example.test)`', '\\`<img src=x onerror=alert(1)>', '``double``', ' padded ', '   '])(
    'keeps CTI target text literal inside its rendered code span: %s', target => {
      const rendered = document.createElement('div');
      rendered.innerHTML = renderMarkdown(renderCtiRunMarkdown(target, []));
      expect(rendered.querySelector('h2 code')?.textContent).toBe(target);
      expect(rendered.querySelector('h2 a, h2 img')).toBeNull();
    });
  it('parses CTI slash command aliases', () => {
    expect(parseCtiSlashCommand('/vt 8.8.8.8')).toEqual({
      source: 'virustotal',
      target: '8.8.8.8',
      command: '/vt',
    });
    expect(parseCtiSlashCommand('/vt-hunt bad.example')).toEqual({
      source: 'virustotal',
      target: 'bad.example',
      command: '/vt-hunt',
    });
    expect(parseCtiSlashCommand('/vt-search engines:"akira" limit:5')).toEqual({
      source: 'virustotal',
      target: 'engines:"akira" limit:5',
      command: '/vt-search',
    });
    expect(parseCtiSlashCommand('/cti censys 1.1.1.1')).toEqual({
      source: 'censys',
      target: '1.1.1.1',
      command: '/cti',
    });
    expect(parseCtiSlashCommand('hello')).toBeNull();
  });

  it('plans only allowlisted active host tools and skips Flashpoint from /all', () => {
    const command = parseCtiSlashCommand('/all 8.8.8.8');
    expect(command).not.toBeNull();
    const result = planCtiSourceRequests(command!, [
      CTI_VIRUSTOTAL_TOOL,
      CTI_CENSYS_TOOL,
      'host:other:virustotal_ioc_report',
      'host:cti:flashpoint_search',
    ]);

    expect(result.validationErrors).toEqual([]);
    expect(result.planned.map(item => item.tool)).toEqual([CTI_VIRUSTOTAL_TOOL, CTI_CENSYS_TOOL]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ source: 'flashpoint' }),
    ]);
  });

  it('plans VT hunt and search commands through package tools with bounded options', () => {
    const hunt = parseCtiSlashCommand('/vt-hunt bad.example relationships:resolutions,communicating_files limit:4');
    const huntPlan = planCtiSourceRequests(hunt!, [CTI_VIRUSTOTAL_BUNDLE_TOOL, CTI_VIRUSTOTAL_TOOL]);
    expect(huntPlan.validationErrors).toEqual([]);
    expect(huntPlan.planned).toEqual([
      expect.objectContaining({
        tool: CTI_VIRUSTOTAL_BUNDLE_TOOL,
        input: { ioc: 'bad.example', relationships: 'resolutions,communicating_files', limit: 4 },
      }),
    ]);

    const search = parseCtiSlashCommand('/vt-search engines:"akira" limit:5 cursor:abc123');
    const searchPlan = planCtiSourceRequests(search!, [CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL]);
    expect(searchPlan.planned).toEqual([
      expect.objectContaining({
        tool: CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL,
        input: { query: 'engines:"akira"', limit: 5, cursor: 'abc123' },
      }),
    ]);
  });

  it('skips Censys instead of failing /all domain requests', () => {
    const command = parseCtiSlashCommand('/all bad.example');
    const result = planCtiSourceRequests(command!, [CTI_VIRUSTOTAL_TOOL, CTI_CENSYS_TOOL]);

    expect(result.validationErrors).toEqual([]);
    expect(result.planned.map(item => item.tool)).toEqual([CTI_VIRUSTOTAL_TOOL]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'censys' }),
      expect.objectContaining({ source: 'flashpoint' }),
    ]));
  });

  it('plans Flashpoint communities searches by author with deterministic defaults', () => {
    const command = parseCtiSlashCommand('/flashpoint Handala Hack');
    expect(command).not.toBeNull();
    const result = planCtiSourceRequests(command!, [CTI_FLASHPOINT_COMMUNITIES_TOOL]);

    expect(result.validationErrors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.planned).toEqual([
      expect.objectContaining({
        source: 'flashpoint',
        tool: CTI_FLASHPOINT_COMMUNITIES_TOOL,
        input: {
          query: '',
          author: 'Handala Hack',
          site: 'Telegram',
          size: 25,
          page: 0,
          start: 'now-48h',
          end: 'now',
          dedupe: false,
        },
      }),
    ]);
  });

  it('supports Flashpoint query options without changing evidence ownership', () => {
    const command = parseCtiSlashCommand('/flashpoint query:"cloud platform" since:now-24h size:50 site:Telegram');
    expect(command).not.toBeNull();
    const result = planCtiSourceRequests(command!, [CTI_FLASHPOINT_COMMUNITIES_TOOL]);

    expect(result.planned[0].input).toMatchObject({
      query: 'cloud platform',
      author: '',
      site: 'Telegram',
      size: 50,
      start: 'now-24h',
    });
  });

  it('does not accept lookalike CTI tools from other hosts', () => {
    const command = parseCtiSlashCommand('/all 8.8.8.8');
    expect(command).not.toBeNull();
    const result = planCtiSourceRequests(command!, [
      'host:evil:virustotal_ioc_report',
      'host:other:censys_host',
    ]);

    expect(result.planned).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'virustotal' }),
      expect.objectContaining({ source: 'censys' }),
      expect.objectContaining({ source: 'flashpoint' }),
    ]));
  });

  it('keeps Flashpoint communities template active after endpoint verification', () => {
    const template = DEFAULT_CTI_SOURCE_TEMPLATES.flashpoint;
    expect(template.active).toBe(true);
    expect(validateCtiTemplate(template)).toEqual([]);
  });

  it('applies only approval-safe CTI template patches', () => {
    const current = DEFAULT_CTI_SOURCE_TEMPLATES.virustotal;
    const accepted = parseCtiTemplatePatchJson(JSON.stringify({
      description: 'Show analyst-focused VirusTotal fields.',
      sections: [{
        title: 'Analyst View',
        fields: [
          { key: 'analysisStats', label: 'Detection stats', format: 'text' },
          { key: 'objectId', label: 'Observable', format: 'code', required: true },
        ],
      }],
      showRawJson: true,
    }), current, 'virustotal');

    expect(accepted.issues).toEqual([]);
    expect(accepted.template?.id).toBe(current.id);
    expect(accepted.template?.source).toBe('virustotal');
    expect(accepted.template?.hostTool).toBe(CTI_VIRUSTOTAL_TOOL);
    expect(accepted.template?.sections[0].fields.map(field => field.key)).toEqual(['analysisStats', 'objectId']);

    const rejected = parseCtiTemplatePatchJson(JSON.stringify({
      source: 'censys',
      caveats: [],
      verdict: 'safe',
      sections: [{ title: 'Bad', fields: [{ key: 'newVendorValue', label: 'New vendor value' }] }],
    }), current, 'virustotal');

    expect(rejected.template).toBeUndefined();
    expect(rejected.issues).toEqual(expect.arrayContaining([
      'Template patch cannot change evidence or control field: source',
      'Template patch cannot change evidence or control field: caveats',
      'Template patch cannot change evidence or control field: verdict',
      'Template patch cannot introduce unnormalized evidence field: newVendorValue',
    ]));
  });

  it('rejects templates that expose non-allowlisted host tools', () => {
    expect(validateCtiTemplate({
      ...DEFAULT_CTI_SOURCE_TEMPLATES.virustotal,
      hostTool: 'host:cti:censys_request',
    })).toContain('Template host tool is not allowlisted: host:cti:censys_request');
  });

  it('parses generic host errors and partial responses', () => {
    expect(parseHostSkillResult(JSON.stringify({ error: 'missing api key' }))).toEqual({
      status: 'error',
      ok: false,
      data: { error: 'missing api key' },
      error: 'missing api key',
      warnings: [],
      rawText: '{"error":"missing api key"}',
    });

    const partial = parseHostSkillResult(JSON.stringify({
      status: 'partial',
      result: { id: '8.8.8.8' },
      warnings: ['quota limited'],
    }));
    expect(partial.ok).toBe(true);
    expect(partial.status).toBe('partial');
    expect(partial.warnings).toContain('quota limited');
  });

  it('normalizes VT and Censys compact results into escaped markdown', () => {
    const vtPlan = {
      source: 'virustotal' as const,
      sourceLabel: 'VirusTotal',
      tool: CTI_VIRUSTOTAL_TOOL,
      input: { ioc: 'bad.example' },
      templateId: DEFAULT_CTI_SOURCE_TEMPLATES.virustotal.id,
    };
    const vtRun = normalizeCtiSourceRunResult(vtPlan, JSON.stringify({
      result: {
        id: 'bad`example',
        type: 'domain',
        attributes: {
          sha256: 'a'.repeat(64),
          sha1: 'b'.repeat(40),
          md5: 'c'.repeat(32),
          type_description: 'Win32 EXE',
          size: 12345,
          first_submission_iso: '2024-01-01T00:00:00Z',
          last_analysis_iso: '2024-01-02T00:00:00Z',
          last_analysis_stats: { malicious: 1, suspicious: 2, harmless: 3, undetected: 4 },
          total_scans: 10,
          malicious_detections: 1,
          detection_ratio: 10,
          reputation: -10,
          registrar: 'ACME | Registrar',
          threat_label: 'akira',
          threat_category: 'ransomware',
          tags: ['apt*tag'],
          pe_exports: ['CreateFileW'],
          ip_addresses: ['203.0.113.10'],
          matching_vendor_results: ['VendorX: Akira'],
          vendor_results: [{ vendor: 'VendorY', category: 'malicious', result: 'Trojan.Test' }],
        },
      },
      caveat: 'Vendor supplied | caveat',
    }));

    const censysPlan = {
      source: 'censys' as const,
      sourceLabel: 'Censys',
      tool: CTI_CENSYS_TOOL,
      input: { ip: '8.8.8.8' },
      templateId: DEFAULT_CTI_SOURCE_TEMPLATES.censys.id,
    };
    const censysRun = normalizeCtiSourceRunResult(censysPlan, {
      result: {
        ip: '8.8.8.8',
        services_count: 1,
        services: [{ port: 443, transport: 'tcp', service: 'HTTP', http_title: 'Admin *Panel*' }],
      },
    });

    const markdown = renderCtiRunMarkdown('bad`example', [vtRun, censysRun]);
    expect(vtRun.evidence).toMatchObject({
      sourceKey: 'virustotal',
      sourceName: 'VirusTotal',
      observable: 'bad`example',
      toolName: CTI_VIRUSTOTAL_TOOL,
      input: { ioc: 'bad.example' },
    });
    expect(markdown).toContain('``bad`example``');
    expect(markdown).toContain('Win32 EXE, 12345 bytes');
    expect(markdown).toContain('1/10 malicious \\(10%\\)');
    expect(markdown).toContain('VendorY: malicious \\(Trojan.Test\\)');
    expect(markdown).toContain('ACME \\| Registrar');
    expect(markdown).toContain('apt\\*tag');
    expect(markdown).toContain('Admin \\*Panel\\*');
    expect(markdown).toContain('Vendor supplied \\| caveat');
  });

  it('normalizes vt.compact.v1 packages into analyst summaries and pivot rows', () => {
    const plan = {
      source: 'virustotal' as const,
      sourceLabel: 'VirusTotal',
      tool: CTI_VIRUSTOTAL_BUNDLE_TOOL,
      input: { ioc: 'bad.example', relationships: 'resolutions,communicating_files', limit: 2 },
      templateId: DEFAULT_CTI_SOURCE_TEMPLATES.virustotal.id,
    };
    const run = normalizeCtiSourceRunResult(plan, {
      schema_version: 'vt.compact.v1',
      mode: 'report_bundle',
      query: { ioc: 'bad.example', ioc_type: 'domain', relationships: ['resolutions', 'communicating_files'] },
      limits: { relationship_limit: 2 },
      counts: { results: 1, errors: 1, malicious: 0, suspicious: 1, clean: 0, unknown: 0 },
      results: [
        {
          ioc: 'bad.example',
          normalized_ioc: 'bad.example',
          vt_type: 'domain',
          vt_id: 'bad.example',
          verdict: 'suspicious',
          score: { malicious: 1, suspicious: 1, total: 92, ratio_pct: 1, stats: { malicious: 1, suspicious: 1, harmless: 30, undetected: 60 } },
          timestamps: { first_submission: '2024-01-01T00:00:00Z', last_analysis: '2024-01-02T00:00:00Z' },
          details: {
            registrar: 'Registrar Inc',
            reputation: -2,
            hashes: {},
            dns_ips: ['203.0.113.10'],
            matching_vendor_results: ['VendorX: phishing'],
          },
          threat: { label: 'phishing', categories: ['phishing'], tags: ['login'] },
          relationships: [
            {
              relationship: 'resolutions',
              count_returned: 1,
              items: [{ id: '203.0.113.10', type: 'ip_address', attributes: { as_owner: 'Example ASN' } }],
            },
            {
              relationship: 'communicating_files',
              count_returned: 1,
              items: [{ id: 'f'.repeat(64), type: 'file', attributes: { threat_label: 'testloader' } }],
            },
          ],
          pivots: { hold: ['Validate resolutions in Censys before promoting.'] },
        },
      ],
      triage_summary: {
        guidance: ['Separate family, actor, and infrastructure confidence.', 'Corroborate before blocking decisions.'],
      },
      pagination: { cursor: 'next-cursor' },
      errors: [{ relationship: 'referrer_files', error: 'VirusTotal returned HTTP 429' }],
      caveat: 'VT caveat here.',
    });

    const markdown = renderCtiRunMarkdown('bad.example', [run]);
    expect(run.evidence.fields.packageMode).toBe('report_bundle (1 result, 1 error)');
    expect(run.evidence.fields.verdictSummary).toBe('0 malicious, 1 suspicious, 0 clean, 0 unknown, 1 error');
    expect(markdown).toContain('bad.example -\\> resolutions: 1 returned');
    expect(markdown).toContain('communicating\\_files');
    expect(markdown).toContain('next-cursor');
    expect(markdown).toContain('VirusTotal returned HTTP 429');
    expect(markdown).toContain('VT caveat here.');
    expect(markdown).not.toContain('last_analysis_results');
  });

  it('normalizes VT search collection results without raw JSON tables', () => {
    const plan = {
      source: 'virustotal' as const,
      sourceLabel: 'VirusTotal',
      tool: CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL,
      input: { query: 'engines:"akira"', limit: 2 },
      templateId: DEFAULT_CTI_SOURCE_TEMPLATES.virustotal.id,
    };
    const run = normalizeCtiSourceRunResult(plan, {
      source: 'VirusTotal Intelligence search',
      result: {
        count_returned: 1,
        items: [
          {
            id: 'a'.repeat(64),
            type: 'file',
            attributes: {
              sha256: 'a'.repeat(64),
              type_description: 'Win32 EXE',
              last_analysis_stats: { malicious: 8, suspicious: 0, harmless: 20, undetected: 30 },
              total_scans: 58,
              malicious_detections: 8,
              detection_ratio: 14,
              threat_label: 'akira',
              tags: ['ransomware'],
            },
          },
        ],
        links: { next: 'https://www.virustotal.com/api/v3/intelligence/search?cursor=abc' },
      },
      caveat: 'Search entitlement and quota may limit returned rows.',
    });

    const markdown = renderCtiRunMarkdown('engines:"akira"', [run]);
    expect(run.evidence.fields.packageMode).toBe('VirusTotal Intelligence search (1 returned)');
    expect(markdown).toContain('akira');
    expect(markdown).toContain('Search entitlement and quota may limit returned rows.');
    expect(markdown).toContain('Next page: https://www.virustotal.com/api/v3/intelligence/search?cursor=abc');
  });

  it('normalizes Flashpoint communities results into source-backed markdown', () => {
    const plan = {
      source: 'flashpoint' as const,
      sourceLabel: 'Flashpoint',
      tool: CTI_FLASHPOINT_COMMUNITIES_TOOL,
      input: {
        query: '',
        author: 'Handala Hack',
        site: 'Telegram',
        size: 25,
        page: 0,
        start: 'now-48h',
        end: 'now',
        dedupe: false,
      },
      templateId: DEFAULT_CTI_SOURCE_TEMPLATES.flashpoint.id,
    };
    const run = normalizeCtiSourceRunResult(plan, {
      source: 'Flashpoint Ignite communities',
      status: 200,
      result: {
        count_returned: 2,
        total: { value: 2, relation: '=' },
        items: [
          {
            id: 'I708tzdkWIerCV-0yXD76g',
            author: 'Handala Hack',
            author_id: '3686754935',
            date: '2026-05-19T06:19:25Z',
            message: 'Threat actor alleged leak with 639,000 documents mentioning an enterprise software platform.',
            site: 'Telegram',
            title: 'Handala Hack',
            title_id: '3686754935',
            container_external_uri: 'https://t.me/CYBER_HANDALA',
          },
          {
            id: 'empty-row',
            author: 'Handala Hack',
            author_id: '3686754935',
            date: '2026-05-18T18:06:00Z',
            message: '',
            site: 'Telegram',
          },
        ],
      },
      caveat: 'Community posts are raw-source observations.',
    });

    const markdown = renderCtiRunMarkdown('Handala Hack', [run]);
    expect(run.evidence.status).toBe('ok');
    expect(run.evidence.observable).toBe('Handala Hack');
    expect(markdown).toContain('author=Handala Hack; site=Telegram; now-48h to now');
    expect(markdown).toContain('I708tzdkWIerCV-0yXD76g');
    expect(markdown).toContain('3686754935');
    expect(markdown).toContain('software platform');
    expect(markdown).toContain('639,000');
    expect(markdown).toContain('Community posts are raw-source observations.');
  });
});
