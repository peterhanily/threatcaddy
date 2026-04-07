import type { LucideIcon } from 'lucide-react';
import {
  Heading1, Heading2, Heading3, Bold, Italic, Strikethrough, Code, Link, Link2,
  List, ListOrdered, ListChecks, Quote, FileCode, Minus, Table,
  Shield, Target, Lock, Clock, Calendar, CalendarClock, MessageSquare,
} from 'lucide-react';
import i18n from '../../i18n';

const t = (key: string) => i18n.t(key, { ns: 'notes' });

export interface SlashCommand {
  id: string;
  /** i18n key for the label (resolved at render time via `label` getter or `getLabel()`) */
  labelKey: string;
  /** i18n key for the description */
  descriptionKey: string;
  /** Resolved label — call at render time so language switches take effect */
  get label(): string;
  /** Resolved description */
  get description(): string;
  category: 'Formatting' | 'Blocks' | 'Threat Intel' | 'Insert';
  icon: LucideIcon;
  keywords: string[];
  insert: string;
  cursorOffset?: number;
}

interface SlashCommandDef {
  id: string;
  labelKey: string;
  descriptionKey: string;
  category: 'Formatting' | 'Blocks' | 'Threat Intel' | 'Insert';
  icon: LucideIcon;
  keywords: string[];
  insert: string;
  cursorOffset?: number;
}

