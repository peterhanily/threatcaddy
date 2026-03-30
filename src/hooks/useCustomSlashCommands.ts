import { useState, useEffect, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { CustomSlashCommand } from '../types';

export function useCustomSlashCommands() {
  const [commands, setCommands] = useState<CustomSlashCommand[]>([]);

  const reload = useCallback(async () => {
    if (!db.customSlashCommands) return;
    const all = await db.customSlashCommands.toArray();
    setCommands(all.sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  useEffect(() => { reload(); }, [reload]);

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

  return { commands, createCommand, updateCommand, deleteCommand, reload };
}

/**
 * Interpolate a custom command template with user input.
 * Replaces {{input}} with the argument text.
 */
export function interpolateTemplate(template: string, input: string): string {
  return template.replace(/\{\{input\}\}/gi, input);
}
