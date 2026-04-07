import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

// Eagerly bundled English namespaces — always available, no network request
import commonEn from '../public/locales/en/common.json';
import labelsEn from '../public/locales/en/labels.json';
import datesEn from '../public/locales/en/dates.json';
import analysisEn from '../public/locales/en/analysis.json';

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

const bundledResources = {
  en: {
    common: commonEn,
    labels: labelsEn,
    dates: datesEn,
    analysis: analysisEn,
  },
};

i18n
  .use(initReactI18next)
  .use(HttpBackend)
  .init({
    resources: bundledResources,
    partialBundledLanguages: true,

    lng: getInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),

    // Namespaces that are always loaded (bundled above)
    ns: ['common', 'labels', 'dates', 'analysis'],
    defaultNS: 'common',

    interpolation: {
      escapeValue: false, // React already escapes JSX
    },

    returnNull: false,
    returnEmptyString: false,

    // HTTP backend config for lazy-loading additional namespaces/languages.
    // In standalone mode (file:// protocol) this will fail gracefully —
    // bundled resources above provide the English fallback.
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json',
    },

    // Log missing keys in development
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_lngs, ns, key) => {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing key: ${ns}:${key}`);
      }
    },
  });

export default i18n;
