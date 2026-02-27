import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, FolderPlus, X } from 'lucide-react';
import {
  generateName,
  getRandomWords,
  getListsForLevel,
  COMEDY_LEVELS,
  type ComedyLevel,
  type GeneratedName,
} from '../../lib/operation-names';

interface OperationNameGeneratorProps {
  open: boolean;
  onClose: () => void;
  onCreateInvestigation: (name: string) => void;
}

const FILLER_COUNT = 40;
const ITEM_HEIGHT = 48;
const REEL_A_MS = 2000;
const REEL_B_MS = 2600;

// Quartic ease-out: starts very fast, decelerates dramatically
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export function OperationNameGenerator({ open, onClose, onCreateInvestigation }: OperationNameGeneratorProps) {
  const [comedyLevel, setComedyLevel] = useState<ComedyLevel>(0);
  const [spinning, setSpinning] = useState(false);
  const [currentName, setCurrentName] = useState<GeneratedName | null>(null);
  const [copied, setCopied] = useState(false);
  const [leverPulled, setLeverPulled] = useState(false);

  const [reelAWords, setReelAWords] = useState<string[]>([]);
  const [reelBWords, setReelBWords] = useState<string[]>([]);

  const reelARef = useRef<HTMLDivElement>(null);
  const reelBRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const hasAutoSpun = useRef(false);
  const pendingSpinRef = useRef<GeneratedName | null>(null);

  const startAnimation = useCallback((result: GeneratedName, wordsA: string[], wordsB: string[]) => {
    const targetA = (wordsA.length - 1) * ITEM_HEIGHT;
    const targetB = (wordsB.length - 1) * ITEM_HEIGHT;
    const startTime = performance.now();

    // Reset positions
    if (reelARef.current) reelARef.current.style.transform = 'translateY(0)';
    if (reelBRef.current) reelBRef.current.style.transform = 'translateY(0)';

    const animate = () => {
      const now = performance.now();
      const elapsed = now - startTime;

      const tA = Math.min(1, elapsed / REEL_A_MS);
      const tB = Math.min(1, elapsed / REEL_B_MS);

      const posA = easeOutQuart(tA) * targetA;
      const posB = easeOutQuart(tB) * targetB;

      if (reelARef.current) reelARef.current.style.transform = `translateY(-${posA}px)`;
      if (reelBRef.current) reelBRef.current.style.transform = `translateY(-${posB}px)`;

      if (tA < 1 || tB < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        setCurrentName(result);
        setTimeout(() => setLeverPulled(false), 100);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const spin = useCallback(() => {
    if (spinning) return;

    const lists = getListsForLevel(comedyLevel);
    const result = generateName(lists);

    const fillerA = getRandomWords(lists.adjectives, FILLER_COUNT);
    const fillerB = getRandomWords(lists.nouns, FILLER_COUNT);
    const wordsA = [...fillerA, result.adjective];
    const wordsB = [...fillerB, result.noun];

    setReelAWords(wordsA);
    setReelBWords(wordsB);
    setSpinning(true);
    setLeverPulled(true);
    setCopied(false);

    // Store pending spin — animation starts after React renders new words
    pendingSpinRef.current = result;
  }, [spinning, comedyLevel]);

  // Start animation after React has rendered the new word lists
  useEffect(() => {
    if (pendingSpinRef.current && reelAWords.length > 0 && reelBWords.length > 0) {
      const result = pendingSpinRef.current;
      pendingSpinRef.current = null;
      // Wait one frame for DOM to be ready
      requestAnimationFrame(() => {
        startAnimation(result, reelAWords, reelBWords);
      });
    }
  }, [reelAWords, reelBWords, startAnimation]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  // Auto-spin on modal open
  useEffect(() => {
    if (open && !hasAutoSpun.current) {
      hasAutoSpun.current = true;
      const t = setTimeout(() => spin(), 300);
      return () => clearTimeout(t);
    }
    if (!open) {
      hasAutoSpun.current = false;
    }
  }, [open, spin]);

  const handleCopy = async () => {
    if (!currentName) return;
    try {
      await navigator.clipboard.writeText(currentName.full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentName.full;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = () => {
    if (!currentName) return;
    onCreateInvestigation(currentName.full);
    onClose();
  };

  const cycleLevel = () => {
    setComedyLevel(((comedyLevel + 1) % 4) as ComedyLevel);
  };

  const levelInfo = COMEDY_LEVELS[comedyLevel];

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">Operation Name Generator</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={cycleLevel}
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${levelInfo.bg} ${levelInfo.text} hover:opacity-80`}
            >
              {levelInfo.label}
            </button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Slot machine area */}
          <div className="flex items-center gap-4">
            {/* Reels */}
            <div className="flex-1 flex gap-3">
              {/* Reel A */}
              <div className="flex-1">
                <div className="h-12 overflow-hidden rounded-lg bg-gray-800 border border-gray-600 relative">
                  <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-gray-800 to-transparent z-10 pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-gray-800 to-transparent z-10 pointer-events-none" />
                  <div ref={reelARef} className="will-change-transform">
                    {reelAWords.map((word, i) => (
                      <div
                        key={`${i}-${word}`}
                        className="h-12 flex items-center justify-center text-sm font-bold text-green-400 tracking-widest"
                      >
                        {word}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reel B */}
              <div className="flex-1">
                <div className="h-12 overflow-hidden rounded-lg bg-gray-800 border border-gray-600 relative">
                  <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-gray-800 to-transparent z-10 pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-gray-800 to-transparent z-10 pointer-events-none" />
                  <div ref={reelBRef} className="will-change-transform">
                    {reelBWords.map((word, i) => (
                      <div
                        key={`${i}-${word}`}
                        className="h-12 flex items-center justify-center text-sm font-bold text-green-400 tracking-widest"
                      >
                        {word}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Lever — classic pull-down arm */}
            <button
              onClick={spin}
              disabled={spinning}
              className="relative h-28 w-10 flex-shrink-0 cursor-pointer group disabled:cursor-not-allowed select-none"
              aria-label="Pull lever to spin"
              title="Pull lever"
            >
              {/* Bracket mount */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded bg-gradient-to-b from-gray-400 to-gray-500 border border-gray-400 z-10" />
              {/* Arm — pivots from center bracket, rests pointing UP, pulls DOWN */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 origin-top flex flex-col items-center"
                style={{
                  transform: `translateX(-50%) rotate(${leverPulled ? '180deg' : '0deg'})`,
                  transitionProperty: 'transform',
                  transitionDuration: leverPulled ? '0.25s' : '0.5s',
                  transitionTimingFunction: leverPulled ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              >
                {/* Shaft going UP from pivot */}
                <div className="w-1.5 h-9 bg-gradient-to-t from-gray-400 to-gray-500 rounded-full" />
                {/* Grip ball at top */}
                <div className="w-7 h-7 -mt-0.5 rounded-full bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-500/40 border border-red-400/50 group-hover:from-red-300 group-hover:to-red-500 transition-colors" />
              </div>
            </button>
          </div>

          {/* Result display */}
          <div className="text-center py-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-[0.3em] mb-1">Operation</div>
            <div className={`text-xl font-black tracking-wider transition-opacity duration-300 ${
              currentName && !spinning ? 'opacity-100 text-gray-100' : 'opacity-30 text-gray-500'
            }`}>
              {currentName ? currentName.full : 'SPIN TO GENERATE'}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={spin}
              disabled={spinning}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Spin Again
            </button>
            <button
              onClick={handleCopy}
              disabled={!currentName || spinning}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleCreate}
              disabled={!currentName || spinning}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <FolderPlus size={14} />
              Create Investigation
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
