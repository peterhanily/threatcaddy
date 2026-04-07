import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Initialize i18next for tests with English strings loaded synchronously.
// This means tests that use screen.getByText('Cancel') etc. continue to work
// because i18next returns the English translation inline — no JSON file I/O.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import labelsEn from '../public/locales/en/labels.json';
import datesEn from '../public/locales/en/dates.json';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'labels', 'dates'],
  defaultNS: 'common',
  resources: {
    en: {
      common: {
        appName: 'ThreatCaddy',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        confirm: 'Confirm',
        close: 'Close',
        edit: 'Edit',
        search: 'Search',
        loading: 'Loading...',
        noResults: 'No results',
        ok: 'OK',
        back: 'Back',
        next: 'Next',
        done: 'Done',
        create: 'Create',
        copy: 'Copy',
        copied: 'Copied!',
        reset: 'Reset',
        apply: 'Apply',
        remove: 'Remove',
        add: 'Add',
        yes: 'Yes',
        no: 'No',
        none: 'None',
        unknown: 'Unknown',
        untitled: 'Untitled',
        'error.generic': 'Something went wrong',
        'error.notFound': 'Not found',
      },
      labels: labelsEn,
      dates: datesEn,
    },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
});
