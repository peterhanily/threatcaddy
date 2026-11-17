import { db } from '../db';
import { extractIOCs } from './ioc-extractor';
import { buildGraphData } from './graph-data';
import { postMessageOrigin } from './utils';
import i18n from '../i18n';

export async function executeAnalyzeGraph(input: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) {
    return JSON.stringify({ error: 'No investigation selected.' });
  }

  const [notes, tasks, events] = await Promise.all([
    db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray(),
    db.tasks.where('folderId').equals(folderId).and(t => !t.trashed).toArray(),
    db.timelineEvents.where('folderId').equals(folderId).and(e => !e.trashed).toArray(),
  ]);

  const graph = buildGraphData(notes, tasks, events);

  // Compute degree for each node
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }

  // Top connected nodes
  const topNodes = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, deg]) => {
      const node = graph.nodes.find(n => n.id === id);
      return { id, label: node?.label || id, type: node?.type, connections: deg };
    });

  // Node type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const node of graph.nodes) {
    typeBreakdown[node.type] = (typeBreakdown[node.type] || 0) + 1;
  }

  // Edge type breakdown
  const edgeBreakdown: Record<string, number> = {};
  for (const edge of graph.edges) {
    edgeBreakdown[edge.type] = (edgeBreakdown[edge.type] || 0) + 1;
  }

  // Isolated nodes (no connections)
  const isolated = graph.nodes.filter(n => (degree.get(n.id) || 0) === 0).length;

  // BFS shortest path if requested
  let path: { found: boolean; path?: string[]; length?: number } | undefined;
  if (input.pathFrom && input.pathTo) {
    const from = String(input.pathFrom);
    const to = String(input.pathTo);
    path = bfsPath(graph, from, to);
  }

  return JSON.stringify({
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByType: typeBreakdown,
    edgesByType: edgeBreakdown,
    isolatedNodes: isolated,
    topConnected: topNodes,
    ...(path ? { shortestPath: path } : {}),
  });
}

function bfsPath(graph: { nodes: { id: string; label: string }[]; edges: { source: string; target: string }[] }, from: string, to: string) {
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push(edge.target); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    adj.get(edge.target)!.push(edge.source); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  const visited = new Set<string>();
  const queue: { node: string; path: string[] }[] = [{ node: from, path: [from] }];
  visited.add(from);

  while (queue.length > 0) {
    const current = queue.shift()!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (current.node === to) {
      const labels = current.path.map(id => {
        const n = graph.nodes.find(node => node.id === id);
        return n ? `${n.label} (${id})` : id;
      });
      return { found: true, path: labels, length: current.path.length - 1 };
    }
    for (const neighbor of adj.get(current.node) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...current.path, neighbor] });
      }
    }
  }
  return { found: false };
}

export function executeExtractIOCs(input: Record<string, unknown>): string {
  const text = String(input.text || '');
  if (!text) return JSON.stringify({ error: 'text is required' });

  const iocs = extractIOCs(text);
  const grouped: Record<string, string[]> = {};
  for (const ioc of iocs) {
    if (!grouped[ioc.type]) grouped[ioc.type] = [];
    grouped[ioc.type].push(ioc.value);
  }

  return JSON.stringify({ totalFound: iocs.length, byType: grouped });
}

const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];

/** Mirrors the extension's publicFetchURL (extension/src/background.js). The href bound is checked separately. */
export function isPublicFetchURL(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host.includes('.') && !host.includes(':') && !/^[\d.]+$/.test(host)
    && !PRIVATE_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

/** Extensions older than 1.1.3 follow redirects and have no host filter. Read at call time:
 *  the bridge deletes the attribute while it refreshes app approval. */
function hasGuardedBridgeFetch(): boolean {
  const caps = document.documentElement.dataset.tcBridgeCaps?.split(',') ?? [];
  return caps.includes('clip_import_ack_v2') || caps.includes('fetch_url_public_v1');
}

/** `/fetch` shows this text to the analyst, so it is translated. Hosted builds load the namespace lazily. */
async function fetchRefusal(key: 'fetch.privateTarget' | 'fetch.tooLong' | 'fetch.updateExtension' | 'fetch.bridgeTimeout'): Promise<{ success: false; error: string }> {
  await i18n.loadNamespaces('integrations');
  return { success: false, error: i18n.t(key, { ns: 'integrations' }) };
}

export function fetchViaExtensionBridge(url: string): Promise<{ success: boolean; title?: string; content?: string; error?: string }> {
  if (!isPublicFetchURL(url)) return fetchRefusal('fetch.privateTarget');
  if (new URL(url).href.length > 2048) return fetchRefusal('fetch.tooLong');
  if (!hasGuardedBridgeFetch()) return fetchRefusal('fetch.updateExtension');
  const requestId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(fetchRefusal('fetch.bridgeTimeout'));
    }, 20000);

    function handler(event: MessageEvent) {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== 'TC_FETCH_URL_RESULT') return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      resolve({
        success: !!event.data.success,
        title: event.data.title,
        content: event.data.content,
        error: event.data.error,
      });
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_FETCH_URL', requestId, url }, postMessageOrigin());
  });
}

export async function executeFetchUrl(input: Record<string, unknown>): Promise<string> {
  const url = String(input.url || '');
  if (!url) return JSON.stringify({ error: 'url is required' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return JSON.stringify({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return JSON.stringify({ error: 'Only http and https URLs are supported' });
  }

  // Use extension bridge — background SW bypasses CORS
  const result = await fetchViaExtensionBridge(url);
  if (result.success) {
    // Cap content to ~12KB to keep context window manageable for the LLM
    let content = result.content || '';
    if (content.length > 12000) {
      content = content.substring(0, 12000) + '\n\n...(truncated to fit context window)';
    }
    return JSON.stringify({ title: result.title || '', content, url });
  }
  return JSON.stringify({ error: result.error || 'Failed to fetch URL' });
}
