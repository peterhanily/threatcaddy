import { useRef } from 'react';
import { Upload, X, Users } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

export function AttributionActors() {
  const { settings, updateSettings } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const actors = settings.attributionActors ?? [];

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = text
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const unique = [...new Set([...actors, ...parsed])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      updateSettings({ attributionActors: unique });
    };
    reader.readAsText(file);
    // Reset so re-importing the same file triggers onChange
    e.target.value = '';
  };

  const handleClear = () => {
    updateSettings({ attributionActors: [] });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Users size={16} />
        Attribution Actors
      </h3>

      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleImport}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
        >
          <Upload size={16} />
          Import CSV
        </button>
        {actors.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-red-400"
          >
            <X size={16} />
            Clear All
          </button>
        )}
      </div>

      {actors.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">{actors.length} actor{actors.length !== 1 ? 's' : ''} loaded</p>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {actors.map((actor) => (
              <span
                key={actor}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300 border border-gray-700"
              >
                {actor}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600">
        Import a CSV or text file with actor names (one per line, or comma-separated).
        These will appear as suggestions in IOC attribution fields.
      </p>
    </div>
  );
}
