import { FolderOpen, Tag, X } from 'lucide-react';

interface ActiveFilterBarProps {
  folderName?: string;
  folderColor?: string;
  tagName?: string;
  tagColor?: string;
  onClear: () => void;
}

export function ActiveFilterBar({ folderName, folderColor, tagName, tagColor, onClear }: ActiveFilterBarProps) {
  if (!folderName && !tagName) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/60 border-b border-gray-800 text-sm text-gray-300 shrink-0">
      {folderName && (
        <span className="flex items-center gap-1.5">
          <FolderOpen size={14} style={{ color: folderColor }} />
          <span>{folderName}</span>
        </span>
      )}
      {tagName && (
        <span className="flex items-center gap-1.5">
          <Tag size={14} style={{ color: tagColor }} />
          <span>#{tagName}</span>
        </span>
      )}
      <button
        onClick={onClear}
        className="ml-1 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
        aria-label="Clear filter"
        title="Clear filter"
      >
        <X size={14} />
      </button>
    </div>
  );
}
