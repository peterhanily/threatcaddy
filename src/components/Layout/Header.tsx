import { Menu, Search, Github, Download, Chrome, HardDriveDownload, FolderUp, HelpCircle, Shield, RefreshCw, ChevronDown, Briefcase } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '../Common/ThemeToggle';
import { ScreenshareToggle } from '../Common/ScreenshareToggle';
import { CreateDropdown } from '../Common/CreateDropdown';
import { cn } from '../../lib/utils';
import { NotificationBell } from '../CaddyShack/NotificationBell';
import { PresenceIndicator } from '../Common/PresenceIndicator';
import type { PresenceUser } from '../../types';
import logoSvgRaw from '/logo.svg?raw';
const logoSvg = `data:image/svg+xml,${encodeURIComponent(logoSvgRaw)}`;

interface HeaderProps {
  onOpenSearch: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onQuickNote: () => void;
  onNewNote: () => void;
  onNewTask: () => void;
  onNewTimelineEvent: () => void;
  onNewWhiteboard: () => void;
  onNewIOC?: () => void;
  onOpenFile?: () => void;
  onImportData?: () => void;
  onToggleSidebar: () => void;
  onMobileMenuToggle: () => void;
  sidebarCollapsed?: boolean;
  onQuickSave: () => void;
  onQuickLoad: (file: File) => void;
  onStartTour?: () => void;
  screenshareMaxLevel: string | null;
  onScreenshareChange: (level: string | null) => void;
  effectiveClsLevels: string[];
  selectedFolderName?: string;
  selectedFolderColor?: string;
  presenceUsers?: PresenceUser[];
  addToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export function Header({
  onOpenSearch,
  theme,
  onToggleTheme,
  onQuickNote,
  onNewNote,
  onNewTask,
  onNewTimelineEvent,
  onNewWhiteboard,
  onNewIOC,
  onOpenFile,
  onImportData,
  onToggleSidebar,
  onMobileMenuToggle,
  onQuickSave,
  onQuickLoad,
  onStartTour,
  screenshareMaxLevel,
  onScreenshareChange,
  effectiveClsLevels,
  selectedFolderName,
  selectedFolderColor,
  presenceUsers,
  addToast,
}: HeaderProps) {
  const { t } = useTranslation('common');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  // Close help menu on outside click
  useEffect(() => {
    if (!helpMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(e.target as Node)) {
        setHelpMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [helpMenuOpen]);

  const [buildAge] = useState(() => {
    if (typeof __BUILD_TIME__ !== 'number') return '';
    const d = Math.floor((Date.now() - __BUILD_TIME__) / 86_400_000);
    return ` · ${t('header.built', { when: d === 0 ? t('header.today') : t('header.daysAgo', { count: d }) })}`;
  });
  return (
    <header data-tour="header" className={cn("h-12 sm:h-14 border-b border-gray-800 flex items-center px-2 sm:px-4 gap-2 sm:gap-3 bg-gray-900/50 backdrop-blur-sm shrink-0 relative z-20", screenshareMaxLevel && "pt-0.5")}>
      {screenshareMaxLevel && <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500" />}
      {/* Mobile: toggle mobile overlay sidebar */}
      <button
        onClick={onMobileMenuToggle}
        className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={t('header.toggleMenu')}
        title={t('header.toggleMenu')}
      >
        <Menu size={20} />
      </button>
      {/* Desktop: always-visible sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors hidden md:block"
        aria-label={t('header.toggleSidebar')}
        title={t('header.toggleSidebar')}
      >
        <Menu size={20} />
      </button>

      {typeof __STANDALONE__ !== 'undefined' && __STANDALONE__ ? (
        <div className="flex items-center gap-1.5 sm:gap-2.5 mr-1 sm:mr-2">
          <img src={logoSvg} alt="ThreatCaddy" className="w-6 h-6 sm:w-7 sm:h-7" />
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight">
              <span className="text-accent">Threat</span><span className="text-gray-200">Caddy</span>
            </span>
            <span className="text-[9px] font-medium tracking-widest uppercase text-gray-500">{t('header.localEdition')}{buildAge}</span>
          </div>
        </div>
      ) : (
        <a href="https://threatcaddy.com" className="flex items-center gap-1.5 sm:gap-2.5 mr-1 sm:mr-2 no-underline" title="threatcaddy.com">
          <img src={logoSvg} alt="ThreatCaddy" className="w-6 h-6 sm:w-7 sm:h-7" />
          <span className="text-lg font-bold tracking-tight hidden sm:inline">
            <span className="text-accent">Threat</span><span className="text-gray-200">Caddy</span>
          </span>
        </a>
      )}

      {/* Mobile investigation context badge (U6) */}
      {selectedFolderName && (
        <span
          className="md:hidden inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-text-primary bg-bg-active border border-border-subtle max-w-[120px] truncate shrink-0"
          style={selectedFolderColor ? { borderColor: selectedFolderColor + '60', backgroundColor: selectedFolderColor + '15' } : undefined}
          title={selectedFolderName}
        >
          <Briefcase size={10} className="shrink-0" />
          <span className="truncate">{selectedFolderName}</span>
        </span>
      )}

      <button
        data-tour="search"
        onClick={onOpenSearch}
        className="flex items-center gap-2 flex-1 max-w-md pl-3 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-500 hover:text-gray-400 hover:border-gray-600 text-sm transition-colors cursor-pointer"
        title={selectedFolderName ? t('header.searchInFolder', { name: selectedFolderName }) + ' (Ctrl+K)' : t('header.searchAll') + ' (Ctrl+K)'}
      >
        <Search size={16} />
        <span className="hidden sm:inline truncate">{selectedFolderName ? t('header.searchInFolderEllipsis', { name: selectedFolderName }) : t('header.searchAllEllipsis')}</span>
        <kbd className="hidden sm:inline ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-500 border border-gray-600 font-mono shrink-0">Ctrl+K</kbd>
      </button>

      {/* Help dropdown — hidden on mobile, shown on md+ (U13) */}
      <div className="hidden md:block relative" ref={helpMenuRef}>
        <button
          onClick={() => setHelpMenuOpen(!helpMenuOpen)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-xs font-medium transition-colors"
          title={t('header.helpAndLinks')}
          aria-label={t('header.helpMenu')}
          aria-expanded={helpMenuOpen}
        >
          <HelpCircle size={16} />
          <ChevronDown size={12} className={cn('transition-transform', helpMenuOpen && 'rotate-180')} />
        </button>
        {helpMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden py-1">
            {onStartTour && (
              <button
                onClick={() => { onStartTour(); setHelpMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <HelpCircle size={14} />
                {t('header.startTour')}
              </button>
            )}
            <a
              href="?demo=1"
              className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors no-underline"
              onClick={() => setHelpMenuOpen(false)}
            >
              <Search size={14} />
              {t('header.demoInvestigation')}
            </a>
            <div className="h-px bg-gray-800 mx-2 my-1" />
            <a
              href="https://github.com/peterhanily/threatcaddy"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors no-underline"
              onClick={() => setHelpMenuOpen(false)}
            >
              <Github size={14} />
              {t('header.github')}
            </a>
            {typeof __STANDALONE__ !== 'undefined' && __STANDALONE__ ? (
              <button
                onClick={async () => {
                  setHelpMenuOpen(false);
                  try {
                    const dlController = new AbortController();
                    setTimeout(() => dlController.abort(), 30_000);
                    const resp = await fetch('https://threatcaddy.com/threatcaddy-standalone.html', { signal: dlController.signal });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'threatcaddy-standalone.html';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    addToast?.('error', t('header.updateFailed'));
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <RefreshCw size={14} />
                {t('header.update')}
              </button>
            ) : (
              <a
                data-tour="standalone"
                href="./threatcaddy-standalone.html"
                download
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors no-underline"
                onClick={() => setHelpMenuOpen(false)}
              >
                <Download size={14} />
                {t('header.standalone')}
              </a>
            )}
            <a
              data-tour="extension"
              href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors no-underline"
              onClick={() => setHelpMenuOpen(false)}
            >
              <Chrome size={14} />
              {t('header.chromeExtension')}
            </a>
            <a
              href="https://threatcaddy.com/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors no-underline"
              onClick={() => setHelpMenuOpen(false)}
            >
              <Shield size={14} />
              {t('header.privacy')}
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <CreateDropdown
          onQuickNote={onQuickNote}
          onNewNote={onNewNote}
          onNewTask={onNewTask}
          onNewTimelineEvent={onNewTimelineEvent}
          onNewWhiteboard={onNewWhiteboard}
          onNewIOC={onNewIOC}
          onOpenFile={onOpenFile}
          onImportData={onImportData}
        />
        <button
          data-tour="backup"
          onClick={onQuickSave}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title={t('header.saveBackup') + ' (Ctrl+S)'}
          aria-label={t('header.saveBackup')}
        >
          <HardDriveDownload size={16} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title={t('header.loadBackup')}
          aria-label={t('header.loadBackup')}
        >
          <FolderUp size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onQuickLoad(file);
              e.target.value = '';
            }
          }}
        />
        <ScreenshareToggle
          maxLevel={screenshareMaxLevel}
          onChangeLevel={onScreenshareChange}
          effectiveLevels={effectiveClsLevels}
        />
        {presenceUsers && presenceUsers.length > 0 && (
          <PresenceIndicator users={presenceUsers} />
        )}
        <NotificationBell />
        <span data-tour="theme-toggle">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </span>
        {/* Tour and Demo moved to Help dropdown (U13) */}
      </div>
    </header>
  );
}
