/* eslint-disable react-refresh/only-export-components -- context + provider + hook co-located by design */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type {
  InvestigationDataMode,
  InvestigationStatus,
  IOCType,
  Folder,
  Tag,
  InvestigationMember,
} from '../types';
import { db } from '../db';
import { fetchInvestigationMembers } from '../lib/server-api';

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

interface InvestigationContextValue {
  // --- folders / tags ---
  folders: Folder[];
  tags: Tag[];
  selectedFolder: Folder | undefined;
  selectedTagObj: Tag | undefined;
  editingFolder: Folder | undefined;

  // --- selection & mode ---
  selectedFolderId: string | undefined;
  setSelectedFolderId: (id?: string) => void;
  investigationMode: InvestigationDataMode;
  setInvestigationMode: (mode: InvestigationDataMode) => void;
  editingFolderId: string | undefined;
  setEditingFolderId: (id?: string) => void;

  // --- filters ---
  folderStatusFilter: InvestigationStatus[];
  setFolderStatusFilter: (filter: InvestigationStatus[]) => void;
  selectedTag: string | undefined;
  setSelectedTag: (tag?: string) => void;
  selectedIOCTypes: IOCType[];
  setSelectedIOCTypes: (types: IOCType[]) => void;
  showTrash: boolean;
  setShowTrash: (v: boolean) => void;
  showArchive: boolean;
  setShowArchive: (v: boolean) => void;
  clearFilters: () => void;

  // --- team ---
  investigationMembers: InvestigationMember[];
  agentPendingCount: number;

  // --- sync ---
  syncingFolderId: string | null;
  confirmUnsyncId: string | null;
  setConfirmUnsyncId: (id: string | null) => void;

  // --- actions ---
  handleOpenInvestigation: (folderId: string, mode: InvestigationDataMode) => void;
  handleSyncLocally: (folderId: string) => void;
  handleUnsync: (folderId: string) => void;
  handleUnsyncConfirmed: (folderId: string) => void;
}

// ---------------------------------------------------------------------------
// Provider props
// ---------------------------------------------------------------------------

