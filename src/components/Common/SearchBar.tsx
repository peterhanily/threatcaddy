import { useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  focusRequested?: boolean;
  onFocusHandled?: () => void;
}

export function SearchBar({ value, onChange, focusRequested, onFocusHandled }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequested && inputRef.current) {
      inputRef.current.focus();
      onFocusHandled?.();
    }
  }, [focusRequested, onFocusHandled]);

  return (
    <div className="relative flex-1 max-w-md">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search notes & tasks..."
        aria-label="Search notes and tasks"
        className="w-full pl-9 pr-8 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-sm"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
