/** Excalidraw renders an 'iframe' element's customData.generationData.html
 * (or its error message) as an allow-scripts srcdoc frame. ThreatCaddy never
 * creates these elements, so any that arrive in a shared, synced, imported,
 * pasted or dropped scene are dropped before they can render. A URL
 * 'embeddable' frames third-party sites (YouTube, X, Reddit and others) with
 * no click, and the X and Reddit widgets run with the app's origin. The editor
 * frames none, and each one becomes an ordinary rectangle that keeps its link,
 * which the analyst can open deliberately. */
export function isScriptableEmbed(element: unknown): boolean {
  return typeof element === 'object' && element !== null && (element as { type?: unknown }).type === 'iframe';
}

function isWebEmbed(element: unknown): boolean {
  return typeof element === 'object' && element !== null && (element as { type?: unknown }).type === 'embeddable';
}

export function hasEmbeds(elements: readonly unknown[]): boolean {
  return elements.some(element => isScriptableEmbed(element) || isWebEmbed(element));
}

export function withoutEmbeds<T>(elements: readonly T[]): T[] {
  return elements.filter(element => !isScriptableEmbed(element))
    .map(element => isWebEmbed(element) ? { ...element, type: 'rectangle' } : element);
}
