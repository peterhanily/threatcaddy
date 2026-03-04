import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FileText } from 'lucide-react';

const MAX_VISIBLE = 8;
const LINE_HEIGHT = 24;
const ITEM_HEIGHT = 32;

export interface LinkCandidate {
  id: string;
  title: string;
}

interface LinkAutocompleteMenuProps {
  items: LinkCandidate[];
  activeIndex: number;
  position: { top: number; left: number };
  onSelect: (candidate: LinkCandidate) => void;
  menuRef: RefObject<HTMLDivElement | null>;
}

export function LinkAutocompleteMenu({ items, activeIndex, position, onSelect, menuRef }: LinkAutocompleteMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number } | null>(null);

  // Viewport collision detection — flip up / shift left if needed
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = position.top + LINE_HEIGHT;
    let left = Math.max(0, position.left);

    if (rect.bottom > vh) {
      top = position.top - menu.offsetHeight - 4;
    }

    if (rect.right > vw) {
      left = Math.max(0, left - (rect.right - vw) - 8);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdjustedPos({ top, left });
  }, [position, items.length, menuRef]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const defaultTop = position.top + LINE_HEIGHT;
  const defaultLeft = Math.max(0, position.left);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-y-auto"
      style={{
        top: adjustedPos?.top ?? defaultTop,
        left: adjustedPos?.left ?? defaultLeft,
        maxHeight: ITEM_HEIGHT * MAX_VISIBLE + 28, // 28 = header height
        minWidth: 220,
        maxWidth: 340,
      }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold sticky top-0 bg-gray-800">
        Link to note
      </div>
      <div ref={listRef}>
        {items.map((item, index) => (
          <button
            key={item.id}
            data-index={index}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
              index === activeIndex ? 'bg-gray-700 text-gray-100' : 'text-gray-300 hover:bg-gray-700/50'
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
          >
            <FileText size={14} className="shrink-0 text-gray-400" />
            <span className="truncate">{item.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
