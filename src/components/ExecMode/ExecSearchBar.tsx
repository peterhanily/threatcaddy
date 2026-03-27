import { Search, X } from 'lucide-react';

interface ExecSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function ExecSearchBar({ value, onChange, placeholder = 'Filter...' }: ExecSearchBarProps) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg-raised rounded-lg pl-8 pr-8 py-2 text-sm text-text-primary placeholder:text-text-muted border border-border-subtle focus:border-accent focus:outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted active:text-text-primary">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
