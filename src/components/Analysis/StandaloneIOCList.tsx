import { useState, forwardRef } from 'react';
import { Plus, Pencil, Trash2, Archive, RotateCcw, Search, ListPlus, Clipboard } from 'lucide-react';
import type { StandaloneIOC, Folder, Tag } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { StandaloneIOCForm } from './StandaloneIOCForm';
import { BulkIOCImportModal } from './BulkIOCImportModal';
import { RunIntegrationMenu } from '../Integrations/RunIntegrationMenu';
import { useIntegrations } from '../../hooks/useIntegrations';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import { TableVirtuoso } from 'react-virtuoso';

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  resolved: '#6b7280',
  'false-positive': '#f97316',
  'under-investigation': '#3b82f6',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  resolved: 'Resolved',
  'false-positive': 'False Positive',
  'under-investigation': 'Under Investigation',
};

const CLS_COLORS: Record<string, string> = {
  'TLP:CLEAR': '#ffffff',
  'TLP:GREEN': '#22c55e',
  'TLP:AMBER': '#f59e0b',
  'TLP:AMBER+STRICT': '#f59e0b',
  'TLP:RED': '#ef4444',
};

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
}: StandaloneIOCListProps) {
  const { getInstallationsForIOCType, addRun } = useIntegrations();
  const { addToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingIOC, setEditingIOC] = useState<StandaloneIOC | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSubmit = async (data: Partial<StandaloneIOC>) => {
    if (editingIOC) {
      onUpdate(editingIOC.id, data);
    } else {
      await onCreate(data);
    }
    setEditingIOC(undefined);
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-200">Standalone IOCs</h2>
          <span className="text-xs text-gray-500 tabular-nums">{iocs.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {iocs.length > 0 && (
            <button
              onClick={async () => {
                const text = iocs.map((i) => i.value).join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                  addToast('success', `Copied ${iocs.length} IOC${iocs.length !== 1 ? 's' : ''} to clipboard`);
                } catch {
                  addToast('error', 'Failed to copy to clipboard');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm font-medium transition-colors"
              title="Copy all visible IOC values to clipboard"
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

      <div className="p-4">
        {iocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Search size={36} className="mb-3" />
            <p className="text-lg font-medium">No standalone IOCs yet</p>
            <p className="text-sm mt-1">Create IOCs to track indicators independently</p>
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ height: Math.min(600, 40 + iocs.length * 40) }}>
            <TableVirtuoso
              data={iocs}
              components={{
                Table: (props) => <table {...props} className="w-full min-w-[640px] text-xs" />,
                TableHead: forwardRef((props, ref) => <thead ref={ref} {...props} />),
                TableRow: (props) => <tr {...props} className="border-b border-gray-800/50 group" />,
                TableBody: forwardRef((props, ref) => <tbody ref={ref} {...props} />),
              }}
              fixedHeaderContent={() => (
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="text-left text-gray-500 font-medium py-2 pr-2">Value</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2">Type</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2">Confidence</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2">Status</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2">Attribution</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2" title="Classification">CLS</th>
                  <th className="text-left text-gray-500 font-medium py-2 px-2">Updated</th>
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

    </div>
  );
}
