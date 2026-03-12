import { useState, useEffect, useRef } from 'react';
import { Upload, X, RotateCcw } from 'lucide-react';
import type { Settings } from '../../types';
import { COLOR_SCHEMES } from '../../lib/theme-schemes';
import { saveBgImage, loadBgImage, removeBgImage } from '../../lib/theme-bg';
import { useToast } from '../../contexts/ToastContext';

interface AppearanceSettingsProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8 MB

export function AppearanceSettings({ settings, onUpdateSettings }: AppearanceSettingsProps) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const scheme = settings.colorScheme ?? 'indigo';
  const opacity = settings.bgImageOpacity ?? 85;
  const zoom = settings.bgImageZoom ?? 100;
  const posX = settings.bgImagePosX ?? 50;
  const posY = settings.bgImagePosY ?? 50;
  const bgEnabled = settings.bgImageEnabled ?? false;

  // Load existing background image preview
  useEffect(() => {
    let revoke: string | null = null;
    loadBgImage().then((url) => {
      if (url) { revoke = url; setBgPreview(url); }
    });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('error', 'Please select an image file');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      addToast('error', 'Image must be under 8 MB');
      return;
    }
    setLoading(true);
    try {
      await saveBgImage(file);
      if (bgPreview) URL.revokeObjectURL(bgPreview);
      const url = URL.createObjectURL(file);
      setBgPreview(url);
      onUpdateSettings({ bgImageEnabled: true });
      addToast('success', 'Background image set');
    } catch {
      addToast('error', 'Failed to save image');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemoveImage = async () => {
    try {
      await removeBgImage();
      if (bgPreview) URL.revokeObjectURL(bgPreview);
      setBgPreview(null);
      onUpdateSettings({ bgImageEnabled: false });
      addToast('success', 'Background image removed');
    } catch {
      addToast('error', 'Failed to remove image');
    }
  };

  const resetPosition = () => onUpdateSettings({ bgImagePosX: 50, bgImagePosY: 50, bgImageZoom: 100 });

  return (
    <div className="space-y-6">
      {/* Color Scheme */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Color Scheme</h3>
        <div className="grid grid-cols-3 gap-2">
          {COLOR_SCHEMES.map((s) => (
            <button
              key={s.id}
              onClick={() => onUpdateSettings({ colorScheme: s.id })}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                scheme === s.id
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-300'
              }`}
            >
              <span
                className="w-4 h-4 rounded-full shrink-0 border border-white/20"
                style={{ backgroundColor: s.swatch }}
              />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background Image */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Background Image</h3>

        {bgPreview ? (
          <div className="space-y-3">
            {/* Preview */}
            <div className="relative rounded-lg overflow-hidden border border-gray-700 h-36">
              <img
                src={bgPreview}
                alt="Background preview"
                className="w-full h-full object-cover"
                style={{ objectPosition: `${posX}% ${posY}%`, transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined }}
              />
              <div
                className="absolute inset-0"
                style={{ backgroundColor: settings.theme === 'dark' ? `rgba(0,0,0,${opacity / 100})` : `rgba(255,255,255,${opacity / 100})` }}
              />
              <button
                onClick={handleRemoveImage}
                className="absolute top-2 right-2 p-1 rounded bg-black/60 text-white hover:bg-black/80 transition-colors"
                title="Remove image"
              >
                <X size={14} />
              </button>
            </div>

            {/* Enable toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bgEnabled}
                onChange={(e) => onUpdateSettings({ bgImageEnabled: e.target.checked })}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Enable background</span>
            </label>

            {/* Transparency */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Transparency</span>
                <span className="text-xs text-gray-500 tabular-nums">{100 - opacity}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                value={100 - opacity}
                onChange={(e) => onUpdateSettings({ bgImageOpacity: 100 - Number(e.target.value) })}
                className="w-full accent-accent h-1.5"
              />
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Subtle</span>
                <span>Vivid</span>
              </div>
            </div>

            {/* Zoom */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Zoom</span>
                <span className="text-xs text-gray-500 tabular-nums">{zoom}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={zoom}
                onChange={(e) => onUpdateSettings({ bgImageZoom: Number(e.target.value) })}
                className="w-full accent-accent h-1.5"
              />
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Out</span>
                <span>In</span>
              </div>
            </div>

            {/* Position */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Position</span>
                {(posX !== 50 || posY !== 50 || zoom !== 100) && (
                  <button
                    onClick={resetPosition}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <RotateCcw size={10} />
                    Reset
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Horizontal</span>
                    <span className="text-[10px] text-gray-600 tabular-nums">{posX}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={posX}
                    onChange={(e) => onUpdateSettings({ bgImagePosX: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600">
                    <span>Left</span>
                    <span>Right</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Vertical</span>
                    <span className="text-[10px] text-gray-600 tabular-nums">{posY}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={posY}
                    onChange={(e) => onUpdateSettings({ bgImagePosY: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600">
                    <span>Top</span>
                    <span>Bottom</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              Change image...
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="w-full flex flex-col items-center gap-2 py-6 rounded-lg border border-dashed border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-400 transition-colors"
          >
            {loading ? (
              <span className="text-sm">Saving...</span>
            ) : (
              <>
                <Upload size={20} />
                <span className="text-sm">Upload background image</span>
                <span className="text-xs text-gray-600">JPG, PNG, WebP (max 8 MB)</span>
              </>
            )}
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>
    </div>
  );
}
