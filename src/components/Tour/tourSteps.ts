import type { ViewMode } from '../../types';

export interface TourStep {
  id: string;
  target: string; // CSS selector
  title: string;
  description: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** View that should be active when this step is shown. */
  view?: ViewMode;
}

export const tourSteps: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="header"]',
    title: 'Welcome to ThreatCaddy',
    description: 'Your private threat investigation workspace for notes, IOCs, timelines, and graphs. Everything stays in your browser — nothing is sent to a server.',
    placement: 'bottom',
    view: 'notes',
  },
  {
    id: 'sidebar',
    target: '[data-tour="sidebar-nav"]',
    title: 'Sidebar Navigation',
    description: 'Switch between Notes, Tasks, Timeline, Graph, IOC Stats, and Whiteboards. Manage investigations and tags to keep things organized.',
    placement: 'right',
    view: 'notes',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Search Everything',
    description: 'Press Ctrl+K to search across all your notes, tasks, timeline events, and whiteboards instantly.',
    placement: 'bottom',
  },
  {
    id: 'new-note',
    target: '[data-tour="new-note"]',
    title: 'Quick Capture',
    description: 'Click here or press Ctrl+N to quickly capture a new note. Supports Markdown with live preview.',
    placement: 'bottom',
  },
  {
    id: 'tags-folders',
    target: '[data-tour="tags-folders"]',
    title: 'Tags & Investigations',
    description: 'Organize your work with investigations and color-coded tags. Investigations support status tracking (active/closed/archived) and TLP/PAP classification. Double-click to rename, hover for actions.',
    placement: 'right',
  },
  {
    id: 'tasks',
    target: '[data-tour="tasks"]',
    title: 'Task Management',
    description: 'Track tasks with priorities, due dates, and a Kanban board. Drag and drop between columns in board view.',
    placement: 'right',
  },
  {
    id: 'timeline',
    target: '[data-tour="timeline"]',
    title: 'Timeline',
    description: 'Build incident timelines with typed events, MITRE ATT&CK mappings, and IOC linking. Visualize with the Gantt chart.',
    placement: 'right',
  },
  {
    id: 'graph',
    target: '[data-tour="graph-canvas"]',
    title: 'Entity Graph',
    description: 'Visualize IOCs, notes, tasks, and timeline events as an interactive graph. Filter by node and edge types, search nodes, and choose layouts.',
    placement: 'bottom',
    view: 'graph',
  },
  {
    id: 'graph-link',
    target: '[data-tour="graph-link-hint"]',
    title: 'Drag-to-Link',
    description: 'Hold Alt and drag from one node to another to create IOC relationships or entity links directly on the graph canvas.',
    placement: 'top',
    view: 'graph',
  },
  {
    id: 'ioc-stats',
    target: '[data-tour="ioc-stats-header"]',
    title: 'IOC Statistics',
    description: 'See aggregate IOC intelligence across your entire database — type and confidence distribution, top actors, IOC timeline, frequency tables, and source breakdown.',
    placement: 'bottom',
    view: 'ioc-stats',
  },
  {
    id: 'whiteboards',
    target: '[data-tour="whiteboards"]',
    title: 'Whiteboards',
    description: 'Sketch diagrams and visualize ideas with the built-in whiteboard powered by Excalidraw. Fully offline.',
    placement: 'right',
    view: 'notes',
  },
  {
    id: 'activity',
    target: '[data-tour="activity"]',
    title: 'Activity Log',
    description: 'Track every action in your workspace — note edits, task updates, IOC pushes, and more. Filter by category and search the audit trail.',
    placement: 'right',
    view: 'notes',
  },
  {
    id: 'investigation-detail',
    target: '[data-tour="tags-folders"]',
    title: 'Investigation Details',
    description: 'Click the info icon on any investigation to edit its description, set status (active/closed/archived), assign TLP/PAP classification, manage tags, and link a dedicated timeline. Export an entire investigation as JSON.',
    placement: 'right',
    view: 'notes',
  },
  {
    id: 'screenshare-cls',
    target: '[data-tour="screenshare"]',
    title: 'Screenshare & Classification',
    description: 'Assign TLP/PAP classification levels to investigations, notes, tasks, and events. Enable screenshare mode to hide items above a chosen classification level during presentations.',
    placement: 'bottom',
  },
  {
    id: 'backup',
    target: '[data-tour="backup"]',
    title: 'Backup & Restore',
    description: 'Save your entire workspace as a JSON backup, or load a previous backup. Your data is always under your control.',
    placement: 'bottom',
    view: 'notes',
  },
  {
    id: 'shortcuts',
    target: '[data-tour="theme-toggle"]',
    title: 'Theme & Shortcuts',
    description: 'Toggle between dark and light mode. Key shortcuts: Ctrl+K (search), Ctrl+N (new note), Ctrl+S (backup), Ctrl+1-4 (switch views).',
    placement: 'bottom',
  },
  {
    id: 'standalone',
    target: '[data-tour="standalone"]',
    title: 'Standalone HTML',
    description: 'Download ThreatCaddy as a single HTML file. Run it from your desktop — no server, no internet needed.',
    placement: 'bottom',
  },
  {
    id: 'extension',
    target: '[data-tour="extension"]',
    title: 'Browser Extension',
    description: 'Clip web pages, text selections, and links directly into ThreatCaddy with the Chrome extension.',
    placement: 'bottom',
  },
];
