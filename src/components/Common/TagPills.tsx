import React, { useState, useRef, useEffect } from 'react';

interface TagPillsProps {
  tags: string[];
}

export const TagPills = React.memo(function TagPills({ tags }: TagPillsProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  if (tags.length === 0) return null;

  return (
    <div className="relative flex items-center gap-1 min-w-0">
      <span className="text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full truncate">
        {tags[0]}
      </span>
      {tags.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full hover:bg-accent/20 transition-colors shrink-0"
        >
          +{tags.length - 1}
        </button>
      )}
      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-700 rounded-lg p-2 shadow-xl"
        >
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full whitespace-nowrap">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
