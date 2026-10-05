import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { CustomSlashCommand } from '../types';

export function useCustomSlashCommands() {
  const [commands, setCommands] = useState<CustomSlashCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  useLayoutEffect(() => {
    ++requestVersion.current;
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!db.customSlashCommands || !mounted.current) return;
    const request = ++requestVersion.current;
    const current = () => mounted.current && requestVersion.current === request;
    setError(null);
    try {
      const all = await db.customSlashCommands.toArray();
      if (current()) setCommands(all.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : 'Failed to load custom commands');
      throw err;
    }
  }, []);

  useEffect(() => { void reload().catch(() => {}); }, [reload]);

  const createCommand = useCallback(async (name: string, description: string, template: string) => {
    const now = Date.now();
    const cmd: CustomSlashCommand = {
      id: nanoid(),
      name: name.replace(/^\//, '').toLowerCase().replace(/\s+/g, '-'),
      description,
      template,
      createdAt: now,
      updatedAt: now,
    };
    await db.customSlashCommands.add(cmd);
    await reload();
    return cmd;
  }, [reload]);

  const updateCommand = useCallback(async (id: string, updates: Partial<Pick<CustomSlashCommand, 'name' | 'description' | 'template'>>) => {
    await db.customSlashCommands.update(id, { ...updates, updatedAt: Date.now() });
    await reload();
  }, [reload]);

  const deleteCommand = useCallback(async (id: string) => {
    await db.customSlashCommands.delete(id);
    await reload();
  }, [reload]);

  return { commands, error, createCommand, updateCommand, deleteCommand, reload };
}

/**
 * Interpolate a custom command template with user input.
 * Replaces {{input}} with the argument text.
 */
export function interpolateTemplate(template: string, input: string): string {
  return template.replace(/\{\{input\}\}/gi, input);
}
