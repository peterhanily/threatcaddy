import { Plus, Menu, ListChecks } from 'lucide-react';
import { SearchBar } from '../Common/SearchBar';
import { ThemeToggle } from '../Common/ThemeToggle';

interface HeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchFocusRequested: boolean;
  onSearchFocusHandled: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onNewNote: () => void;
  onNewTask: () => void;
  onToggleSidebar: () => void;
  onMobileMenuToggle: () => void;
  sidebarCollapsed: boolean;
}

export function Header({
  search,
  onSearchChange,
  searchFocusRequested,
  onSearchFocusHandled,
  theme,
  onToggleTheme,
  onNewNote,
  onNewTask,
  onToggleSidebar,
  onMobileMenuToggle,
  sidebarCollapsed,
}: HeaderProps) {
  return (
    <header className="h-14 border-b border-gray-800 flex items-center px-4 gap-3 bg-gray-900/50 backdrop-blur-sm shrink-0">
      {/* Mobile menu button - always visible on mobile */}
      <button
        onClick={onMobileMenuToggle}
        className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors md:hidden"
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>
      {/* Desktop sidebar toggle - visible when sidebar is collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors hidden md:block"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      <div className="flex items-center gap-2.5 mr-2">
        <img src="./logo.svg" alt="BrowserNotes" className="w-7 h-7" />
        <span className="text-lg font-bold tracking-tight hidden sm:inline">
          <span className="text-accent">Browser</span><span className="text-gray-200">Notes</span>
        </span>
      </div>

      <SearchBar
        value={search}
        onChange={onSearchChange}
        focusRequested={searchFocusRequested}
        onFocusHandled={onSearchFocusHandled}
      />

      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={onNewNote}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          title="New Note (Ctrl+N)"
          aria-label="New note"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Note</span>
        </button>
        <button
          onClick={onNewTask}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition-colors"
          title="New Task (Ctrl+Shift+T)"
          aria-label="New task"
        >
          <ListChecks size={16} />
          <span className="hidden sm:inline">Task</span>
        </button>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
