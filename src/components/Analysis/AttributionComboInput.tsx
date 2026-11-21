import { useState, useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';

interface AttributionComboInputProps {
  value: string;
  onChange: (value: string) => void;
  actors: string[];
  /** Identity names to suggest in their own group after the threat actors (the timeline's Actor field). */
  identities?: string[];
  placeholder?: string;
  /** The field's name for assistive technology, when no label element points at it. */
  ariaLabel?: string;
}

/** At most this many identities are suggested at once; typing narrows them. */
const MAX_IDENTITIES = 30;

export function AttributionComboInput({ value, onChange, actors, identities, placeholder, ariaLabel }: AttributionComboInputProps) {
  const { t } = useTranslation('analysis');
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const query = value.toLowerCase();
  const matching = (names: string[]) => names.filter((name) => name.toLowerCase().includes(query));
  const actorMatches = matching(actors);
  const actorKeys = new Set(actors.map((actor) => actor.toLowerCase()));
  const groups = [
    { key: 'actors', label: t('attribution.groupActors'), items: actorMatches },
    { key: 'identities', label: t('attribution.groupIdentities'),
      items: matching([...new Set(identities ?? [])].filter((name) => !actorKeys.has(name.toLowerCase()))).slice(0, MAX_IDENTITIES) },
  ].filter((group) => group.items.length > 0);
  // Group headings only where identities are offered; elsewhere the list is threat actors alone.
  const labelled = identities !== undefined;
  const filtered = groups.flatMap((group) => group.items);

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
      listRef.current.querySelector<HTMLElement>(`[data-index="${highlightIndex}"]`)?.scrollIntoView({ block: 'nearest' });
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

  const expanded = open && filtered.length > 0;
  let index = -1;
  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && highlightIndex >= 0 ? `${listId}-${highlightIndex}` : undefined}
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
      {expanded && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-lg"
        >
          {groups.map((group) => [
            labelled && (
              <li key={`${group.key}-label`} role="presentation" className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {group.label}
              </li>
            ),
            ...group.items.map((item) => {
              const i = ++index;
              return (
                <li
                  key={`${group.key}:${item}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === highlightIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(item);
                    setOpen(false);
                  }}
                  className={`px-2 py-1 text-xs cursor-pointer ${
                    i === highlightIndex ? 'bg-accent/30 text-gray-100' : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {item}
                </li>
              );
            }),
          ])}
        </ul>
      )}
    </div>
  );
}
