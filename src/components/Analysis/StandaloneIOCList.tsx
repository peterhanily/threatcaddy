import { useState, useMemo, forwardRef } from 'react';
import { Plus, Pencil, Trash2, Archive, RotateCcw, Search, ChevronUp, ChevronDown, X, ListPlus, Clipboard, Tag as TagIcon, GitMerge } from 'lucide-react';
import type { StandaloneIOC, Folder, Tag, IOCType, ConfidenceLevel } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS, IOC_STATUS_VALUES, IOC_STATUS_LABELS, IOC_STATUS_COLORS } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { StandaloneIOCForm } from './StandaloneIOCForm';
import { BulkIOCImportModal } from './BulkIOCImportModal';
import { IOCDeduplicator } from './IOCDeduplicator';
import { RunIntegrationMenu } from '../Integrations/RunIntegrationMenu';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import { TableVirtuoso } from 'react-virtuoso';

const STATUS_COLORS: Record<string, string> = IOC_STATUS_COLORS;
const STATUS_LABELS: Record<string, string> = IOC_STATUS_LABELS;

const CLS_COLORS: Record<string, string> = {
  'TLP:CLEAR': '#ffffff',
  'TLP:GREEN': '#22c55e',
  'TLP:AMBER': '#f59e0b',
  'TLP:AMBER+STRICT': '#f59e0b',
  'TLP:RED': '#ef4444',
};

// Sort field types
type SortField = 'value' | 'type' | 'confidence' | 'iocStatus' | 'attribution' | 'updatedAt';
type SortDir = 'asc' | 'desc';

// Confidence ordering for sorting
const CONFIDENCE_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, confirmed: 3 };

// Filter options
const STATUS_OPTIONS = IOC_STATUS_VALUES;
const CONFIDENCE_OPTIONS: ConfidenceLevel[] = ['low', 'medium', 'high', 'confirmed'];
const ALL_IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];

interface StandaloneIOCListProps {
  iocs: StandaloneIOC[];
  folders: Folder[];
  allTags?: Tag[];
  allIOCs?: StandaloneIOC[];
  onCreate: (data: Partial<StandaloneIOC>) => Promise<StandaloneIOC>;
  onUpdate: (id: string, updates: Partial<StandaloneIOC>) => void;
  onDelete: (id: string) => void;
  onTrash?: (id: string) => void;
  onRestore?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  defaultFolderId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  onOpenSettings?: () => void;
  onNavigateToNote?: (noteId: string) => void;
}

