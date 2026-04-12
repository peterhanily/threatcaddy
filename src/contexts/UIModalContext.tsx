/* eslint-disable react-refresh/only-export-components -- context + provider + hook co-located by design */
import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { SharePayload } from '../lib/share';
import { fetchServerInfo } from '../lib/server-api';
import { isEncryptionEnabled } from '../lib/encryptionStore';

// ─── Helpers ─────────────────────────────────────────────────────────

function parseInitialShareHash(): string | null {
  const match = window.location.hash.match(/^#share=(.+)$/);
  return match?.[1] ?? null;
}

// ─── Types ───────────────────────────────────────────────────────────

interface UIModalContextValue {
  // Settings
  showSettings: boolean;
  settingsInitialTab?: string;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;

  // Modals
  showQuickCapture: boolean;
  setShowQuickCapture: React.Dispatch<React.SetStateAction<boolean>>;
  showPlaybookPicker: boolean;
  setShowPlaybookPicker: React.Dispatch<React.SetStateAction<boolean>>;
  playbookApplyFolderId?: string;
  setPlaybookApplyFolderId: React.Dispatch<React.SetStateAction<string | undefined>>;
  showIOCForm: boolean;
  setShowIOCForm: React.Dispatch<React.SetStateAction<boolean>>;
  showDataImport: boolean;
  setShowDataImport: React.Dispatch<React.SetStateAction<boolean>>;
  searchOverlayOpen: boolean;
  setSearchOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showDemoModal: boolean;
  setShowDemoModal: React.Dispatch<React.SetStateAction<boolean>>;
  showCreateInvestigationModal: boolean;
  setShowCreateInvestigationModal: React.Dispatch<React.SetStateAction<boolean>>;
  showNameGenerator: boolean;
  setShowNameGenerator: React.Dispatch<React.SetStateAction<boolean>>;
  showShortcutsPanel: boolean;
  setShowShortcutsPanel: React.Dispatch<React.SetStateAction<boolean>>;

  // Mobile
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  forceAnalystMode: boolean;
  setForceAnalystMode: React.Dispatch<React.SetStateAction<boolean>>;

  // Screenshare
  screenshareMaxLevel: string | null;
  setScreenshareMaxLevel: React.Dispatch<React.SetStateAction<string | null>>;

  // Import/Share
  pendingImportFile: File | null;
  setPendingImportFile: React.Dispatch<React.SetStateAction<File | null>>;
  shareLinkPayload: SharePayload | null;
  setShareLinkPayload: React.Dispatch<React.SetStateAction<SharePayload | null>>;
  shareData: string | null;
  setShareData: React.Dispatch<React.SetStateAction<string | null>>;

  // Server onboarding
  showServerOnboarding: boolean;
  setShowServerOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  serverOnboardingName: string;
  setServerOnboardingName: React.Dispatch<React.SetStateAction<string>>;
  dismissServerOnboarding: () => void;

  // File encryption warning
  fileEncryptionDismissed: boolean;
  showFileEncryptionWarning: boolean;
  dismissFileEncryptionWarning: () => void;

  // Bulk
  closeAllModals: () => void;
}

interface UIModalProviderProps {
  authConnected: boolean;
  authServerUrl?: string;
  isMobile: boolean;
  children: React.ReactNode;
}

// ─── Context ─────────────────────────────────────────────────────────

const UIModalContext = createContext<UIModalContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────

export function UIModalProvider({ authConnected, authServerUrl, isMobile, children }: UIModalProviderProps) {
  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>();

  // Modals
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showPlaybookPicker, setShowPlaybookPicker] = useState(false);
  const [playbookApplyFolderId, setPlaybookApplyFolderId] = useState<string | undefined>();
  const [showIOCForm, setShowIOCForm] = useState(false);
  const [showDataImport, setShowDataImport] = useState(false);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showCreateInvestigationModal, setShowCreateInvestigationModal] = useState(false);
  const [showNameGenerator, setShowNameGenerator] = useState(false);
  const [showShortcutsPanel, setShowShortcutsPanel] = useState(false);

  // Mobile
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [forceAnalystMode, setForceAnalystMode] = useState(
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem('tc-analyst-mode') === '1',
  );

  // Screenshare
  const [screenshareMaxLevel, setScreenshareMaxLevel] = useState<string | null>(null);

  // Import/Share
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [shareLinkPayload, setShareLinkPayload] = useState<SharePayload | null>(null);
  const [shareData, setShareData] = useState<string | null>(parseInitialShareHash);

  // Server onboarding
  const [showServerOnboarding, setShowServerOnboarding] = useState(false);
  const [serverOnboardingName, setServerOnboardingName] = useState('your team server');

  // File encryption warning
  const [showFileEncryptionWarning] = useState(() =>
    typeof __STANDALONE__ !== 'undefined' && __STANDALONE__
    && window.location.protocol === 'file:'
    && !isEncryptionEnabled()
    && localStorage.getItem('tc-file-encrypt-dismissed') !== '1',
  );
  const [fileEncryptionDismissed, setFileEncryptionDismissed] = useState(false);

  // ─── Callbacks ───────────────────────────────────────────────────

  const openSettings = useCallback((tab?: string) => {
    setShowSettings(true);
    setSettingsInitialTab(tab);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialTab(undefined);
  }, []);

  const closeAllModals = useCallback(() => {
    setSearchOverlayOpen(false);
    setShowQuickCapture(false);
    setShowSettings(false);
    setShowShortcutsPanel(false);
    setMobileSidebarOpen(false);
  }, []);

  const dismissServerOnboarding = useCallback(() => {
    if (authServerUrl) {
      localStorage.setItem(`tc-server-onboarded-${authServerUrl}`, '1');
    }
    setShowServerOnboarding(false);
  }, [authServerUrl]);

  const dismissFileEncryptionWarning = useCallback(() => {
    localStorage.setItem('tc-file-encrypt-dismissed', '1');
    setFileEncryptionDismissed(true);
  }, []);

  // ─── Effects ─────────────────────────────────────────────────────

  // Analyst mode persistence
  useEffect(() => {
    if (forceAnalystMode) sessionStorage.setItem('tc-analyst-mode', '1');
    else sessionStorage.removeItem('tc-analyst-mode');
  }, [forceAnalystMode]);

  // Deep link forces analyst mode on mobile
  useEffect(() => {
    const hasDeepLink = /^#entity=/.test(window.location.hash);
    if (hasDeepLink && isMobile) setForceAnalystMode(true);
  }, [isMobile]);

  // Share hash listener
  useEffect(() => {
    const handler = () => {
      const match = window.location.hash.match(/^#share=(.+)$/);
      if (match?.[1]) setShareData(match[1]);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Server onboarding check
  const serverOnboardingCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authConnected || !authServerUrl) return;
    if (serverOnboardingCheckedRef.current === authServerUrl) return;
    serverOnboardingCheckedRef.current = authServerUrl;
    const key = `tc-server-onboarded-${authServerUrl}`;
    if (localStorage.getItem(key)) return;
    const url = authServerUrl;
    fetchServerInfo()
      .then(info => setServerOnboardingName(info.serverName || url))
      .catch(() => setServerOnboardingName(url))
      .finally(() => setShowServerOnboarding(true));
  }, [authConnected, authServerUrl]);

  // ─── Context value ───────────────────────────────────────────────

  const value = useMemo<UIModalContextValue>(() => ({
    showSettings,
    settingsInitialTab,
    openSettings,
    closeSettings,

    showQuickCapture,
    setShowQuickCapture,
    showPlaybookPicker,
    setShowPlaybookPicker,
    playbookApplyFolderId,
    setPlaybookApplyFolderId,
    showIOCForm,
    setShowIOCForm,
    showDataImport,
    setShowDataImport,
    searchOverlayOpen,
    setSearchOverlayOpen,
    showDemoModal,
    setShowDemoModal,
    showCreateInvestigationModal,
    setShowCreateInvestigationModal,
    showNameGenerator,
    setShowNameGenerator,
    showShortcutsPanel,
    setShowShortcutsPanel,

    mobileSidebarOpen,
    setMobileSidebarOpen,
    forceAnalystMode,
    setForceAnalystMode,

    screenshareMaxLevel,
    setScreenshareMaxLevel,

    pendingImportFile,
    setPendingImportFile,
    shareLinkPayload,
    setShareLinkPayload,
    shareData,
    setShareData,

    showServerOnboarding,
    setShowServerOnboarding,
    serverOnboardingName,
    setServerOnboardingName,
    dismissServerOnboarding,

    fileEncryptionDismissed,
    showFileEncryptionWarning,
    dismissFileEncryptionWarning,

    closeAllModals,
  }), [
    showSettings,
    settingsInitialTab,
    openSettings,
    closeSettings,

    showQuickCapture,
    showPlaybookPicker,
    playbookApplyFolderId,
    showIOCForm,
    showDataImport,
    searchOverlayOpen,
    showDemoModal,
    showCreateInvestigationModal,
    showNameGenerator,
    showShortcutsPanel,

    mobileSidebarOpen,
    forceAnalystMode,

    screenshareMaxLevel,

    pendingImportFile,
    shareLinkPayload,
    shareData,

    showServerOnboarding,
    serverOnboardingName,
    dismissServerOnboarding,

    fileEncryptionDismissed,
    showFileEncryptionWarning,
    dismissFileEncryptionWarning,

    closeAllModals,
  ]);

  return (
    <UIModalContext.Provider value={value}>
      {children}
    </UIModalContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useUIModals() {
  const ctx = useContext(UIModalContext);
  if (!ctx) throw new Error('useUIModals must be used within UIModalProvider');
  return ctx;
}