function makeCommand(def: SlashCommandDef): SlashCommand {
  return {
    ...def,
    get label() { return t(def.labelKey); },
    get description() { return t(def.descriptionKey); },
  };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Formatting
  makeCommand({ id: 'h1', labelKey: 'slashCommands.heading1', descriptionKey: 'slashCommands.heading1Desc', category: 'Formatting', icon: Heading1, keywords: ['title', 'header'], insert: '# ' }),
  makeCommand({ id: 'h2', labelKey: 'slashCommands.heading2', descriptionKey: 'slashCommands.heading2Desc', category: 'Formatting', icon: Heading2, keywords: ['subtitle', 'header'], insert: '## ' }),
  makeCommand({ id: 'h3', labelKey: 'slashCommands.heading3', descriptionKey: 'slashCommands.heading3Desc', category: 'Formatting', icon: Heading3, keywords: ['header'], insert: '### ' }),
  makeCommand({ id: 'bold', labelKey: 'slashCommands.bold', descriptionKey: 'slashCommands.boldDesc', category: 'Formatting', icon: Bold, keywords: ['strong'], insert: '**text**', cursorOffset: -2 }),
  makeCommand({ id: 'italic', labelKey: 'slashCommands.italic', descriptionKey: 'slashCommands.italicDesc', category: 'Formatting', icon: Italic, keywords: ['emphasis', 'em'], insert: '_text_', cursorOffset: -1 }),
  makeCommand({ id: 'strikethrough', labelKey: 'slashCommands.strikethrough', descriptionKey: 'slashCommands.strikethroughDesc', category: 'Formatting', icon: Strikethrough, keywords: ['strike', 'del'], insert: '~~text~~', cursorOffset: -2 }),
  makeCommand({ id: 'code-inline', labelKey: 'slashCommands.code', descriptionKey: 'slashCommands.codeDesc', category: 'Formatting', icon: Code, keywords: ['mono', 'inline'], insert: '`code`', cursorOffset: -1 }),
  makeCommand({ id: 'link', labelKey: 'slashCommands.link', descriptionKey: 'slashCommands.linkDesc', category: 'Formatting', icon: Link, keywords: ['url', 'href', 'anchor'], insert: '[text](url)', cursorOffset: -6 }),
  makeCommand({ id: 'tclink', labelKey: 'slashCommands.tcLink', descriptionKey: 'slashCommands.tcLinkDesc', category: 'Formatting', icon: Link2, keywords: ['internal', 'note', 'wikilink', 'backlink', 'threatcaddy', 'tclink'], insert: '[[]]', cursorOffset: -2 }),

  // Blocks
  makeCommand({ id: 'bullet', labelKey: 'slashCommands.bulletList', descriptionKey: 'slashCommands.bulletListDesc', category: 'Blocks', icon: List, keywords: ['ul', 'unordered'], insert: '- ' }),
  makeCommand({ id: 'numbered', labelKey: 'slashCommands.numberedList', descriptionKey: 'slashCommands.numberedListDesc', category: 'Blocks', icon: ListOrdered, keywords: ['ol', 'ordered'], insert: '1. ' }),
  makeCommand({ id: 'task', labelKey: 'slashCommands.taskList', descriptionKey: 'slashCommands.taskListDesc', category: 'Blocks', icon: ListChecks, keywords: ['checkbox', 'todo'], insert: '- [ ] ' }),
  makeCommand({ id: 'quote', labelKey: 'slashCommands.blockquote', descriptionKey: 'slashCommands.blockquoteDesc', category: 'Blocks', icon: Quote, keywords: ['blockquote', 'citation'], insert: '> ' }),
  makeCommand({ id: 'code-block', labelKey: 'slashCommands.codeBlock', descriptionKey: 'slashCommands.codeBlockDesc', category: 'Blocks', icon: FileCode, keywords: ['fence', 'pre'], insert: '```\n\n```', cursorOffset: -4 }),
  makeCommand({ id: 'hr', labelKey: 'slashCommands.horizontalRule', descriptionKey: 'slashCommands.horizontalRuleDesc', category: 'Blocks', icon: Minus, keywords: ['divider', 'separator'], insert: '---\n' }),
  makeCommand({ id: 'table', labelKey: 'slashCommands.table', descriptionKey: 'slashCommands.tableDesc', category: 'Blocks', icon: Table, keywords: ['grid', 'columns'], insert: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |\n', cursorOffset: -7 }),

  // Threat Intel
  makeCommand({ id: 'ioc-table', labelKey: 'slashCommands.iocTable', descriptionKey: 'slashCommands.iocTableDesc', category: 'Threat Intel', icon: Shield, keywords: ['indicator', 'compromise', 'ioc'], insert: '| Type | Value | Context |\n| --- | --- | --- |\n| | | |\n', cursorOffset: -7 }),
  makeCommand({ id: 'mitre', labelKey: 'slashCommands.mitreReference', descriptionKey: 'slashCommands.mitreReferenceDesc', category: 'Threat Intel', icon: Target, keywords: ['attack', 'technique', 'tactic'], insert: '**MITRE ATT&CK:** T____', cursorOffset: -4 }),
  makeCommand({ id: 'tlp', labelKey: 'slashCommands.tlpHeader', descriptionKey: 'slashCommands.tlpHeaderDesc', category: 'Threat Intel', icon: Lock, keywords: ['traffic', 'classification', 'amber', 'red', 'green'], insert: '**TLP:AMBER**' }),
  makeCommand({ id: 'timeline-entry', labelKey: 'slashCommands.timelineEntry', descriptionKey: 'slashCommands.timelineEntryDesc', category: 'Threat Intel', icon: Clock, keywords: ['event', 'timestamp', 'incident'], insert: '**[YYYY-MM-DD HH:MM UTC]** — ' }),

  // Insert
  makeCommand({ id: 'date', labelKey: 'slashCommands.currentDate', descriptionKey: 'slashCommands.currentDateDesc', category: 'Insert', icon: Calendar, keywords: ['today', 'now'], insert: '__DATE__' }),
  makeCommand({ id: 'datetime', labelKey: 'slashCommands.currentDatetime', descriptionKey: 'slashCommands.currentDatetimeDesc', category: 'Insert', icon: CalendarClock, keywords: ['now', 'timestamp'], insert: '__DATETIME__' }),
  makeCommand({ id: 'callout', labelKey: 'slashCommands.callout', descriptionKey: 'slashCommands.calloutDesc', category: 'Insert', icon: MessageSquare, keywords: ['admonition', 'warning', 'info', 'note'], insert: '> **Note:** ' }),
];

/** Compute pixel coordinates of a caret position inside a textarea using the mirror-div technique. */
export function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const div = document.createElement('div');
  const style = window.getComputedStyle(textarea);

  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
    'wordSpacing', 'textIndent', 'lineHeight', 'padding', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'borderWidth', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'width', 'wordWrap', 'overflowWrap',
    'whiteSpace', 'tabSize',
  ] as const;

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.overflow = 'hidden';
  div.style.height = 'auto';

  for (const prop of props) {
    (div.style as unknown as Record<string, string>)[prop] = style.getPropertyValue(
      prop.replace(/([A-Z])/g, '-$1').toLowerCase()
    );
  }

  const text = textarea.value.substring(0, position);
  div.textContent = text;

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);

  const top = span.offsetTop - textarea.scrollTop;
  const left = span.offsetLeft;

  document.body.removeChild(div);

  return { top, left };
}