export function StandaloneIOCList({
  iocs,
  folders,
  allTags,
  allIOCs,
  onCreate,
  onUpdate,
  onDelete,
  onTrash,
  onRestore,
  onToggleArchive,
  defaultFolderId,
  currentFolderId,
  currentFolderName,
  onOpenSettings,
  onNavigateToNote,
}: StandaloneIOCListProps) {
  const { getInstallationsForIOCType, addRun } = useIntegrations();
  const { addToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingIOC, setEditingIOC] = useState<StandaloneIOC | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);
  const [showBulkConfidenceMenu, setShowBulkConfidenceMenu] = useState(false);
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  const [bulkTagText, setBulkTagText] = useState('');
  const [showDeduplicator, setShowDeduplicator] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel | null>(null);
  const [typeFilter, setTypeFilter] = useState<IOCType[]>([]);
  const [searchText, setSearchText] = useState('');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'updatedAt' ? 'desc' : 'asc');
    }
  };

  // Filter then sort
  const filteredSortedIOCs = useMemo(() => {
    let result = iocs;

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(ioc => ioc.value.toLowerCase().includes(q));
    }
    if (statusFilter) {
      result = result.filter(ioc => ioc.iocStatus === statusFilter);
    }
    if (confidenceFilter) {
      result = result.filter(ioc => ioc.confidence === confidenceFilter);
    }
    if (typeFilter.length > 0) {
      result = result.filter(ioc => typeFilter.includes(ioc.type));
    }

    const sorted = [...result];
    const dir = sortDir === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortField) {
        case 'value':
          return dir * a.value.localeCompare(b.value);
        case 'type': {
          const aLabel = IOC_TYPE_LABELS[a.type]?.label || '';
          const bLabel = IOC_TYPE_LABELS[b.type]?.label || '';
          return dir * aLabel.localeCompare(bLabel);
        }
        case 'confidence':
          return dir * ((CONFIDENCE_ORDER[a.confidence] ?? 0) - (CONFIDENCE_ORDER[b.confidence] ?? 0));
        case 'iocStatus': {
          const aStatus = a.iocStatus || '';
          const bStatus = b.iocStatus || '';
          return dir * aStatus.localeCompare(bStatus);
        }
        case 'attribution': {
          const aAttr = a.attribution || '';
          const bAttr = b.attribution || '';
          return dir * aAttr.localeCompare(bAttr);
        }
        case 'updatedAt':
          return dir * (a.updatedAt - b.updatedAt);
        default:
          return 0;
      }
    });

    return sorted;
  }, [iocs, searchText, statusFilter, confidenceFilter, typeFilter, sortField, sortDir]);

  const hasActiveFilters = searchText.trim() !== '' || statusFilter !== null || confidenceFilter !== null || typeFilter.length > 0;

  const handleSubmit = async (data: Partial<StandaloneIOC>) => {
    if (editingIOC) {
      onUpdate(editingIOC.id, data);
    } else {
      await onCreate(data);
    }
    setEditingIOC(undefined);
  };

  // ─── Bulk operations ────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSortedIOCs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSortedIOCs.map(i => i.id)));
    }
  };

  const getSelectedIds = () => filteredSortedIOCs.filter(i => selectedIds.has(i.id)).map(i => i.id);

  const handleBulkDelete = () => {
    const ids = getSelectedIds();
    for (const id of ids) {
      if (onTrash) onTrash(id);
      else onDelete(id);
    }
    setSelectedIds(new Set());
    setShowBulkDelete(false);
    addToast('success', `Deleted ${ids.length} IOC${ids.length !== 1 ? 's' : ''}`);
  };

  const handleBulkSetStatus = (status: string) => {
    const ids = getSelectedIds();
    for (const id of ids) onUpdate(id, { iocStatus: status });
    setSelectedIds(new Set());
    setShowBulkStatusMenu(false);
    addToast('success', `Updated status on ${ids.length} IOC${ids.length !== 1 ? 's' : ''}`);
  };

  const handleBulkSetConfidence = (confidence: ConfidenceLevel) => {
    const ids = getSelectedIds();
    for (const id of ids) onUpdate(id, { confidence });
    setSelectedIds(new Set());
    setShowBulkConfidenceMenu(false);
    addToast('success', `Updated confidence on ${ids.length} IOC${ids.length !== 1 ? 's' : ''}`);
  };

  const handleBulkAddTags = () => {
    if (!bulkTagText.trim()) return;
    const newTags = bulkTagText.split(',').map(t => t.trim()).filter(Boolean);
    const selected = filteredSortedIOCs.filter(i => selectedIds.has(i.id));
    for (const ioc of selected) {
      const merged = [...new Set([...ioc.tags, ...newTags])];
      onUpdate(ioc.id, { tags: merged });
    }
    setSelectedIds(new Set());
    setShowBulkTagInput(false);
    setBulkTagText('');
    addToast('success', `Added tags to ${selected.length} IOC${selected.length !== 1 ? 's' : ''}`);
  };

  const SortHeader = ({ field, label, className }: { field: SortField; label: string; className: string }) => (
    <th
      className={`${className} cursor-pointer select-none hover:text-gray-300 transition-colors`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortField === field ? (
          sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <span className="w-3" />
        )}
      </span>
    </th>
  );

  const toggleTypeFilter = (type: IOCType) => {
    setTypeFilter(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-200">Standalone IOCs</h2>
          <span className="text-xs text-gray-500 tabular-nums">
            {hasActiveFilters ? `${filteredSortedIOCs.length} / ${iocs.length}` : iocs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {iocs.length > 1 && (
            <button
              onClick={() => setShowDeduplicator(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm font-medium transition-colors"
              title="Find duplicate IOCs"
            >
              <GitMerge size={16} />
              Dedup
            </button>
          )}
          {iocs.length > 0 && (
            <button
              onClick={async () => {
                const text = filteredSortedIOCs.map((i) => i.value).join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                  addToast('success', `Copied ${filteredSortedIOCs.length} IOC${filteredSortedIOCs.length !== 1 ? 's' : ''} to clipboard`);
                } catch {
                  addToast('error', 'Failed to copy to clipboard');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm font-medium transition-colors"
              title="Copy visible IOC values to clipboard"
            >
              <Clipboard size={16} />
              Copy
            </button>
          )}
          <button
            onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm font-medium transition-colors"
            title="Bulk import IOCs from text"
          >
            <ListPlus size={16} />
            Bulk Import
          </button>
          <button
            onClick={() => { setEditingIOC(undefined); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New IOC
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-accent/5 flex-wrap">
          <span className="text-xs font-medium text-accent">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-gray-700" />
          <button onClick={() => setShowBulkDelete(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 text-xs">
            <Trash2 size={12} /> Delete
          </button>
          <div className="relative">
            <button onClick={() => setShowBulkStatusMenu(!showBulkStatusMenu)} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs">
              Set Status <ChevronDown size={10} />
            </button>
            {showBulkStatusMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-44">
                {STATUS_OPTIONS.map(s => (
                  <button key={s} onClick={() => handleBulkSetStatus(s)} className="w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                    {STATUS_LABELS[s] || s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowBulkConfidenceMenu(!showBulkConfidenceMenu)} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs">
              Set Confidence <ChevronDown size={10} />
            </button>
            {showBulkConfidenceMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 w-36">
                {CONFIDENCE_OPTIONS.map(c => (
                  <button key={c} onClick={() => handleBulkSetConfidence(c)} className="w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CONFIDENCE_LEVELS[c].color }} />
                    {CONFIDENCE_LEVELS[c].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowBulkTagInput(!showBulkTagInput)} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs">
              <TagIcon size={12} /> Add Tags
            </button>
            {showBulkTagInput && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 w-56">
                <input autoFocus value={bulkTagText} onChange={e => setBulkTagText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleBulkAddTags(); }} placeholder="tag1, tag2, ..." className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-600" />
                <button onClick={handleBulkAddTags} disabled={!bulkTagText.trim()} className="mt-1.5 w-full px-2 py-1 rounded bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 disabled:opacity-50">Apply Tags</button>
              </div>
            )}
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-300 px-2 py-1">Clear selection</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2 border-b border-gray-800">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Filter by value..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-600"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Status</span>
          <button
            onClick={() => setStatusFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              statusFilter === null
                ? 'bg-gray-600/40 border-gray-500 text-gray-200'
                : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            All
          </button>
          {STATUS_OPTIONS.map(s => {
            const color = STATUS_COLORS[s] || '#6b7280';
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? null : s)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${color}30` : `${color}10`,
                  borderColor: active ? `${color}60` : `${color}20`,
                  color: active ? color : `${color}90`,
                }}
              >
                {STATUS_LABELS[s] || s}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Confidence</span>
          <button
            onClick={() => setConfidenceFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              confidenceFilter === null
                ? 'bg-gray-600/40 border-gray-500 text-gray-200'
                : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            All
          </button>
          {CONFIDENCE_OPTIONS.map(c => {
            const info = CONFIDENCE_LEVELS[c];
            const active = confidenceFilter === c;
            return (
              <button
                key={c}
                onClick={() => setConfidenceFilter(active ? null : c)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${info.color}30` : `${info.color}10`,
                  borderColor: active ? `${info.color}60` : `${info.color}20`,
                  color: active ? info.color : `${info.color}90`,
                }}
              >
                {info.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide mr-1">Type</span>
          {ALL_IOC_TYPES.map(type => {
            const info = IOC_TYPE_LABELS[type];
            const active = typeFilter.includes(type);
            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: active ? `${info.color}30` : `${info.color}10`,
                  borderColor: active ? `${info.color}60` : `${info.color}20`,
                  color: active ? info.color : `${info.color}90`,
                }}
              >
                {info.label}
              </button>
            );
          })}
          {typeFilter.length > 0 && (
            <button
              onClick={() => setTypeFilter([])}
              className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5"
            >
              Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">
              Showing {filteredSortedIOCs.length} of {iocs.length}
            </span>
            <button
              onClick={() => { setSearchText(''); setStatusFilter(null); setConfidenceFilter(null); setTypeFilter([]); }}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      <div className="p-4">
        {iocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Search size={36} className="mb-3" />
            <p className="text-lg font-medium">No standalone IOCs yet</p>
            <p className="text-sm mt-1">Create IOCs to track indicators independently</p>
          </div>
        ) : filteredSortedIOCs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Search size={36} className="mb-3" />
            <p className="text-lg font-medium">No IOCs match filters</p>
            <p className="text-sm mt-1">Try adjusting your filter criteria</p>
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ height: Math.min(600, 40 + filteredSortedIOCs.length * 40) }}>
            <TableVirtuoso
              data={filteredSortedIOCs}
              components={{
                Table: (props) => <table {...props} className="w-full min-w-[640px] text-xs" />,
                TableHead: forwardRef((props, ref) => <thead ref={ref} {...props} />),
                TableRow: (props) => <tr {...props} className="border-b border-gray-800/50 group" />,
                TableBody: forwardRef((props, ref) => <tbody ref={ref} {...props} />),
              }}
              fixedHeaderContent={() => (
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="text-left text-gray-500 font-medium py-2 pr-1 w-8">
                    <input type="checkbox" checked={filteredSortedIOCs.length > 0 && selectedIds.size === filteredSortedIOCs.length} onChange={toggleSelectAll} className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer" />
                  </th>
                  <SortHeader field="value" label="Value" className="text-left text-gray-500 font-medium py-2 pr-2" />
                  <SortHeader field="type" label="Type" className="text-left text-gray-500 font-medium py-2 px-2" />
                  <SortHeader field="confidence" label="Confidence" className="text-left text-gray-500 font-medium py-2 px-2" />
                  <SortHeader field="iocStatus" label="Status" className="text-left text-gray-500 font-medium py-2 px-2" />
                  <SortHeader field="attribution" label="Attribution" className="text-left text-gray-500 font-medium py-2 px-2" />
                  <th className="text-left text-gray-500 font-medium py-2 px-2" title="Classification">CLS</th>
                  <SortHeader field="updatedAt" label="Updated" className="text-left text-gray-500 font-medium py-2 px-2" />
                  <th className="text-right text-gray-500 font-medium py-2 pl-2">Actions</th>
                </tr>
              )}
              itemContent={(_index, ioc) => {
                const typeInfo = IOC_TYPE_LABELS[ioc.type];
                const confInfo = CONFIDENCE_LEVELS[ioc.confidence];
                const statusColor = ioc.iocStatus ? STATUS_COLORS[ioc.iocStatus] || '#6b7280' : undefined;
                const clsColor = ioc.clsLevel ? CLS_COLORS[ioc.clsLevel] || '#6b7280' : undefined;
                return (
                  <>
                    <td className="py-2 pr-1 w-8">
                      <input type="checkbox" checked={selectedIds.has(ioc.id)} onChange={() => toggleSelect(ioc.id)} className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer" />
                    </td>
                    <td className="py-2 pr-2 text-gray-200 font-mono max-w-[240px] truncate">{ioc.value}</td>
                    <td className="py-2 px-2">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: typeInfo.color + '22', color: typeInfo.color }}
                      >
                        {typeInfo.label}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: confInfo.color + '22', color: confInfo.color }}
                      >
                        {confInfo.label}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      {ioc.iocStatus ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: statusColor + '22', color: statusColor }}
                        >
                          {STATUS_LABELS[ioc.iocStatus] || ioc.iocStatus}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-gray-400">{ioc.attribution || '—'}</td>
                    <td className="py-2 px-2">
                      {ioc.clsLevel ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: clsColor + '22', color: clsColor }}
                        >
                          {ioc.clsLevel}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-gray-500">{formatDate(ioc.updatedAt)}</td>
                    <td className="py-2 pl-2">
                      <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                        {ioc.trashed ? (
                          <>
                            {onRestore && (
                              <button
                                onClick={() => onRestore(ioc.id)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-green-400"
                                title="Restore"
                              >
                                <RotateCcw size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => setDeletingId(ioc.id)}
                              className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                              title="Delete permanently"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <RunIntegrationMenu
                              ioc={{ id: ioc.id, value: ioc.value, type: ioc.type, confidence: ioc.confidence }}
                              investigation={currentFolderId ? { id: currentFolderId, name: currentFolderName || '' } : undefined}
                              matching={getInstallationsForIOCType(ioc.type)}
                              addRun={addRun}
                              onOpenSettings={onOpenSettings}
                              onNavigateToNote={onNavigateToNote}
                            />
                            <button
                              onClick={() => { setEditingIOC(ioc); setShowForm(true); }}
                              className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            {onToggleArchive && (
                              <button
                                onClick={() => onToggleArchive(ioc.id)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300"
                                title={ioc.archived ? 'Unarchive' : 'Archive'}
                              >
                                <Archive size={14} />
                              </button>
                            )}
                            {onTrash ? (
                              <button
                                onClick={() => onTrash(ioc.id)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                                title="Move to trash"
                              >
                                <Trash2 size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => setDeletingId(ioc.id)}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </>
                );
              }}
            />
          </div>
        )}
      </div>

      <StandaloneIOCForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditingIOC(undefined); }}
        onSubmit={handleSubmit}
        folders={folders}
        defaultFolderId={defaultFolderId}
        editingIOC={editingIOC}
        allTags={allTags}
      />

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId) { onDelete(deletingId); setDeletingId(null); } }}
        title="Delete IOC"
        message="This IOC will be permanently deleted. This cannot be undone."
        confirmLabel="Delete IOC"
        danger
      />

      <BulkIOCImportModal
        open={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        onCreate={onCreate}
        existingIOCs={allIOCs ?? iocs}
        folders={folders}
        allTags={allTags}
        defaultFolderId={defaultFolderId}
      />

      <ConfirmDialog
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected IOCs"
        message={`Delete ${selectedIds.size} IOC${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size}`}
        danger
      />

      <IOCDeduplicator
        open={showDeduplicator}
        onClose={() => setShowDeduplicator(false)}
        iocs={allIOCs ?? iocs}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />

    </div>
  );
}
