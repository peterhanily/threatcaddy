import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AttributionComboInputProps {
  value: string;
  onChange: (value: string) => void;
  actors: string[];
  placeholder?: string;
}

export function AttributionComboInput({ value, onChange, actors, placeholder }: AttributionComboInputProps) {
  const { t } = useTranslation('analysis');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = actors.length > 0
    ? actors.filter((a) => a.toLowerCase().includes(value.toLowerCase()))
    : [];

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' && filtered.length > 0) {
        setOpen(true);
        setHighlightIndex(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          onChange(filtered[highlightIndex]);
          setOpen(false);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        maxLength={500}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => {
          if (filtered.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
        placeholder={placeholder ?? t('attribution.placeholder')}
      />
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-lg"
        >
          {filtered.map((actor, i) => (
            <li
              key={actor}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(actor);
                setOpen(false);
              }}
              className={`px-2 py-1 text-xs cursor-pointer ${
                i === highlightIndex ? 'bg-accent/30 text-gray-100' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {actor}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
