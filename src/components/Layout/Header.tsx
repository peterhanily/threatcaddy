import { Menu, Search, Github, Download, Chrome, HardDriveDownload, FolderUp, HelpCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { ThemeToggle } from '../Common/ThemeToggle';
import { ScreenshareToggle } from '../Common/ScreenshareToggle';
import { CreateDropdown } from '../Common/CreateDropdown';
import { cn } from '../../lib/utils';
import logoSvgRaw from '/logo.svg?raw';
const logoSvg = `data:image/svg+xml,${encodeURIComponent(logoSvgRaw)}`;

interface HeaderProps {
  onOpenSearch: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onNewNote: () => void;
  onNewTask: () => void;
  onNewTimelineEvent: () => void;
  onNewWhiteboard: () => void;
  onNewIOC?: () => void;
  onToggleSidebar: () => void;
  onMobileMenuToggle: () => void;
  sidebarCollapsed: boolean;
  onQuickSave: () => void;
  onQuickLoad: (file: File) => void;
  onStartTour?: () => void;
  screenshareMaxLevel: string | null;
  onScreenshareChange: (level: string | null) => void;
  effectiveClsLevels: string[];
  selectedFolderName?: string;
}

export function Header({
  onOpenSearch,
  theme,
  onToggleTheme,
  onNewNote,
  onNewTask,
  onNewTimelineEvent,
  onNewWhiteboard,
  onNewIOC,
  onToggleSidebar,
  onMobileMenuToggle,
  sidebarCollapsed,
  onQuickSave,
  onQuickLoad,
  onStartTour,
  screenshareMaxLevel,
  onScreenshareChange,
  effectiveClsLevels,
  selectedFolderName,
}: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [buildAge] = useState(() => {
    if (typeof __BUILD_TIME__ !== 'number') return '';
    const d = Math.floor((Date.now() - __BUILD_TIME__) / 86_400_000);
    return ` · Built ${d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`}`;
  });
  return (
    <header data-tour="header" className={cn("h-12 sm:h-14 border-b border-gray-800 flex items-center px-2 sm:px-4 gap-2 sm:gap-3 bg-gray-900/50 backdrop-blur-sm shrink-0 relative", screenshareMaxLevel && "pt-0.5")}>
      {screenshareMaxLevel && <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500" />}
      {/* Mobile menu button - always visible on mobile */}
      <button
        onClick={onMobileMenuToggle}
        className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors md:hidden"
        aria-label="Toggle menu"
        title="Toggle menu"
      >
        <Menu size={20} />
      </button>
      {/* Desktop sidebar toggle - visible when sidebar is collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors hidden md:block"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      {typeof __STANDALONE__ !== 'undefined' && __STANDALONE__ ? (
        <div className="flex items-center gap-1.5 sm:gap-2.5 mr-1 sm:mr-2">
          <img src={logoSvg} alt="ThreatCaddy" className="w-6 h-6 sm:w-7 sm:h-7" />
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight">
              <span className="text-accent">Threat</span><span className="text-gray-200">Caddy</span>
            </span>
            <span className="text-[9px] font-medium tracking-widest uppercase text-gray-500">Local Edition{buildAge}</span>
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

      <button
        data-tour="search"
        onClick={onOpenSearch}
        className="flex items-center gap-2 flex-1 max-w-md pl-3 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-500 hover:text-gray-400 hover:border-gray-600 text-sm transition-colors cursor-pointer"
        title={selectedFolderName ? `Search in ${selectedFolderName} (Ctrl+K)` : 'Search all (Ctrl+K)'}
      >
        <Search size={16} />
        <span className="hidden sm:inline truncate">{selectedFolderName ? `Search in ${selectedFolderName}...` : 'Search all...'}</span>
        <kbd className="hidden sm:inline ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-500 border border-gray-600 font-mono shrink-0">Ctrl+K</kbd>
      </button>

      {/* Links — hidden on mobile, shown on md+ */}
      <div className="hidden md:flex items-center gap-1">
        <a
          href="https://github.com/peterhanily/threatcaddy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-xs font-medium transition-colors"
          title="View on GitHub"
        >
          <Github size={15} />
          <span className="hidden lg:inline">GitHub</span>
        </a>
        <a
          data-tour="standalone"
          href="./threatcaddy-standalone.html"
          download
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-xs font-medium transition-colors"
          title="Download standalone HTML"
        >
          <Download size={15} />
          <span className="hidden lg:inline">Standalone</span>
        </a>
        <a
          data-tour="extension"
          href="https://github.com/peterhanily/threatcaddy/tree/main/extension#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-xs font-medium transition-colors"
          title="Get Chrome Extension"
        >
          <Chrome size={15} />
          <span className="hidden lg:inline">Extension</span>
        </a>
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <CreateDropdown
          onNewNote={onNewNote}
          onNewTask={onNewTask}
          onNewTimelineEvent={onNewTimelineEvent}
          onNewWhiteboard={onNewWhiteboard}
          onNewIOC={onNewIOC}
        />
        <button
          data-tour="backup"
          onClick={onQuickSave}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Save Backup (Ctrl+S)"
          aria-label="Save backup"
        >
          <HardDriveDownload size={16} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Load Backup"
          aria-label="Load backup"
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
        <span data-tour="theme-toggle">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </span>
        <a
          href="?demo=1"
          className="px-2 py-1 rounded-lg text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-accent hover:text-accent-hover hover:bg-gray-800 transition-colors"
          title="Load sample investigation demo"
        >
          Demo
        </a>
        {onStartTour && (
          <button
            onClick={onStartTour}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title="Start tour"
            aria-label="Start tour"
          >
            <HelpCircle size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
