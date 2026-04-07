import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Import the app's actual i18n instance so that all modules (including i18n-labels.ts
// which imports src/i18n.ts directly) share the same initialized instance.
// The src/i18n.ts init is synchronous for bundled namespaces, so by the time tests
// run, all English strings are available. We add the feature namespaces here so
// components using useTranslation('settings') etc. also resolve correctly.
import i18n from './i18n';
import settingsEn from '../public/locales/en/settings.json';
import analysisEn from '../public/locales/en/analysis.json';
import timelineEn from '../public/locales/en/timeline.json';
import notesEn from '../public/locales/en/notes.json';
import tasksEn from '../public/locales/en/tasks.json';
import chatEn from '../public/locales/en/chat.json';

// Add feature namespaces to the already-initialized i18n instance
i18n.addResourceBundle('en', 'settings', settingsEn);
i18n.addResourceBundle('en', 'analysis', analysisEn);
i18n.addResourceBundle('en', 'timeline', timelineEn);
i18n.addResourceBundle('en', 'notes', notesEn);
i18n.addResourceBundle('en', 'tasks', tasksEn);
i18n.addResourceBundle('en', 'chat', chatEn);
