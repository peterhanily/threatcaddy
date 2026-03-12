import { useState, useEffect } from 'react';
import { loadBgImage } from '../../lib/theme-bg';

interface BgImageLayerProps {
  enabled: boolean;
  opacity: number;
  theme: 'dark' | 'light';
  posX: number;
  posY: number;
  zoom: number;
}

export function BgImageLayer({ enabled, opacity, theme, posX, posY, zoom }: BgImageLayerProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setUrl(null); return; }
    let revoked = false;
    loadBgImage().then((u) => {
      if (!revoked && u) setUrl(u);
    });
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Only reload when enabled changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !url) return null;

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden>
      <div
        role="img"
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: 'cover',
          backgroundPosition: `${posX}% ${posY}%`,
          backgroundRepeat: 'no-repeat',
          transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: theme === 'dark'
            ? `rgba(0, 0, 0, ${opacity / 100})`
            : `rgba(255, 255, 255, ${opacity / 100})`,
        }}
      />
    </div>
  );
}
