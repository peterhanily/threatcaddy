/** Non-English locale JSON is runtime-cached by the hosted service worker.
 * Its cache name carries a hash of the shipped translations, so a deploy that
 * changes any translation starts from an empty cache instead of serving the
 * previous release's strings. */
export const LOCALE_CACHE_PREFIX = 'i18n-locales';

/** Delete locale caches written under any other build's name. */
export async function purgeStaleLocaleCaches(current: string, storage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (!storage) return;
  const names = await storage.keys();
  await Promise.all(names
    .filter(name => name.startsWith(LOCALE_CACHE_PREFIX) && name !== current)
    .map(name => storage.delete(name)));
}
