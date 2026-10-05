import { useState, useCallback, useEffect } from 'react';

interface UseDropdownKeyboardOpts {
  itemCount: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  isOpen: boolean;
}

/**
 * Reusable keyboard navigation for dropdown menus.
 *
 * Handles ArrowUp/Down (with wrap), Home, End, Enter (select), Escape (close).
 * Resets activeIndex to -1 when the dropdown closes.
 *
 * Attach the returned `onKeyDown` handler to the dropdown container element.
 */
export function useDropdownKeyboard(opts: UseDropdownKeyboardOpts): {
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  const { itemCount, onSelect, onClose, isOpen } = opts;
  const [activeIndex, setActiveIndex] = useState(-1);
  const boundedIndex = isOpen && activeIndex >= 0 && activeIndex < itemCount ? activeIndex : -1;

  // Invalid highlights must not select removed items or reappear if the list grows.
  useEffect(() => {
    setActiveIndex(previous => isOpen && previous < itemCount ? previous : -1);
  }, [isOpen, itemCount]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || (itemCount <= 0 && e.key !== 'Escape' && e.key !== 'Tab')) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => ((prev >= 0 && prev < itemCount ? prev : -1) + 1) % itemCount);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => (prev <= 0 || prev >= itemCount ? itemCount - 1 : prev - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(itemCount - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (boundedIndex >= 0) {
            onSelect(boundedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          onClose();
          break;
      }
    },
    [isOpen, itemCount, boundedIndex, onSelect, onClose],
  );

  return { activeIndex: boundedIndex, setActiveIndex, onKeyDown };
}
