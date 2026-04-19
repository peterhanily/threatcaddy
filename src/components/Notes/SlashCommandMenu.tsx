import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from './slashCommands';

const CATEGORY_ORDER: SlashCommand['category'][] = ['Formatting', 'Blocks', 'Threat Intel', 'Insert'];
const MAX_HEIGHT = 320;
const LINE_HEIGHT = 24;

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  activeIndex: number;
  position: { top: number; left: number };
  onSelect: (command: SlashCommand) => void;
  menuRef: RefObject<HTMLDivElement | null>;
}

const CATEGORY_I18N_KEY: Record<string, string> = {
  'Formatting': 'slashCommands.categoryFormatting',
  'Blocks': 'slashCommands.categoryBlocks',
  'Threat Intel': 'slashCommands.categoryThreatIntel',
  'Insert': 'slashCommands.categoryInsert',
};

export function SlashCommandMenu({ commands, activeIndex, position, onSelect, menuRef }: SlashCommandMenuProps) {
  const { t } = useTranslation('notes');
  const listRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number } | null>(null);

  // After render, measure menu rect against viewport and flip/shift if needed
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = position.top + LINE_HEIGHT;
    let left = Math.max(0, position.left);

    // Flip above cursor if overflowing bottom
    if (rect.bottom > vh) {
      top = position.top - menu.offsetHeight - 4;
    }

    // Shift left if overflowing right edge
    if (rect.right > vw) {
      left = Math.max(0, left - (rect.right - vw) - 8);
    }

    setAdjustedPos({ top, left });
  }, [position, commands.length, menuRef]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Group commands by category, preserving order
  const grouped = CATEGORY_ORDER
    .map(cat => ({ category: cat, items: commands.filter(c => c.category === cat) }))
    .filter(g => g.items.length > 0);

  // Compute global index for each command
  let globalIdx = 0;
  const indexedGroups = grouped.map(g => ({
    category: g.category,
    items: g.items.map(cmd => ({ cmd, index: globalIdx++ })),
  }));

  // Initial position (before layout measurement adjusts it)
  const defaultTop = position.top + LINE_HEIGHT;
  const defaultLeft = Math.max(0, position.left);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-y-auto"
      style={{
        top: adjustedPos?.top ?? defaultTop,
        left: adjustedPos?.left ?? defaultLeft,
        maxHeight: MAX_HEIGHT,
        minWidth: 260,
        maxWidth: 340,
      }}
    >
      <div ref={listRef}>
        {indexedGroups.map(group => (
          <div key={group.category}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold sticky top-0 bg-gray-800">
              {t(CATEGORY_I18N_KEY[group.category] || group.category)}
            </div>
            {group.items.map(({ cmd, index }) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.id}
                  data-index={index}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-start text-sm transition-colors ${
                    index === activeIndex ? 'bg-gray-700 text-gray-100' : 'text-gray-300 hover:bg-gray-700/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(cmd);
                  }}
                >
                  <Icon size={16} className="shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <span className="font-medium">{cmd.label}</span>
                    <span className="ms-2 text-xs text-gray-500">{cmd.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
