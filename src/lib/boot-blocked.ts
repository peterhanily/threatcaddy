/** The inline boot guard (build/boot-guard.ts) turns the rest of the page into
 * hidden text when it is framed or a standalone copy is served over HTTP(S).
 * If a browser runs this bundle regardless, end it here, before any module
 * reads storage. */
if (document.documentElement.hasAttribute('data-boot-blocked')) {
  throw new Error('ThreatCaddy did not start: it is framed, or this offline copy is not opened from a file.');
}

export {};
