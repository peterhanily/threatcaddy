import { useState, useEffect, useRef, useCallback } from 'react';
import { Dices, X, Plus, Zap } from 'lucide-react';
import { generateName, getListsForLevel, COMEDY_LEVELS, type ComedyLevel } from '../../lib/operation-names';
import { cn } from '../../lib/utils';

interface InlineNameGeneratorProps {
  onCreateInvestigation: (name: string) => void;
  onCancel: () => void;
}

export function InlineNameGenerator({ onCreateInvestigation, onCancel }: InlineNameGeneratorProps) {
  const [comedyLevel, setComedyLevel] = useState<ComedyLevel>(0);
  const [displayName, setDisplayName] = useState('');
  const [finalName, setFinalName] = useState('');
  const [animating, setAnimating] = useState(true);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAnimation = useCallback((level: ComedyLevel) => {
    setAnimating(true);
    setEditing(false);

    const lists = getListsForLevel(level);
    const target = generateName(lists);
    setFinalName(target.full);

    // Generate filler names for slot-machine effect
    const fillers: string[] = [];
    for (let i = 0; i < 8; i++) {
      fillers.push(generateName(lists).full);
    }
    fillers.push(target.full);

    let step = 0;
    let delay = 60;

    const tick = () => {
      if (step < fillers.length) {
        setDisplayName(fillers[step]);
        step++;
        delay = Math.min(delay * 1.5, 500);
        animationRef.current = setTimeout(tick, delay);
      } else {
        setAnimating(false);
        setEditing(true);
      }
    };

    tick();
  }, []);

  useEffect(() => {
    runAnimation(comedyLevel);
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleRespin = () => {
    if (animationRef.current) clearTimeout(animationRef.current);
    runAnimation(comedyLevel);
  };

  const handleCycleLevel = () => {
    const next = ((comedyLevel + 1) % 4) as ComedyLevel;
    setComedyLevel(next);
    if (animationRef.current) clearTimeout(animationRef.current);
    runAnimation(next);
  };

  const handleCreate = () => {
    const name = (editing ? displayName : finalName).trim();
    if (name) onCreateInvestigation(name);
  };

  const levelInfo = COMEDY_LEVELS[comedyLevel];

  return (
    <div
      className="bg-bg-raised border border-border-subtle rounded-lg p-2.5 space-y-2"
      style={{ animation: 'fadeSlideIn 150ms ease-out' }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Name display / input */}
      <div className="relative">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') onCancel();
            }}
            className="w-full bg-bg-deep border border-border-medium rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-purple"
            aria-label="Investigation name"
          />
        ) : (
          <div className="w-full bg-bg-deep border border-border-subtle rounded px-2 py-1.5 text-xs font-mono text-text-secondary truncate">
            {displayName || '...'}
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleCycleLevel}
          className={cn(
            'px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider transition-colors',
            levelInfo.bg, levelInfo.text
          )}
          title={`Comedy: ${levelInfo.label}`}
          aria-label={`Comedy level: ${levelInfo.label}`}
        >
          <Zap size={10} className="inline mr-0.5" />
          {levelInfo.label}
        </button>
        <button
          onClick={handleRespin}
          disabled={animating}
          className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
          title="Re-spin"
          aria-label="Re-spin name"
        >
          <Dices size={14} />
        </button>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="Cancel"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
        <button
          onClick={handleCreate}
          disabled={animating}
          className="flex items-center gap-1 px-2 py-1 rounded bg-purple text-white text-xs font-medium hover:brightness-110 disabled:opacity-50 transition-all"
          title="Create investigation"
          aria-label="Create investigation"
        >
          <Plus size={12} />
          Create
        </button>
      </div>
    </div>
  );
}
