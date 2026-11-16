/** Excalidraw renders an 'iframe' element's customData.generationData.html
 * (or its error message) as an allow-scripts srcdoc frame. ThreatCaddy never
 * creates these elements, so any that arrive in a shared, synced, imported,
 * pasted or dropped scene are dropped before they can render. URL-based
 * 'embeddable' elements are kept: Excalidraw only frames allowlisted hosts. */
export function isScriptableEmbed(element: unknown): boolean {
  return typeof element === 'object' && element !== null && (element as { type?: unknown }).type === 'iframe';
}

export function withoutScriptableEmbeds<T>(elements: readonly T[]): T[] {
  return elements.filter(element => !isScriptableEmbed(element));
}
