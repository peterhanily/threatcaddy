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
  const [landed, setLanded] = useState(false);
  const [editedName, setEditedName] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
        setLanded(true);
        setTimeout(() => {
          setLanded(false);
          setLeverPulled(false);
        }, 1200);
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
    setLanded(false);
    setEditedName(null);

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

  const effectiveName = editedName ?? currentName?.full ?? '';

  const handleCopy = async () => {
    if (!effectiveName) return;
    try {
      await navigator.clipboard.writeText(effectiveName);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = effectiveName;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = () => {
    if (!effectiveName.trim()) return;
    onCreateInvestigation(effectiveName.trim());
    onClose();
  };

  const startEditing = () => {
    if (spinning || !currentName) return;
    setEditedName(editedName ?? currentName.full);
    requestAnimationFrame(() => nameInputRef.current?.focus());
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

  const ledsOn = spinning || (!spinning && currentName);
  const ledColor = spinning
    ? 'bg-amber-400 shadow-amber-400/50'
    : 'bg-green-400 shadow-green-400/50';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* Keyframes for win celebration */}
      <style>{`
        @keyframes slotWinPulse {
          0%, 100% { text-shadow: 0 0 4px rgba(99,102,241,0.3); }
          50% { text-shadow: 0 0 20px rgba(99,102,241,0.8), 0 0 40px rgba(99,102,241,0.4); }
        }
        @keyframes slotPaylineFlash {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; box-shadow: 0 0 8px rgba(99,102,241,0.8); }
        }
      `}</style>

      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Machine cabinet */}
      <div className="relative w-full max-w-2xl mx-4">
        {/* Metallic chrome frame */}
        <div className="bg-gradient-to-b from-gray-600 via-gray-500 to-gray-600 p-[3px] rounded-xl shadow-2xl">
          <div className="bg-gray-900 rounded-[10px] overflow-hidden" style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.5)' }}>

            {/* Top plate header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-b from-gray-750 to-gray-900 border-b border-gray-600"
              style={{ background: 'linear-gradient(to bottom, #2d3748, #1a202c)' }}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* LED dots left */}
                <div className="flex gap-1.5 flex-shrink-0">
                  {[0,1,2].map(i => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                      ledsOn ? `${ledColor} shadow-sm` : 'bg-gray-700'
                    }`} />
                  ))}
                </div>
                <h2 className="text-xs font-bold text-gray-200 tracking-[0.25em] uppercase whitespace-nowrap">
                  Investigation Name Generator
                </h2>
                {/* LED dots right */}
                <div className="flex gap-1.5 flex-shrink-0">
                  {[0,1,2].map(i => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                      ledsOn ? `${ledColor} shadow-sm` : 'bg-gray-700'
                    }`} />
                  ))}
                </div>
              </div>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors ms-2 flex-shrink-0" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Slot machine area: reels + lever */}
              <div className="flex items-center gap-3">
                {/* Reels container with payline */}
                <div className="flex-1 relative">
                  <div className="flex gap-3">
                    {/* Reel A */}
                    <div className="flex-1">
                      <div className="h-[144px] overflow-hidden rounded-lg bg-black/70 border border-gray-600 relative"
                        style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.7)' }}>
                        {/* Top fade */}
                        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/90 to-transparent z-10 pointer-events-none" />
                        {/* Bottom fade */}
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/90 to-transparent z-10 pointer-events-none" />
                        <div ref={reelARef} className="will-change-transform" style={{ paddingTop: 48, paddingBottom: 48 }}>
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
                      <div className="h-[144px] overflow-hidden rounded-lg bg-black/70 border border-gray-600 relative"
                        style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.7)' }}>
                        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/90 to-transparent z-10 pointer-events-none" />
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/90 to-transparent z-10 pointer-events-none" />
                        <div ref={reelBRef} className="will-change-transform" style={{ paddingTop: 48, paddingBottom: 48 }}>
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

                  {/* Payline indicator — horizontal stripe across both reels at vertical center */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center">
                    {/* Left triangle marker pointing inward */}
                    <div className="w-0 h-0 flex-shrink-0"
                      style={{ borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '8px solid var(--color-accent, #6366f1)' }} />
                    {/* Payline stripe */}
                    <div
                      className="flex-1 h-0.5 bg-accent/60"
                      style={landed ? { animation: 'slotPaylineFlash 0.4s ease-in-out 3', backgroundColor: 'var(--color-accent, #6366f1)' } : undefined}
                    />
                    {/* Right triangle marker pointing inward */}
                    <div className="w-0 h-0 flex-shrink-0"
                      style={{ borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '8px solid var(--color-accent, #6366f1)' }} />
                  </div>
                </div>

                {/* Lever — right side, prominent */}
                <button
                  onClick={spin}
                  disabled={spinning}
                  className="relative h-36 w-12 flex-shrink-0 cursor-pointer group disabled:cursor-not-allowed select-none"
                  aria-label="Pull lever to spin"
                  title="Pull lever"
                >
                  {/* Mount bracket */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-md bg-gradient-to-b from-gray-400 to-gray-500 border border-gray-400 z-10 shadow-md" />
                  {/* Arm — pivots from center bracket */}
                  <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 origin-top flex flex-col items-center"
                    style={{
                      transform: `translateX(-50%) rotate(${leverPulled ? '180deg' : '0deg'})`,
                      transitionProperty: 'transform',
                      transitionDuration: leverPulled ? '0.25s' : '0.5s',
                      transitionTimingFunction: leverPulled ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {/* Shaft — chrome gradient */}
                    <div className="w-2 h-12 bg-gradient-to-r from-gray-400 via-gray-300 to-gray-400 rounded-full shadow-sm" />
                    {/* Grip ball — red, glossy */}
                    <div className="w-8 h-8 -mt-0.5 rounded-full bg-gradient-to-br from-red-400 via-red-500 to-red-700 shadow-lg shadow-red-500/40 border border-red-400/50 group-hover:from-red-300 group-hover:via-red-400 group-hover:to-red-600 transition-colors overflow-hidden">
                      {/* Glossy highlight */}
                      <div className="w-3 h-2 mt-1.5 ms-1.5 rounded-full bg-white/30" />
                    </div>
                  </div>
                </button>
              </div>

              {/* Result panel — recessed dark panel, click to edit */}
              <div
                className="rounded-lg border border-gray-700 px-4 py-3 text-center cursor-text"
                style={{ background: 'rgba(0,0,0,0.4)', boxShadow: 'inset 0 1px 6px rgba(0,0,0,0.5)' }}
                onClick={startEditing}
              >
                <div className="text-[10px] text-gray-500 uppercase tracking-[0.3em] mb-1 font-semibold">
                  Operation {currentName && !spinning && editedName === null && <span className="normal-case tracking-normal text-gray-600">— click to edit</span>}
                </div>
                {editedName !== null ? (
                  <input
                    ref={nameInputRef}
                    type="text"
                    maxLength={200}
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setEditedName(null); (e.target as HTMLInputElement).blur(); }
                    }}
                    className="w-full bg-transparent text-xl font-black tracking-wider font-mono text-gray-100 text-center focus:outline-none border-b border-accent/50 pb-0.5"
                  />
                ) : (
                  <div
                    className={`text-xl font-black tracking-wider font-mono transition-opacity duration-300 ${
                      currentName && !spinning ? 'opacity-100 text-gray-100' : 'opacity-30 text-gray-500'
                    }`}
                    style={landed && currentName ? { animation: 'slotWinPulse 0.8s ease-in-out' } : undefined}
                  >
                    {currentName ? currentName.full : 'SPIN TO GENERATE'}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between">
                <button
                  onClick={cycleLevel}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border-b-2 border-black/30 active:border-b-0 active:translate-y-0.5 ${levelInfo.bg} ${levelInfo.text} hover:opacity-80`}
                >
                  {levelInfo.label}
                </button>

                <button
                  onClick={spin}
                  disabled={spinning}
                  className="px-6 py-2 text-sm font-bold rounded-lg bg-accent text-white hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed border-b-2 border-black/30 active:border-b-0 active:translate-y-0.5 tracking-wider"
                >
                  ◆ SPIN ◆
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!effectiveName || spinning}
                    className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 border-b-2 border-gray-900 active:border-b-0 active:translate-y-0.5"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!effectiveName.trim() || spinning}
                    className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 border-b-2 border-gray-900 active:border-b-0 active:translate-y-0.5"
                  >
                    <FolderPlus size={14} />
                    Create
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
