import type { ViewMode } from '../../types';

export interface TourStep {
  id: string;
  target: string; // CSS selector
  /** English text, used when the `tour` locale has no `steps.<id>.title` / `.description`. */
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
    description: 'Your browser-based threat investigation workspace — private and offline by default.',
    placement: 'bottom',
    view: 'notes',
  },
  {
    id: 'dashboard',
    target: '[data-tour="dashboard"]',
    title: 'Dashboard',
    description: 'Customizable quick-link tiles for VirusTotal, Shodan, MITRE ATT&CK, and more.',
    placement: 'right',
    view: 'dashboard',
  },
  {
    id: 'search-create',
    target: '[data-tour="search"]',
    title: 'Search & Create',
    description: 'Ctrl+K to search everything. Use "+ New" to create notes, tasks, events, or import data.',
    placement: 'bottom',
    view: 'notes',
  },
  {
    id: 'investigations',
    target: '[data-tour="tags-folders"]',
    title: 'Investigations',
    description: 'Organize work into color-coded investigations with status tracking and TLP/PAP classification.',
    placement: 'right',
    view: 'notes',
  },
  {
    id: 'notes-editor',
    target: '[data-tour="notes-editor"]',
    title: 'Notes',
    description: 'Markdown editor with live preview, slash commands, and [[wiki-links]] between notes.',
    placement: 'bottom',
    view: 'notes',
  },
  {
    id: 'tasks-timeline',
    target: '[data-tour="tasks"]',
    title: 'Tasks & Timeline',
    description: 'Kanban board for tasks and incident timelines with MITRE ATT&CK mappings and geo-maps.',
    placement: 'right',
  },
  {
    id: 'evidence',
    target: '[data-tour="evidence"]',
    title: 'Evidence',
    description: 'Import source files such as documents, spreadsheets and exports. Review what was extracted and turn table rows into IOCs.',
    placement: 'right',
  },
  {
    id: 'identities',
    target: '[data-tour="identities"]',
    title: 'Identities',
    description: 'The people, organizations, systems and accounts in a case. Private details stay masked and are never sent to AI.',
    placement: 'right',
  },
  {
    id: 'products',
    target: '[data-tour="products"]',
    title: 'Products',
    description: 'Compose the report from the case: pick a template, stage the notes, events and IOCs it needs, and export it.',
    placement: 'right',
  },
  {
    id: 'graph-iocs',
    target: '[data-tour="graph-canvas"]',
    title: 'Graph & IOCs',
    description: 'Interactive entity graph for IOCs, notes, and events. See aggregate IOC stats in the IOCs view.',
    placement: 'bottom',
    view: 'graph',
  },
  {
    id: 'chat',
    target: '[data-tour="chat"]',
    title: 'CaddyAI',
    description: 'AI-powered investigation assistant — search notes, extract IOCs, create entities, and analyze threats.',
    placement: 'right',
  },
  {
    id: 'finish',
    target: '[data-tour="header"]',
    title: "You're All Set",
    description: 'Press Ctrl+K anytime to search, or revisit this tour from the header. Happy investigating!',
    placement: 'bottom',
  },
];
