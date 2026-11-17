/** Render agent-authored soul text as low-trust data. Word-level blocklists are
 * trivially bypassed, so the defence is length, control-character stripping and
 * the data-not-instructions fencing where it is shown. */
export const sanitizeSoulText = (s: string, max = 150) => {
  if (typeof s !== 'string') return '';
  return s
    // eslint-disable-next-line no-control-regex -- intentional: strip control chars from agent-authored text
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    // Neutralize prompt-injection conjuring words so a soul entry can't be
    // written to look like system instructions on re-read. Keeps meaning
    // intact while blunting imperative tone.
    .replace(/\b(ignore|disregard|override|system|assistant|user|instruction|forget)\b/gi, '·')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
};
