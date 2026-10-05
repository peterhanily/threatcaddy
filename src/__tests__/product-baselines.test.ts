import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { exportJSON, importJSON } from '../lib/export';
import {
  buildProductRenderContext,
  importProductBaselinePackage,
  listProductBaselines,
  normalizeProductRenderContextInput,
  parseProductBaselinePackage,
  PRODUCT_BASELINE_PACKAGE_SCHEMA,
  PRODUCT_BASELINE_TAG,
  PRODUCT_NOTE_TAG,
  renderJinjaTemplate,
  serializeProductBaselinePackage,
} from '../lib/product-baselines';

describe('product baselines', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.noteTemplates.clear();
    await db.standaloneIOCs.clear();
    await db.timelineEvents.clear();
    await db.evidenceItems.clear();
  });

  it('rejects oversized imported baseline content instead of silently truncating it', () => {
    const pkg = { schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA, kind: 'product-baseline', baseline: { name: 'Fictional baseline', content: 'x'.repeat(500_001) } };
    expect(() => parseProductBaselinePackage(JSON.stringify(pkg))).toThrow('has not been truncated');
    pkg.baseline.content = 'x'.repeat(500_000);
    expect(parseProductBaselinePackage(JSON.stringify(pkg)).content).toHaveLength(500_000);
  });

  it('renders a safe Jinja-compatible loop and conditional', () => {
    const rendered = renderJinjaTemplate(
      `{% if findings %}{% for finding in findings %}- {{ finding.title }}: {{ finding.summary }}\n{% endfor %}{% endif %}`,
      { findings: [{ title: 'One', summary: 'Alpha' }, { title: 'Two', summary: 'Beta' }] },
    );

    expect(rendered).toContain('- One: Alpha');
    expect(rendered).toContain('- Two: Beta');
  });

  it('keeps loop-generated table rows and bullets on separate lines', () => {
    const rendered = renderJinjaTemplate(
      [
        '| Type | Value |',
        '| --- | --- |',
        '{% for ioc in iocs %}',
        '| {{ ioc.type }} | {{ ioc.value }} |',
        '{% endfor %}',
        '',
        '{% for source in sources %}',
        '- {{ source.title }}',
        '{% endfor %}',
      ].join('\n'),
      {
        iocs: [
          { type: 'domain', value: 'timetrakr.cloud' },
          { type: 'url', value: 'https://timetrakr.cloud/sp.ps1' },
        ],
        sources: [
          { title: 'Symantec Threat Hunter Team' },
          { title: 'BleepingComputer' },
        ],
      },
    );

    expect(rendered).toContain('| domain | timetrakr.cloud |\n| url | https://timetrakr.cloud/sp.ps1 |');
    expect(rendered).toContain('- Symantec Threat Hunter Team\n- BleepingComputer');
  });

  it('normalizes daily-country fixture context into baseline variables', () => {
    const context = normalizeProductRenderContextInput({
      title: 'Seedworm Intrusion Activity Targeting South Korean Electronics Sector',
      date: '25 May 2026',
      country: 'South Korea',
      sources: [{ marker: '1', name: 'Symantec Threat Hunter Team', url: 'https://example.test/report' }],
      iocs: [{ type: 'domain', value: 'timetrakr.cloud', description: 'PowerShell retrieval domain' }],
    });

    const rendered = renderJinjaTemplate(
      '{{ generatedDate }}\n{{ executiveSummary }}\n{% for ioc in iocs %}{{ ioc.type }} {{ ioc.value }} {{ ioc.context }} {{ ioc.lastSeen }} {{ ioc.confidence }}{% endfor %}\n{% for source in sources %}{{ source.marker }} {{ source.title }}{% endfor %}',
      context,
    );

    expect(rendered).toContain('25 May 2026');
    expect(rendered).toContain('affecting South Korea');
    expect(rendered).toContain('domain timetrakr.cloud PowerShell retrieval domain not live validated Medium');
    expect(rendered).toContain('1 Symantec Threat Hunter Team');
  });

  it('does not ship product baselines as baked-in app code', async () => {
    const baselines = await listProductBaselines();

    expect(baselines).toHaveLength(0);
    expect(baselines.some((baseline) => baseline.id === 'pb-analysis-report')).toBe(false);
  });

  it('imports a product baseline package as an artifact-backed template', async () => {
    const imported = await importProductBaselinePackage(JSON.stringify({
      schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA,
      kind: 'product-baseline',
      baseline: {
        id: 'daily-country-intel-note',
        name: 'Daily Country Intel Note',
        content: '# {{ title }}\n\n## Executive Summary\n\n{{ executiveSummary }}',
        tags: ['daily-country'],
        productBaseline: {
          schemaVersion: 1,
          kind: 'markdown',
          productType: 'intel-note',
          renderer: 'markdown',
          visualFidelity: 'structural',
          sourceDocuments: [
            { name: 'Intel_Note_Trifleck_Blockstar.docx', type: 'docx', role: 'intel-note-word-template-sample' },
          ],
          testFixtures: [
            { name: 'Intel_Note_Seedworm_South_Korea.docx', type: 'docx', role: 'daily-country-render-test-fixture' },
          ],
          layoutNotes: ['Preserve Intel Note first-page header and restricted footer.'],
          sourceNoteRules: ['Use Source and Conf. fields for evidence provenance where present.'],
        },
      },
    }), 'daily-country-intel-note.tc-product-baseline.json');

    expect(imported.tags).toContain(PRODUCT_BASELINE_TAG);
    expect(imported.productBaseline?.productType).toBe('intel-note');
    expect(imported.productBaseline?.sourceDocuments?.[0]?.name).toContain('Trifleck');
    expect(imported.productBaseline?.testFixtures?.[0]?.name).toContain('Seedworm');

    const baselines = await listProductBaselines();
    expect(baselines).toHaveLength(1);
    expect(baselines[0].productBaseline?.visualFidelity).toBe('structural');
    expect(baselines[0].productBaseline?.sourceDocuments?.[0]?.name).toContain('Trifleck');
    expect(baselines[0].productBaseline?.testFixtures?.[0]?.name).toContain('Seedworm');
    expect(serializeProductBaselinePackage(imported)).toContain(PRODUCT_BASELINE_PACKAGE_SCHEMA);
  });

  it('round-trips baseline authority and render fixtures through backup export/import', async () => {
    const docxTemplateData = 'A'.repeat(600_000);
    const imported = await importProductBaselinePackage(JSON.stringify({
      schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA,
      kind: 'product-baseline',
      baseline: {
        id: 'intel-note-with-fixtures',
        name: 'Intel Note With Fixtures',
        content: '# {{ title }}',
        productBaseline: {
          schemaVersion: 1,
          kind: 'markdown',
          productType: 'intel-note',
          renderer: 'markdown',
          visualFidelity: 'structural',
          sourceDocuments: [
            { name: 'Intel_Note_Trifleck_Blockstar.docx', type: 'docx', role: 'intel-note-word-template-sample' },
          ],
          testFixtures: [
            { name: 'Intel_Note_Seedworm_South_Korea.docx', type: 'docx', role: 'daily-country-render-output' },
            { name: 'South Korea intel_note_context.json', type: 'json', role: 'daily-country-content-context' },
          ],
          assets: [
            { name: 'Intel_Note_Trifleck_Blockstar.docx', role: 'docx-template', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docxTemplateData },
          ],
        },
      },
    }), 'intel-note-with-fixtures.tc-product-baseline.json');

    const backup = await exportJSON();
    await db.noteTemplates.clear();
    await importJSON(backup);

    const restored = await db.noteTemplates.get(imported.id);
    expect(restored?.productBaseline?.sourceDocuments?.[0]?.name).toContain('Trifleck');
    expect(restored?.productBaseline?.testFixtures?.[0]?.role).toBe('daily-country-render-output');
    expect(restored?.productBaseline?.testFixtures?.[1]?.type).toBe('json');
    expect(restored?.productBaseline?.assets?.[0]?.data?.length).toBe(docxTemplateData.length);
  });

  it('creates and renders a custom product baseline as a product note', async () => {
    await db.folders.add({ id: 'f1', name: 'Weaponized Clipboard', order: 0, createdAt: Date.now(), clsLevel: 'TLP:AMBER' });
    await db.notes.add({
      id: 'source-1',
      title: 'Source Finding',
      content: 'The actor used clipboard content to stage follow-on activity.',
      folderId: 'f1',
      tags: [],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const storedBaseline = await importProductBaselinePackage(JSON.stringify({
      schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA,
      kind: 'product-baseline',
      baseline: {
        id: 'test-product-baseline',
        name: 'Test Product Baseline',
        content: '# {{ title }}\n\n{{ executiveSummary }}\n\n{% for source in sources %}- {{ source.title }}\n{% endfor %}',
        tags: ['test'],
      },
    }));
    expect(storedBaseline?.tags).toContain(PRODUCT_BASELINE_TAG);

    const folder = (await db.folders.get('f1'))!;
    const context = await buildProductRenderContext(folder, storedBaseline, {
      title: 'Clipboard Product',
      executiveSummary: 'Executive summary text.',
    });
    const rendered = renderJinjaTemplate(storedBaseline.content, context);
    await db.notes.add({
      id: 'product-1',
      title: 'Clipboard Product',
      content: rendered,
      folderId: 'f1',
      tags: [PRODUCT_NOTE_TAG, 'baseline:test-product-baseline'],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const product = await db.notes.get('product-1');
    expect(product?.title).toBe('Clipboard Product');
    expect(product?.tags).toContain(PRODUCT_NOTE_TAG);
    expect(product?.content).toContain('Executive summary text.');
    expect(product?.content).toContain('Source Finding');
  });
});
