interface TourOverlayProps {
  targetRect: DOMRect | null;
}

export function TourOverlay({ targetRect }: TourOverlayProps) {
  const padding = 8;

  // Build clip-path that creates a spotlight hole around the target
  let clipPath = 'none';
  if (targetRect) {
    const top = targetRect.top - padding;
    const left = targetRect.left - padding;
    const right = targetRect.right + padding;
    const bottom = targetRect.bottom + padding;
    const r = 8; // border radius

    // Outer rect (full viewport) + inner rect (cutout) using evenodd
    clipPath = `polygon(
      evenodd,
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${left + r}px ${top}px,
      ${right - r}px ${top}px,
      ${right}px ${top + r}px,
      ${right}px ${bottom - r}px,
      ${right - r}px ${bottom}px,
      ${left + r}px ${bottom}px,
      ${left}px ${bottom - r}px,
      ${left}px ${top + r}px,
      ${left + r}px ${top}px
    )`;
  }

  return (
    <div
      className="tour-overlay"
      style={{ clipPath }}
      aria-hidden="true"
    />
  );
}
