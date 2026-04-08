import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

// Always-bundled English namespaces — available before any HTTP request.
// encryption is here because the lock screen renders before lazy namespaces load.
import commonEn from '../public/locales/en/common.json';
import labelsEn from '../public/locales/en/labels.json';
import datesEn from '../public/locales/en/dates.json';
import analysisEn from '../public/locales/en/analysis.json';
import encryptionEn from '../public/locales/en/encryption.json';

// Remaining namespaces — only bundled in standalone builds (tree-shaken in hosted).
// In hosted mode these are lazy-loaded via HTTP backend.
import activityEn from '../public/locales/en/activity.json';
import agentEn from '../public/locales/en/agent.json';
import caddyshackEn from '../public/locales/en/caddyshack.json';
import chatEn from '../public/locales/en/chat.json';
import dashboardEn from '../public/locales/en/dashboard.json';
import execEn from '../public/locales/en/exec.json';
import graphEn from '../public/locales/en/graph.json';
import importEn from '../public/locales/en/import.json';
import integrationsEn from '../public/locales/en/integrations.json';
import investigationsEn from '../public/locales/en/investigations.json';
import notesEn from '../public/locales/en/notes.json';
import playbooksEn from '../public/locales/en/playbooks.json';
import searchEn from '../public/locales/en/search.json';
import settingsEn from '../public/locales/en/settings.json';
import tasksEn from '../public/locales/en/tasks.json';
import timelineEn from '../public/locales/en/timeline.json';
import toastEn from '../public/locales/en/toast.json';
import tourEn from '../public/locales/en/tour.json';
import trashEn from '../public/locales/en/trash.json';
import whiteboardEn from '../public/locales/en/whiteboard.json';

export interface SupportedLanguage {
  code: string;
  /** English name */
  name: string;
  /** Name as written in that language */
  nativeName: string;
  rtl?: boolean;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en',    name: 'English',              nativeName: 'English' },
  { code: 'ar',    name: 'Arabic',               nativeName: 'العربية',           rtl: true },
  { code: 'de',    name: 'German',               nativeName: 'Deutsch' },
  { code: 'es',    name: 'Spanish',              nativeName: 'Español' },
  { code: 'fa',    name: 'Persian',              nativeName: 'فارسی',             rtl: true },
  { code: 'fr',    name: 'French',               nativeName: 'Français' },
  { code: 'he',    name: 'Hebrew',               nativeName: 'עברית',             rtl: true },
  { code: 'hi',    name: 'Hindi',                nativeName: 'हिन्दी' },
  { code: 'id',    name: 'Indonesian',           nativeName: 'Bahasa Indonesia' },
  { code: 'it',    name: 'Italian',              nativeName: 'Italiano' },
  { code: 'ja',    name: 'Japanese',             nativeName: '日本語' },
  { code: 'ko',    name: 'Korean',               nativeName: '한국어' },
  { code: 'nl',    name: 'Dutch',                nativeName: 'Nederlands' },
  { code: 'pl',    name: 'Polish',               nativeName: 'Polski' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)',  nativeName: 'Português (Brasil)' },
  { code: 'ru',    name: 'Russian',              nativeName: 'Русский' },
  { code: 'th',    name: 'Thai',                 nativeName: 'ภาษาไทย' },
  { code: 'tr',    name: 'Turkish',              nativeName: 'Türkçe' },
  { code: 'uk',    name: 'Ukrainian',            nativeName: 'Українська' },
  { code: 'vi',    name: 'Vietnamese',           nativeName: 'Tiếng Việt' },
  { code: 'zh-CN', name: 'Simplified Chinese',  nativeName: '简体中文' },
];

export const RTL_LANGS = new Set(['ar', 'he', 'fa']);

function getInitialLanguage(): string {
  try {
    const raw = localStorage.getItem('threatcaddy-settings');
    if (raw) {
      const s = JSON.parse(raw) as Record<string, unknown>;
      if (typeof s.language === 'string' && s.language) return s.language;
    }
  } catch { /* ignore */ }
  return 'en';
}

// In standalone (single-file) builds, bundle ALL English namespaces so that
// no HTTP requests are made — file:// protocol can't serve them.
// Rollup tree-shakes the unused imports in the hosted build.
const isStandalone = typeof __STANDALONE__ !== 'undefined' && __STANDALONE__;

const ALL_NS = [
  'common', 'labels', 'dates', 'analysis', 'encryption',
  'activity', 'agent', 'caddyshack', 'chat', 'dashboard',
  'exec', 'graph', 'import', 'integrations', 'investigations',
  'notes', 'playbooks', 'search', 'settings', 'tasks',
  'timeline', 'toast', 'tour', 'trash', 'whiteboard',
] as const;

const HOSTED_NS = ['common', 'labels', 'dates', 'analysis', 'encryption'] as const;

const enResources = isStandalone ? {
  common: commonEn, labels: labelsEn, dates: datesEn, analysis: analysisEn,
  encryption: encryptionEn, activity: activityEn, agent: agentEn,
  caddyshack: caddyshackEn, chat: chatEn, dashboard: dashboardEn,
  exec: execEn, graph: graphEn, import: importEn, integrations: integrationsEn,
  investigations: investigationsEn, notes: notesEn, playbooks: playbooksEn,
  search: searchEn, settings: settingsEn, tasks: tasksEn, timeline: timelineEn,
  toast: toastEn, tour: tourEn, trash: trashEn, whiteboard: whiteboardEn,
} : {
  common: commonEn, labels: labelsEn, dates: datesEn,
  analysis: analysisEn, encryption: encryptionEn,
};

// Cast needed: enResources is a conditional union type that TS can't narrow to ResourceLanguage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bundledResources: Record<string, any> = { en: enResources };

// Register plugins — skip HttpBackend in standalone (no HTTP requests needed or possible)
i18n.use(initReactI18next);
if (!isStandalone) i18n.use(HttpBackend);

i18n.init({
  resources: bundledResources,
  partialBundledLanguages: true,

  lng: getInitialLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),

  ns: isStandalone ? [...ALL_NS] : [...HOSTED_NS],
  defaultNS: 'common',

  interpolation: {
    escapeValue: false, // React already escapes JSX
  },

  returnNull: false,
  returnEmptyString: false,

  // HTTP backend for lazy-loading namespaces and non-English languages.
  // Not used in standalone builds.
  ...(!isStandalone && {
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json',
    },
  }),

  // Log missing keys in development
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_lngs: readonly string[], ns: string, key: string) => {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] Missing key: ${ns}:${key}`);
    }
  },
});

export default i18n;
