import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { searchTechniques, getTechniqueLabel, MITRE_TACTICS } from '../../lib/mitre-attack';
import type { MitreTechnique } from '../../lib/mitre-attack';

interface MitreComboInputProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

const TECHNIQUE_ID_RE = /^T\d{4}(\.\d{3})?$/;
const MAX_RESULTS = 8;

// Map tactic shortName → abbreviation for indicators
const TACTIC_ABBREV: Record<string, string> = {};
for (const t of MITRE_TACTICS) {
  TACTIC_ABBREV[t.shortName] = t.name.split(' ').map((w) => w[0]).join('');
}

export function MitreComboInput({ value, onChange }: MitreComboInputProps) {
  const { t } = useTranslation('timeline');
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results: MitreTechnique[] = input
    ? searchTechniques(input).filter((tech) => !value.includes(tech.id)).slice(0, MAX_RESULTS)
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

  const addId = (id: string) => {
    if (!value.includes(id)) {
      onChange([...value, id]);
    }
    setInput('');
    setOpen(false);
    setHighlightIndex(-1);
  };

  const removeId = (id: string) => {
    onChange(value.filter((v) => v !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !input && value.length > 0) {
      removeId(value[value.length - 1]);
      return;
    }

    if (!open || results.length === 0) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setOpen(true);
        setHighlightIndex(0);
        e.preventDefault();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Accept manually typed ID matching the pattern
        const trimmed = input.trim().toUpperCase();
        if (TECHNIQUE_ID_RE.test(trimmed)) {
          addId(trimmed);
        }
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % results.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          addId(results[highlightIndex].id);
        } else {
          const trimmed = input.trim().toUpperCase();
          if (TECHNIQUE_ID_RE.test(trimmed)) {
            addId(trimmed);
          }
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 min-h-[36px]">
        {value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: '#14b8a620', color: '#14b8a6' }}
          >
            <span className="font-mono">{id}</span>
            <span className="hidden sm:inline text-teal-400/70">
              {getTechniqueLabel(id).includes(':') ? getTechniqueLabel(id).split(': ')[1] : ''}
            </span>
            <button
              type="button"
              onClick={() => removeId(id)}
              className="hover:opacity-70 ms-0.5"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setHighlightIndex(-1);
          }}
          onFocus={() => { if (input) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-[120px] bg-transparent border-none text-xs text-gray-300 placeholder-gray-600 focus:outline-none"
          placeholder={value.length === 0 ? t('mitreCombo.searchPlaceholder') : t('mitreCombo.addMore')}
        />
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-lg"
        >
          {results.map((tech, i) => (
            <li
              key={tech.id}
              onMouseDown={(e) => {
                e.preventDefault();
                addId(tech.id);
              }}
              className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 ${
                i === highlightIndex ? 'bg-accent/30 text-gray-100' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span className="font-mono text-xs text-teal-400 shrink-0">{tech.id}</span>
              <span className="text-xs truncate">{tech.name}</span>
              <span className="ms-auto flex gap-1 shrink-0">
                {tech.tactics.slice(0, 3).map((tac) => (
                  <span
                    key={tac}
                    className="text-[9px] px-1 rounded bg-gray-700 text-gray-500"
                    title={MITRE_TACTICS.find((mt) => mt.shortName === tac)?.name}
                  >
                    {TACTIC_ABBREV[tac] || tac}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
