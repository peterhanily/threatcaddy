import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Import the app's actual i18n instance so all modules share the same instance.
import i18n from './i18n';

// Add all feature namespaces for test coverage
import settingsEn from '../public/locales/en/settings.json';
import analysisEn from '../public/locales/en/analysis.json';
import timelineEn from '../public/locales/en/timeline.json';
import notesEn from '../public/locales/en/notes.json';
import tasksEn from '../public/locales/en/tasks.json';
import chatEn from '../public/locales/en/chat.json';
import graphEn from '../public/locales/en/graph.json';
import agentEn from '../public/locales/en/agent.json';
import integrationsEn from '../public/locales/en/integrations.json';
import encryptionEn from '../public/locales/en/encryption.json';
import execEn from '../public/locales/en/exec.json';
import caddyshackEn from '../public/locales/en/caddyshack.json';
import dashboardEn from '../public/locales/en/dashboard.json';
import searchEn from '../public/locales/en/search.json';
import activityEn from '../public/locales/en/activity.json';
import whiteboardEn from '../public/locales/en/whiteboard.json';
import tourEn from '../public/locales/en/tour.json';
import playbooksEn from '../public/locales/en/playbooks.json';
import importEn from '../public/locales/en/import.json';
import trashEn from '../public/locales/en/trash.json';
import investigationsEn from '../public/locales/en/investigations.json';
import toastEn from '../public/locales/en/toast.json';

const namespaces: Record<string, Record<string, unknown>> = {
  settings: settingsEn, analysis: analysisEn, timeline: timelineEn,
  notes: notesEn, tasks: tasksEn, chat: chatEn, graph: graphEn,
  agent: agentEn, integrations: integrationsEn, encryption: encryptionEn,
  exec: execEn, caddyshack: caddyshackEn, dashboard: dashboardEn,
  search: searchEn, activity: activityEn, whiteboard: whiteboardEn,
  tour: tourEn, playbooks: playbooksEn, import: importEn, trash: trashEn,
  investigations: investigationsEn, toast: toastEn,
};

for (const [ns, data] of Object.entries(namespaces)) {
  i18n.addResourceBundle('en', ns, data);
}
