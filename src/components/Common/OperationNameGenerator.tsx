import { useState, useEffect, useRef, useCallback } from 'react';
import { Copy, Check, FolderPlus } from 'lucide-react';
import { Modal } from './Modal';
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

const FILLER_COUNT = 18;
const REEL_A_DURATION = 1.8;
const REEL_B_DURATION = 2.2;
const ITEM_HEIGHT = 48;

export function OperationNameGenerator({ open, onClose, onCreateInvestigation }: OperationNameGeneratorProps) {
  const [comedyLevel, setComedyLevel] = useState<ComedyLevel>(0);
  const [spinning, setSpinning] = useState(false);
  const [currentName, setCurrentName] = useState<GeneratedName | null>(null);
  const [copied, setCopied] = useState(false);
  const [leverPulled, setLeverPulled] = useState(false);

  // Reel data: array of words to display, final word is the result
  const [reelAWords, setReelAWords] = useState<string[]>([]);
  const [reelBWords, setReelBWords] = useState<string[]>([]);
  const [reelAOffset, setReelAOffset] = useState(0);
  const [reelBOffset, setReelBOffset] = useState(0);

  const hasAutoSpun = useRef(false);

  const spin = useCallback(() => {
    if (spinning) return;

    const lists = getListsForLevel(comedyLevel);
    const result = generateName(lists);

    // Build reel words: filler + final
    const fillerA = getRandomWords(lists.adjectives, FILLER_COUNT);
    const fillerB = getRandomWords(lists.nouns, FILLER_COUNT);
    const wordsA = [...fillerA, result.adjective];
    const wordsB = [...fillerB, result.noun];

    setReelAWords(wordsA);
    setReelBWords(wordsB);

    // Reset to top
    setReelAOffset(0);
    setReelBOffset(0);
    setSpinning(true);
    setLeverPulled(true);
    setCopied(false);

    // Trigger scroll after a frame so the transition kicks in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const totalA = wordsA.length * ITEM_HEIGHT;
        const totalB = wordsB.length * ITEM_HEIGHT;
        setReelAOffset(totalA - ITEM_HEIGHT);
        setReelBOffset(totalB - ITEM_HEIGHT);
      });
    });

    // Reel B finishes last
    setTimeout(() => {
      setSpinning(false);
      setCurrentName(result);
      setLeverPulled(false);
    }, REEL_B_DURATION * 1000 + 100);
  }, [spinning, comedyLevel]);

  // Auto-spin on modal open
  useEffect(() => {
    if (open && !hasAutoSpun.current) {
      hasAutoSpun.current = true;
      // Small delay so modal animation finishes first
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
      // Fallback
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

  return (
    <Modal open={open} onClose={onClose} title="Operation Name Generator" wide>
      <div className="space-y-5">
        {/* Comedy level badge */}
        <div className="flex justify-end">
          <button
            onClick={cycleLevel}
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${levelInfo.bg} ${levelInfo.text} hover:opacity-80`}
          >
            {levelInfo.label}
          </button>
        </div>

        {/* Slot machine area */}
        <div className="flex items-stretch gap-3">
          {/* Reels */}
          <div className="flex-1 flex gap-3">
            {/* Reel A */}
            <div className="flex-1 relative">
              <div className="h-12 overflow-hidden rounded-lg bg-gray-800 border border-gray-600 relative">
                {/* Gradient overlays */}
                <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-gray-800 to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-gray-800 to-transparent z-10 pointer-events-none" />
                {/* Scrolling column */}
                <div
                  className="transition-transform will-change-transform"
                  style={{
                    transform: `translateY(-${reelAOffset}px)`,
                    transitionDuration: `${REEL_A_DURATION}s`,
                    transitionTimingFunction: 'cubic-bezier(0.15, 0.8, 0.2, 1)',
                  }}
                >
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
            <div className="flex-1 relative">
              <div className="h-12 overflow-hidden rounded-lg bg-gray-800 border border-gray-600 relative">
                <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-gray-800 to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-gray-800 to-transparent z-10 pointer-events-none" />
                <div
                  className="transition-transform will-change-transform"
                  style={{
                    transform: `translateY(-${reelBOffset}px)`,
                    transitionDuration: `${REEL_B_DURATION}s`,
                    transitionTimingFunction: 'cubic-bezier(0.15, 0.8, 0.2, 1)',
                  }}
                >
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

          {/* Lever */}
          <button
            onClick={spin}
            disabled={spinning}
            className="relative w-10 flex flex-col items-center justify-start pt-1 cursor-pointer group disabled:cursor-not-allowed"
            aria-label="Pull lever to spin"
            title="Pull lever"
          >
            {/* Track */}
            <div className="w-1.5 h-full bg-gray-600 rounded-full relative">
              {/* Ball */}
              <div
                className={`absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-red-500 shadow-lg shadow-red-500/30 transition-all ${
                  leverPulled
                    ? 'top-[calc(100%-24px)]'
                    : 'top-0 group-hover:top-1'
                }`}
                style={{
                  transitionDuration: leverPulled ? '0.3s' : '0.6s',
                  transitionTimingFunction: leverPulled ? 'ease-in' : 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              />
            </div>
            <span className="text-[9px] text-gray-500 mt-1 font-medium tracking-tight">PULL</span>
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
    </Modal>
  );
}
