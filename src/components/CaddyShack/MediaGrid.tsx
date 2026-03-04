import { useState } from 'react';
import { FileText, Music, Download } from 'lucide-react';
import type { PostAttachment } from '../../types';
import { MediaLightbox } from './MediaLightbox';

interface MediaGridProps {
  attachments: PostAttachment[];
}

function isSafeUrl(url: string): boolean {
  const lower = url.toLowerCase().trim();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('/');
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaGrid({ attachments }: MediaGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const visual = attachments.filter((a) => a.type === 'image' || a.type === 'video');
  const audio = attachments.filter((a) => a.type === 'audio');
  const docs = attachments.filter((a) => a.type === 'document');

  // For lightbox: only visual items
  const lightboxItems = visual;

  const gridClass =
    visual.length === 1
      ? 'grid grid-cols-1'
      : visual.length === 2
        ? 'grid grid-cols-2 gap-1'
        : visual.length === 3
          ? 'grid grid-cols-2 gap-1'
          : visual.length >= 4
            ? 'grid grid-cols-2 gap-1'
            : '';

  return (
    <div className="mb-3 space-y-2">
      {/* Visual grid (images + videos) */}
      {visual.length > 0 && (
        <div className={`${gridClass} rounded-lg overflow-hidden`}>
          {visual.slice(0, 4).map((att, i) => {
            if (!isSafeUrl(att.url)) return null;
            const isThreeFirstLarge = visual.length === 3 && i === 0;
            const spanClass = isThreeFirstLarge ? 'col-span-2' : '';

            if (att.type === 'image') {
              return (
                <div
                  key={att.id}
                  className={`${spanClass} cursor-pointer overflow-hidden bg-black/10`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex(i);
                  }}
                >
                  <img
                    src={att.thumbnailUrl || att.url}
                    alt={att.alt || att.filename}
                    className={`w-full object-cover rounded ${
                      visual.length === 1 ? 'max-h-80' : isThreeFirstLarge ? 'h-48' : 'h-36'
                    }`}
                  />
                </div>
              );
            }

            // Video
            return (
              <div
                key={att.id}
                className={`${spanClass} overflow-hidden bg-black/10 rounded`}
                onClick={(e) => e.stopPropagation()}
              >
                <video
                  src={att.url}
                  controls
                  preload="metadata"
                  className={`w-full object-cover ${
                    visual.length === 1 ? 'max-h-80' : isThreeFirstLarge ? 'h-48' : 'h-36'
                  }`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Audio players */}
      {audio.filter((att) => isSafeUrl(att.url)).map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-2 p-2 rounded border border-[var(--border)] bg-[var(--bg-primary)]"
          onClick={(e) => e.stopPropagation()}
        >
          <Music size={16} className="text-[var(--text-tertiary)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--text-secondary)] truncate">{att.filename}</p>
            <audio src={att.url} controls preload="metadata" className="w-full h-8 mt-1" />
          </div>
        </div>
      ))}

      {/* Document cards */}
      {docs.filter((att) => isSafeUrl(att.url)).map((att) => (
        <a
          key={att.id}
          href={att.url}
          download={att.filename}
          className="flex items-center gap-3 p-2.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText size={20} className="text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--text-secondary)] truncate">{att.filename}</p>
            {att.size && (
              <p className="text-xs text-[var(--text-tertiary)]">{formatFileSize(att.size)}</p>
            )}
          </div>
          <Download size={14} className="text-[var(--text-tertiary)] shrink-0" />
        </a>
      ))}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          items={lightboxItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
