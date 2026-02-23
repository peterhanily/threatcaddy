import { cn } from '../../lib/utils';

interface ResizeHandleProps {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

export function ResizeHandle({ isDragging, onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'w-1 shrink-0 cursor-col-resize relative transition-colors',
        isDragging ? 'bg-accent/50' : 'bg-gray-700 hover:bg-accent/30'
      )}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
