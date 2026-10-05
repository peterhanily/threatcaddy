/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNoteTemplates } from '../hooks/useNoteTemplates';
import { db } from '../db';
import { BUILTIN_NOTE_TEMPLATES } from '../lib/builtin-templates';
import { parseProductBaselinePackage, PRODUCT_BASELINE_PACKAGE_SCHEMA } from '../lib/product-baselines';

describe('useNoteTemplates', () => {
  beforeEach(async () => {
    await db.noteTemplates.clear();
  });

  it('starts with builtin templates and loading false after init', async () => {
    const { result } = renderHook(() => useNoteTemplates());
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.builtinTemplates).toBe(BUILTIN_NOTE_TEMPLATES);
    expect(result.current.templates.length).toBe(BUILTIN_NOTE_TEMPLATES.length);
    expect(result.current.userTemplates).toEqual([]);
  });

  it('returns builtin templates unchanged', async () => {
    const { result } = renderHook(() => useNoteTemplates());
    await act(async () => {});

    // Builtins should all have source 'builtin'
    for (const t of result.current.builtinTemplates) {
      expect(t.source).toBe('builtin');
    }
  });

  // ─── Create ────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('preserves imported product baseline metadata through creation and reload', async () => {
      const parsed = parseProductBaselinePackage(JSON.stringify({
        schemaVersion: PRODUCT_BASELINE_PACKAGE_SCHEMA, kind: 'product-baseline',
        baseline: { name: 'Fictional report outline', content: '# Report\n\n## Findings', clsLevel: 'TLP:AMBER',
          productBaseline: { kind: 'markdown', productType: 'analysis-report', renderer: 'markdown',
            layoutNotes: ['Keep the original section order.'], sourceNoteRules: ['Attribute each source.'] } },
      }), 'fictional-outline.json');
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});
      let id = '';
      await act(async () => { id = (await result.current.createTemplate(parsed)).id; });
      expect((await db.noteTemplates.get(id))?.productBaseline).toEqual(parsed.productBaseline);
      await act(async () => { await result.current.reload(); });
      expect(result.current.templates.find((template) => template.id === id)).toMatchObject({
        clsLevel: 'TLP:AMBER', productBaseline: parsed.productBaseline,
      });
    });

    it('creates a user template with required fields', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({
          name: 'My Template',
          content: '# My Template Content',
        });
      });

      expect(created!.name).toBe('My Template');
      expect(created!.content).toBe('# My Template Content');
      expect(created!.source).toBe('user');
      expect(created!.category).toBe('Custom');
      expect(created!.id).toBeTruthy();
      expect(created!.createdAt).toBeGreaterThan(0);
      expect(created!.updatedAt).toBeGreaterThan(0);
    });

    it('creates a template with optional fields', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({
          name: 'Detailed Template',
          content: '# Details',
          category: 'Investigation',
          icon: '🔍',
          description: 'A detailed template',
          tags: ['test', 'investigation'],
          clsLevel: 'TLP:AMBER',
        });
      });

      expect(created!.category).toBe('Investigation');
      expect(created!.icon).toBe('🔍');
      expect(created!.description).toBe('A detailed template');
      expect(created!.tags).toEqual(['test', 'investigation']);
      expect(created!.clsLevel).toBe('TLP:AMBER');
    });

    it('adds the template to both userTemplates and templates (combined)', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      await act(async () => {
        await result.current.createTemplate({ name: 'Custom 1', content: 'content1' });
      });

      expect(result.current.userTemplates).toHaveLength(1);
      expect(result.current.templates.length).toBe(BUILTIN_NOTE_TEMPLATES.length + 1);
    });

    it('persists the template to IndexedDB', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      await act(async () => {
        await result.current.createTemplate({ name: 'Persisted', content: 'data' });
      });

      const stored = await db.noteTemplates.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Persisted');
      expect(stored[0].source).toBe('user');
    });

    it('defaults category to "Custom" when not provided', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({ name: 'No Cat', content: 'x' });
      });

      expect(created!.category).toBe('Custom');
    });
  });

  // ─── Update ────────────────────────────────────────────────────

  describe('updateTemplate', () => {
    it('updates a user template', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({ name: 'Original', content: 'old' });
      });

      await act(async () => {
        await result.current.updateTemplate(created!.id, { name: 'Updated', content: 'new' });
      });

      const updated = result.current.userTemplates.find((t) => t.id === created!.id);
      expect(updated!.name).toBe('Updated');
      expect(updated!.content).toBe('new');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(created!.updatedAt);
    });

    it('persists updates to IndexedDB', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({ name: 'Original', content: 'old' });
      });

      await act(async () => {
        await result.current.updateTemplate(created!.id, { name: 'Patched' });
      });

      const stored = await db.noteTemplates.get(created!.id);
      expect(stored!.name).toBe('Patched');
    });

    it('sets updatedAt on update', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({ name: 'For Update', content: 'x' });
      });

      const originalUpdatedAt = created!.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      await act(async () => {
        await result.current.updateTemplate(created!.id, { name: 'Renamed' });
      });

      const updated = result.current.userTemplates.find((t) => t.id === created!.id);
      expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  // ─── Delete ────────────────────────────────────────────────────

  describe('deleteTemplate', () => {
    it('removes a user template from state and DB', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let created: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        created = await result.current.createTemplate({ name: 'Doomed', content: 'bye' });
      });

      expect(result.current.userTemplates).toHaveLength(1);

      await act(async () => {
        await result.current.deleteTemplate(created!.id);
      });

      expect(result.current.userTemplates).toHaveLength(0);
      expect(result.current.templates.length).toBe(BUILTIN_NOTE_TEMPLATES.length);

      const stored = await db.noteTemplates.get(created!.id);
      expect(stored).toBeUndefined();
    });

    it('does not affect other templates when deleting one', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let second: Awaited<ReturnType<typeof result.current.createTemplate>>;
      await act(async () => {
        await result.current.createTemplate({ name: 'Keep', content: 'a' });
        second = await result.current.createTemplate({ name: 'Delete', content: 'b' });
      });

      await act(async () => {
        await result.current.deleteTemplate(second!.id);
      });

      expect(result.current.userTemplates).toHaveLength(1);
      expect(result.current.userTemplates[0].name).toBe('Keep');
    });
  });

  // ─── Duplicate Builtin ─────────────────────────────────────────

  describe('duplicateBuiltin', () => {
    it('duplicates a builtin template as a user template', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      const builtinId = BUILTIN_NOTE_TEMPLATES[0].id;
      const builtinName = BUILTIN_NOTE_TEMPLATES[0].name;

      let dup: Awaited<ReturnType<typeof result.current.duplicateBuiltin>> = null as Awaited<ReturnType<typeof result.current.duplicateBuiltin>>;
      await act(async () => {
        dup = await result.current.duplicateBuiltin(builtinId);
      });

      expect(dup).not.toBeNull();
      expect(dup!.name).toBe(`${builtinName} (Custom)`);
      expect(dup!.content).toBe(BUILTIN_NOTE_TEMPLATES[0].content);
      expect(dup!.source).toBe('user');
      expect(dup!.category).toBe('Custom');
      expect(dup!.id).not.toBe(builtinId);
    });

    it('returns null for non-existent builtin id', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let dup: Awaited<ReturnType<typeof result.current.duplicateBuiltin>> = null as Awaited<ReturnType<typeof result.current.duplicateBuiltin>>;
      await act(async () => {
        dup = await result.current.duplicateBuiltin('nonexistent-id');
      });

      expect(dup).toBeNull();
    });

    it('copies icon, description, tags, and clsLevel from builtin', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      // Use a builtin that has an icon
      const builtin = BUILTIN_NOTE_TEMPLATES.find((t) => t.icon);
      if (!builtin) return; // safety

      let dup: Awaited<ReturnType<typeof result.current.duplicateBuiltin>>;
      await act(async () => {
        dup = await result.current.duplicateBuiltin(builtin.id);
      });

      expect(dup!.icon).toBe(builtin.icon);
      expect(dup!.description).toBe(builtin.description);
      expect(dup!.tags).toEqual(builtin.tags);
      expect(dup!.clsLevel).toBe(builtin.clsLevel);
    });
  });

  // ─── Save Note as Template ─────────────────────────────────────

  describe('saveNoteAsTemplate', () => {
    it('saves a note as a custom template', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let saved: Awaited<ReturnType<typeof result.current.saveNoteAsTemplate>>;
      await act(async () => {
        saved = await result.current.saveNoteAsTemplate({
          title: 'My Note Title',
          content: '# Note content here',
          tags: ['incident'],
          clsLevel: 'TLP:RED',
        });
      });

      expect(saved!.name).toBe('My Note Title');
      expect(saved!.content).toBe('# Note content here');
      expect(saved!.category).toBe('Custom');
      expect(saved!.source).toBe('user');
      expect(saved!.tags).toEqual(['incident']);
      expect(saved!.clsLevel).toBe('TLP:RED');
    });

    it('saves a note without optional fields', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      let saved: Awaited<ReturnType<typeof result.current.saveNoteAsTemplate>>;
      await act(async () => {
        saved = await result.current.saveNoteAsTemplate({
          title: 'Simple Note',
          content: 'Just text',
        });
      });

      expect(saved!.name).toBe('Simple Note');
      expect(saved!.tags).toBeUndefined();
      expect(saved!.clsLevel).toBeUndefined();
    });
  });

  // ─── Categories ────────────────────────────────────────────────

  describe('categories', () => {
    it('includes builtin categories', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      expect(result.current.categories).toContain('General');
      expect(result.current.categories).toContain('Investigation');
      expect(result.current.categories).toContain('Incident Response');
      expect(result.current.categories).toContain('Cloud');
    });

    it('includes custom category when user template has one', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      await act(async () => {
        await result.current.createTemplate({
          name: 'Custom Cat',
          content: 'x',
          category: 'My Category',
        });
      });

      expect(result.current.categories).toContain('My Category');
    });

    it('deduplicates categories', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      await act(async () => {
        await result.current.createTemplate({ name: 'A', content: 'x', category: 'General' });
        await result.current.createTemplate({ name: 'B', content: 'y', category: 'General' });
      });

      const generalCount = result.current.categories.filter((c) => c === 'General').length;
      expect(generalCount).toBe(1);
    });
  });

  // ─── Reload ────────────────────────────────────────────────────

  describe('reload', () => {
    it('reloads templates from DB', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      // Add a template directly to DB (bypassing hook state)
      await db.noteTemplates.add({
        id: 'direct-add', name: 'Direct', content: 'x', category: 'Custom',
        source: 'user', createdAt: Date.now(), updatedAt: Date.now(),
      });

      // Should not be in state yet
      expect(result.current.userTemplates.find((t) => t.id === 'direct-add')).toBeUndefined();

      // Reload should pick it up
      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.userTemplates.find((t) => t.id === 'direct-add')).toBeDefined();
    });
  });

  // ─── All Templates (builtin + user) ───────────────────────────

  describe('templates (combined list)', () => {
    it('contains builtins followed by user templates', async () => {
      const { result } = renderHook(() => useNoteTemplates());
      await act(async () => {});

      await act(async () => {
        await result.current.createTemplate({ name: 'User 1', content: 'u1' });
        await result.current.createTemplate({ name: 'User 2', content: 'u2' });
      });

      const templates = result.current.templates;
      expect(templates.length).toBe(BUILTIN_NOTE_TEMPLATES.length + 2);

      // First N should be builtins
      for (let i = 0; i < BUILTIN_NOTE_TEMPLATES.length; i++) {
        expect(templates[i].source).toBe('builtin');
      }
      // Last 2 should be user
      expect(templates[templates.length - 2].source).toBe('user');
      expect(templates[templates.length - 1].source).toBe('user');
    });
  });
});
