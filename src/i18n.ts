import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

// Eagerly bundled English namespaces — always available, no network request
import commonEn from '../public/locales/en/common.json';
import labelsEn from '../public/locales/en/labels.json';
import datesEn from '../public/locales/en/dates.json';

const bundledResources = {
  en: {
    common: commonEn,
    labels: labelsEn,
    dates: datesEn,
  },
};

i18n
  .use(initReactI18next)
  .use(HttpBackend)
  .init({
    resources: bundledResources,
    partialBundledLanguages: true,

    lng: 'en',
    fallbackLng: 'en',

    // Namespaces that are always loaded (bundled above)
    ns: ['common', 'labels', 'dates'],
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