interface InvestigationProviderProps {
  folders: Folder[];
  tags: Tag[];
  authConnected: boolean;
  initialSelectedFolderId?: string;
  onNavigateToNotes?: () => void;
  onReloadAll?: () => void;
  onRefreshRemote?: () => void;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const InvestigationContext = createContext<InvestigationContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function InvestigationProvider({
  folders,
  tags,
  authConnected,
  initialSelectedFolderId,
  onNavigateToNotes,
  onReloadAll,
  onRefreshRemote,
  children,
}: InvestigationProviderProps) {
  // --- state ---
  const [selectedFolderId, setSelectedFolderIdRaw] = useState<string | undefined>(initialSelectedFolderId);
  const [investigationMode, setInvestigationMode] = useState<InvestigationDataMode>('local');
  const [editingFolderId, setEditingFolderId] = useState<string | undefined>();
  const [folderStatusFilter, setFolderStatusFilter] = useState<InvestigationStatus[]>(['active']);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedIOCTypes, setSelectedIOCTypes] = useState<IOCType[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [investigationMembers, setInvestigationMembers] = useState<InvestigationMember[]>([]);
  const [agentPendingCount, setAgentPendingCount] = useState(0);
  const [syncingFolderId, setSyncingFolderId] = useState<string | null>(null);
  const [confirmUnsyncId, setConfirmUnsyncId] = useState<string | null>(null);

  // --- setSelectedFolderId with side-effects ---
  const setSelectedFolderId = useCallback((id?: string) => {
    setSelectedFolderIdRaw(id);
    if (!id) {
      setInvestigationMode('local');
    }
    import('../lib/agent-bridge').then(m => m.syncBridgeFolderId(id)).catch(() => {});
  }, []);

  // --- actions ---
  const handleOpenInvestigation = useCallback((folderId: string, mode: InvestigationDataMode) => {
    setSelectedFolderId(folderId);
    setInvestigationMode(mode);
    onNavigateToNotes?.();
  }, [setSelectedFolderId, onNavigateToNotes]);

  const handleSyncLocally = useCallback(async (folderId: string) => {
    setSyncingFolderId(folderId);
    try {
      const { syncEngine } = await import('../lib/sync-engine');
      await syncEngine.pullFolder(folderId);
      onReloadAll?.();
      onRefreshRemote?.();
      setInvestigationMode('synced');
    } catch (err) {
      console.error('Failed to sync locally', err);
    } finally {
      setSyncingFolderId(null);
    }
  }, [onReloadAll, onRefreshRemote]);

  const handleUnsyncConfirmed = useCallback(async (folderId: string) => {
    setSyncingFolderId(folderId);
    try {
      await Promise.all([
        db.notes.where('folderId').equals(folderId).delete(),
        db.tasks.where('folderId').equals(folderId).delete(),
        db.timelineEvents.where('folderId').equals(folderId).delete(),
        db.whiteboards.where('folderId').equals(folderId).delete(),
        db.standaloneIOCs.where('folderId').equals(folderId).delete(),
        db.chatThreads.where('folderId').equals(folderId).delete(),
      ]);
      await db.folders.delete(folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderIdRaw(undefined);
      }
      onReloadAll?.();
    } finally {
      setSyncingFolderId(null);
    }
  }, [selectedFolderId, onReloadAll]);

  const handleUnsync = useCallback((folderId: string) => {
    setConfirmUnsyncId(folderId);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedFolderIdRaw(undefined);
    setSelectedTag(undefined);
    setShowTrash(false);
    setShowArchive(false);
  }, []);

  // --- effects ---

  // Fetch investigation members when folder or auth changes
  useEffect(() => {
    if (!authConnected || !selectedFolderId) {
      setInvestigationMembers([]);
      return;
    }
    fetchInvestigationMembers(selectedFolderId)
      .then(setInvestigationMembers)
      .catch(() => setInvestigationMembers([]));
  }, [authConnected, selectedFolderId]);

  // Agent pending count
  useEffect(() => {
    if (!selectedFolderId) {
      setAgentPendingCount(0);
      return;
    }
    db.agentActions
      .where('[investigationId+status]')
      .equals([selectedFolderId, 'pending'])
      .count()
      .then(setAgentPendingCount)
      .catch(() => setAgentPendingCount(0));
  }, [selectedFolderId]);

  // Auto-deselect when selected folder no longer exists (deleted externally or by another tab)
  useEffect(() => {
    if (selectedFolderId && folders.length > 0 && !folders.find(f => f.id === selectedFolderId)) {
      setSelectedFolderIdRaw(undefined);
      setInvestigationMode('local');
    }
  }, [selectedFolderId, folders]);

  // --- computed ---
  const selectedFolder = useMemo(() => folders.find(f => f.id === selectedFolderId), [folders, selectedFolderId]);
  const selectedTagObj = useMemo(() => tags.find(t => t.name === selectedTag), [tags, selectedTag]);
  const editingFolder = useMemo(() => folders.find(f => f.id === editingFolderId), [folders, editingFolderId]);

  // --- context value ---
  const value = useMemo<InvestigationContextValue>(() => ({
    folders,
    tags,
    selectedFolder,
    selectedTagObj,
    editingFolder,
    selectedFolderId,
    setSelectedFolderId,
    investigationMode,
    setInvestigationMode,
    editingFolderId,
    setEditingFolderId,
    folderStatusFilter,
    setFolderStatusFilter,
    selectedTag,
    setSelectedTag,
    selectedIOCTypes,
    setSelectedIOCTypes,
    showTrash,
    setShowTrash,
    showArchive,
    setShowArchive,
    clearFilters,
    investigationMembers,
    agentPendingCount,
    syncingFolderId,
    confirmUnsyncId,
    setConfirmUnsyncId,
    handleOpenInvestigation,
    handleSyncLocally,
    handleUnsync,
    handleUnsyncConfirmed,
  }), [
    folders,
    tags,
    selectedFolder,
    selectedTagObj,
    editingFolder,
    selectedFolderId,
    setSelectedFolderId,
    investigationMode,
    editingFolderId,
    folderStatusFilter,
    selectedTag,
    selectedIOCTypes,
    showTrash,
    showArchive,
    clearFilters,
    investigationMembers,
    agentPendingCount,
    syncingFolderId,
    confirmUnsyncId,
    handleOpenInvestigation,
    handleSyncLocally,
    handleUnsync,
    handleUnsyncConfirmed,
  ]);

  return (
    <InvestigationContext.Provider value={value}>
      {children}
    </InvestigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInvestigation() {
  const ctx = useContext(InvestigationContext);
  if (!ctx) throw new Error('useInvestigation must be used within InvestigationProvider');
  return ctx;
}
