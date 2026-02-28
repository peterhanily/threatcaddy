import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, NOTE_COLORS, PRIORITY_COLORS, TAG_COLORS } from '../types';

describe('Type constants', () => {
  it('has valid DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.editorMode).toBe('split');
    expect(DEFAULT_SETTINGS.sidebarCollapsed).toBe(false);
    expect(DEFAULT_SETTINGS.taskViewMode).toBe('list');
    expect(DEFAULT_SETTINGS.defaultView).toBe('dashboard');
  });

  it('has NOTE_COLORS with a "None" option', () => {
    expect(NOTE_COLORS.length).toBeGreaterThan(0);
    expect(NOTE_COLORS[0]).toEqual({ name: 'None', value: '' });
    // All other colors should have valid hex values
    NOTE_COLORS.slice(1).forEach((c) => {
      expect(c.value).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('has PRIORITY_COLORS for all levels', () => {
    expect(PRIORITY_COLORS.none).toBe('');
    expect(PRIORITY_COLORS.low).toMatch(/^#/);
    expect(PRIORITY_COLORS.medium).toMatch(/^#/);
    expect(PRIORITY_COLORS.high).toMatch(/^#/);
  });

  it('has TAG_COLORS as an array of hex colors', () => {
    expect(TAG_COLORS.length).toBeGreaterThanOrEqual(5);
    TAG_COLORS.forEach((c) => {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});
