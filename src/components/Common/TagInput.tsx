import { useState, useRef } from 'react';
import { X, Plus } from 'lucide-react';
import type { Tag } from '../../types';
import { useToast } from '../../contexts/ToastContext';

interface TagInputProps {
  selectedTags: string[];
  allTags: Tag[];
  onChange: (tags: string[]) => void;
  onCreateTag: (name: string) => Promise<Tag>;
}

export function TagInput({ selectedTags, allTags, onChange, onCreateTag }: TagInputProps) {
  const [input, setInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const filteredTags = allTags.filter(
    (t) =>
      t.name.trim() !== '' &&
      !selectedTags.includes(t.name) &&
      t.name.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || selectedTags.includes(trimmed)) return;
    // Create if not exists
    if (!allTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      try {
        await onCreateTag(trimmed);
      } catch {
        addToast('error', 'Failed to create tag');
        return;
      }
    }
    onChange([...selectedTags, trimmed]);
    setInput('');
    setShowDropdown(false);
    setHighlightIdx(-1);
  };

  const removeTag = (name: string) => {
    onChange(selectedTags.filter((t) => t !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightIdx(-1);
      return;
    }

    if (!showDropdown || filteredTags.length === 0) {
      if (e.key === 'Enter' && input.trim()) {
        e.preventDefault();
        addTag(input);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => (prev + 1) % filteredTags.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => (prev <= 0 ? filteredTags.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filteredTags.length) {
          addTag(filteredTags[highlightIdx].name);
        } else if (input.trim()) {
          addTag(input);
        }
        break;
    }
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {selectedTags.map((tag) => {
          const tagObj = allTags.find((t) => t.name === tag);
          return (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: (tagObj?.color || '#6366f1') + '20', color: tagObj?.color || '#6366f1' }}
            >
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:opacity-70" aria-label={`Remove tag ${tag}`}>
                <X size={12} />
              </button>
            </span>
          );
        })}
        <div className="relative">
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setShowDropdown(true); setHighlightIdx(-1); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => { setShowDropdown(false); setHighlightIdx(-1); }, 200)}
              onKeyDown={handleKeyDown}
              placeholder="Add tag..."
              className="w-20 bg-transparent border-none text-xs text-gray-300 placeholder-gray-500 focus:outline-none"
              aria-label="Add tag"
              role="combobox"
              aria-expanded={showDropdown && filteredTags.length > 0}
              aria-autocomplete="list"
            />
            {input.trim() && (
              <button
                onClick={() => addTag(input)}
                className="text-accent hover:text-accent-hover"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          {showDropdown && filteredTags.length > 0 && (
            <div role="listbox" className="absolute top-full left-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 max-h-32 overflow-y-auto">
              {filteredTags.map((tag, idx) => (
                <button
                  key={tag.id}
                  role="option"
                  aria-selected={idx === highlightIdx}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(tag.name)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={`w-full text-left px-3 py-1.5 text-xs text-gray-300 flex items-center gap-2 ${idx === highlightIdx ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
