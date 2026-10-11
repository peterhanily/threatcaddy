#!/usr/bin/env node
/**
 * ThreatCaddy i18n Translation Script
 *
 * Generates locale files for all supported languages using the Anthropic API.
 * Resumable: skips existing files; --sync fills missing recursive leaves only.
 *
 * Usage:
 *   node scripts/translate-i18n.mjs [options]
 *
 * Options:
 *   --lang <code>   Only translate this language (e.g. --lang de)
 *   --ns <name>     Only translate this namespace (e.g. --ns common), or 'extension'
 *   --sync          Translate only missing leaves, preserving existing values
 *   --dry-run       Print what would be done without calling the API
 *
 * Requires:
 *   ANTHROPIC_API_KEY environment variable
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { catalogLeaves, chunkCatalog, extensionLocaleCode, extensionMessages, mergeMissingTranslations, missingTranslations, validateTranslationBatch } from './lib/locale-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Language list ──────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'ar',    name: 'Arabic',               nativeName: 'العربية',            rtl: true },
  { code: 'de',    name: 'German',               nativeName: 'Deutsch' },
  { code: 'es',    name: 'Spanish',              nativeName: 'Español' },
  { code: 'fa',    name: 'Persian',              nativeName: 'فارسی',              rtl: true },
  { code: 'fr',    name: 'French',               nativeName: 'Français' },
  { code: 'he',    name: 'Hebrew',               nativeName: 'עברית',              rtl: true },
  { code: 'hi',    name: 'Hindi',                nativeName: 'हिन्दी' },
  { code: 'id',    name: 'Indonesian',           nativeName: 'Bahasa Indonesia' },
  { code: 'it',    name: 'Italian',              nativeName: 'Italiano' },
  { code: 'ja',    name: 'Japanese',             nativeName: '日本語' },
  { code: 'ko',    name: 'Korean',               nativeName: '한국어' },
  { code: 'nl',    name: 'Dutch',                nativeName: 'Nederlands' },
  { code: 'pl',    name: 'Polish',               nativeName: 'Polski' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)',  nativeName: 'Português (Brasil)' },
  { code: 'ru',    name: 'Russian',              nativeName: 'Русский' },
  { code: 'th',    name: 'Thai',                 nativeName: 'ภาษาไทย' },
  { code: 'tr',    name: 'Turkish',              nativeName: 'Türkçe' },
  { code: 'uk',    name: 'Ukrainian',            nativeName: 'Українська' },
  { code: 'vi',    name: 'Vietnamese',           nativeName: 'Tiếng Việt' },
  { code: 'zh-CN', name: 'Simplified Chinese',  nativeName: '简体中文' },
];

const NAMESPACES = [
  'activity', 'agent', 'analysis', 'caddyshack', 'chat', 'common',
  'dashboard', 'dates', 'encryption', 'evidence', 'exec', 'graph', 'import',
  'integrations', 'investigations', 'labels', 'notes', 'playbooks', 'products',
  'search', 'settings', 'tasks', 'timeline', 'toast', 'tour', 'trash', 'whiteboard',
];

// Proper nouns that must NOT be translated
const PRESERVE_NOUNS = [
  'ThreatCaddy', 'CaddyAI', 'AgentCaddy', 'CaddyShack', 'ForensiCate',
  'IOC', 'IOCs', 'MITRE ATT&CK', 'YARA', 'Sigma', 'CVE', 'STIX', 'TAXII',
  'VirusTotal', 'Shodan', 'AbuseIPDB', 'URLhaus', 'AlienVault OTX', 'MISP',
  'IPv4', 'IPv6', 'SHA256', 'SHA1', 'MD5',
  'IndexedDB', 'GitHub', 'Markdown', 'Excalidraw',
].join(', ');

// ── Chunking ───────────────────────────────────────────────────────────────

// Split a flat JSON object into chunks of ~MAX_BYTES each.
// (Avoids hitting output token limits on large namespaces like settings.)
const MAX_BYTES_PER_CHUNK = 8000;

// ── API call ───────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    signal: AbortSignal.timeout(60_000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Translation API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Strip markdown code fences if present
  let jsonStr = text;
  if (text.startsWith('```')) {
    jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}

function buildSystemPrompt(langName, rtl) {
  return `You are a professional translator for ThreatCaddy, a threat intelligence and incident response platform used by cybersecurity analysts worldwide.

Translate the JSON values from English to ${langName}. Rules:
1. Return ONLY a valid JSON object with identical keys to the input.
2. Preserve i18next interpolation syntax exactly: {{variable}} stays as {{variable}}.
3. Do NOT translate these proper nouns: ${PRESERVE_NOUNS}.
4. Use technical cybersecurity terminology appropriate for ${langName}-speaking security professionals.
5. Keep translations concise — they appear in UI buttons, labels, and short descriptions.
${rtl ? '6. Ensure text flows naturally for right-to-left reading.' : ''}
7. If a term genuinely has no good translation, keep the English term.
8. Return ONLY the JSON object — no markdown, no explanation, no code fences.`;
}

// ── Translate a SPA namespace ──────────────────────────────────────────────

async function translateNamespace(content, lang, namespace) {
  const system = buildSystemPrompt(lang.name, lang.rtl);
  const chunks = chunkCatalog(content, MAX_BYTES_PER_CHUNK);
  let results = {};

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : '';
    process.stdout.write(`    chunk${chunkLabel}... `);

    const translated = await callClaude(
      system,
      `Translate this i18next namespace (${namespace})${chunkLabel} to ${lang.name}:\n\n${JSON.stringify(chunks[i], null, 2)}`,
    );

    validateTranslationBatch(chunks[i], translated, { namespace });
    results = mergeMissingTranslations(chunks[i], results, translated, { namespace });
    process.stdout.write('✓\n');

    if (i < chunks.length - 1) await sleep(300);
  }
  const leaves = new Map(catalogLeaves(results).map(leaf => [leaf.key, leaf.value]));
  const unchanged = catalogLeaves(content).filter(leaf => leaf.value && leaves.get(leaf.key) === leaf.value).length;
  if (unchanged) console.log(`    Review required: ${unchanged} values equal the English source (possibly proper nouns).`);
  return results;
}

// ── Translate extension messages.json ─────────────────────────────────────

async function translateExtensionMessages(content, lang) {
  const system = buildSystemPrompt(lang.name, lang.rtl) + '\nPreserve every WebExtension $PLACEHOLDER$ and $1 substitution exactly.';
  const messages = extensionMessages(content);
  let translated = {};
  for (const chunk of chunkCatalog(messages, MAX_BYTES_PER_CHUNK)) {
    const result = await callClaude(system, `Translate these browser extension UI strings to ${lang.name}:\n\n${JSON.stringify(chunk, null, 2)}`);
    translated = mergeMissingTranslations(chunk, translated, result, { extension: true });
  }
  validateTranslationBatch(messages, translated, { extension: true });

  // Reconstruct WebExtension format, preserving description fields
  const result = {};
  for (const [key, val] of Object.entries(content)) {
    result[key] = { ...val, message: translated[key] };
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function percent(done, total) {
  return `${Math.round((done / total) * 100)}%`;
}

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const langFilter = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;
const nsFilter   = args.includes('--ns')   ? args[args.indexOf('--ns')   + 1] : null;
const dryRun     = args.includes('--dry-run');
// --sync: only translate keys missing from existing files, preserving existing translations
const syncMode   = args.includes('--sync');

if (args.includes('--force')) {
  console.error('Refusing to overwrite existing translations. Use --sync to add missing leaves; review existing translations manually.');
  process.exit(1);
}
if ((args.includes('--ns') && !nsFilter) || (nsFilter && nsFilter !== 'extension' && !NAMESPACES.includes(nsFilter))) {
  console.error('Unknown namespace. Use a supported app namespace or extension.');
  process.exit(1);
}
if (args.includes('--lang') && !langFilter) {
  console.error('--lang requires a supported language code.');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY && !dryRun) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

const langs = langFilter
  ? LANGUAGES.filter(l => l.code === langFilter)
  : LANGUAGES;

if (langFilter && langs.length === 0) {
  console.error(`Unknown language code: ${langFilter}`);
  console.error(`Valid codes: ${LANGUAGES.map(l => l.code).join(', ')}`);
  process.exit(1);
}

let processed = 0, skipped = 0, errors = 0;

const modeLabel = dryRun ? 'DRY RUN' : syncMode ? 'sync (missing leaves only)' : 'resume (skip existing)';
console.log(`\nThreatCaddy i18n Translator`);
console.log(`Languages : ${langs.length} (${langs.map(l => l.code).join(', ')})`);
console.log(`Namespaces: ${nsFilter ?? 'all (' + NAMESPACES.length + ')'} + extension`);
console.log(`Mode      : ${modeLabel}`);
console.log('─'.repeat(60));

for (const lang of langs) {
  console.log(`\n▶  ${lang.nativeName}  (${lang.code})`);

  const localeDir = join(ROOT, 'public', 'locales', lang.code);
  if (!dryRun) mkdirSync(localeDir, { recursive: true });

  const nsList = nsFilter === 'extension' ? [] : nsFilter ? [nsFilter] : NAMESPACES;

  for (const ns of nsList) {
    const outPath = join(localeDir, `${ns}.json`);
    const enContent = JSON.parse(
      readFileSync(join(ROOT, 'public', 'locales', 'en', `${ns}.json`), 'utf8'),
    );

    if (syncMode) {
      // Only translate keys missing from the existing file
      const existing = existsSync(outPath)
        ? JSON.parse(readFileSync(outPath, 'utf8'))
        : {};
      const toTranslate = missingTranslations(enContent, existing);
      const missingKeys = catalogLeaves(toTranslate);

      if (missingKeys.length === 0) {
        process.stdout.write(`  ✓ ${ns} (up to date)\n`);
        skipped++;
        continue;
      }

      if (dryRun) {
        process.stdout.write(`  ~ ${ns} (+${missingKeys.length} keys would be added)\n`);
        continue;
      }

      try {
        process.stdout.write(`  → ${ns} (+${missingKeys.length} new keys)\n`);
        const translated = await translateNamespace(toTranslate, lang, ns);
        const merged = mergeMissingTranslations(enContent, existing, translated, { namespace: ns });
        writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
        processed++;
        await sleep(250);
      } catch (err) {
        console.error(`  ✗ ${ns}: ${err.message}`);
        errors++;
      }
      continue;
    }

    if (existsSync(outPath)) {
      process.stdout.write(`  ✓ ${ns} (exists)\n`);
      skipped++;
      continue;
    }

    if (dryRun) {
      process.stdout.write(`  ~ ${ns} (would translate)\n`);
      continue;
    }

    try {
      process.stdout.write(`  → ${ns}\n`);
      const translated = await translateNamespace(enContent, lang, ns);
      writeFileSync(outPath, JSON.stringify(translated, null, 2) + '\n', 'utf8');
      processed++;
      await sleep(250);
    } catch (err) {
      console.error(`  ✗ ${ns}: ${err.message}`);
      errors++;
    }
  }

  // Extension messages
  if (!nsFilter || nsFilter === 'extension') {
    const extOutPath = join(ROOT, 'extension', 'src', '_locales', extensionLocaleCode(lang.code), 'messages.json');
    const enMessages = JSON.parse(
      readFileSync(join(ROOT, 'extension', 'src', '_locales', 'en', 'messages.json'), 'utf8'),
    );

    if (syncMode) {
      const existing = existsSync(extOutPath)
        ? JSON.parse(readFileSync(extOutPath, 'utf8'))
        : {};
      const missingKeys = Object.keys(enMessages).filter(k => !Object.hasOwn(existing, k));

      if (missingKeys.length === 0) {
        process.stdout.write(`  ✓ extension/messages (up to date)\n`);
        skipped++;
      } else if (dryRun) {
        process.stdout.write(`  ~ extension/messages (+${missingKeys.length} keys)\n`);
      } else {
        try {
          process.stdout.write(`  → extension/messages (+${missingKeys.length} new keys)\n`);
          mkdirSync(dirname(extOutPath), { recursive: true });
          const toTranslate = Object.fromEntries(missingKeys.map(k => [k, enMessages[k]]));
          const translated = await translateExtensionMessages(toTranslate, lang);
          const merged = { ...existing, ...translated };
          writeFileSync(extOutPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
          process.stdout.write(`    chunk... ✓\n`);
          processed++;
          await sleep(250);
        } catch (err) {
          console.error(`  ✗ extension/messages: ${err.message}`);
          errors++;
        }
      }
    } else if (existsSync(extOutPath)) {
      process.stdout.write(`  ✓ extension/messages (exists)\n`);
      skipped++;
    } else if (dryRun) {
      process.stdout.write(`  ~ extension/messages (would translate)\n`);
    } else {
      try {
        process.stdout.write(`  → extension/messages\n`);
        mkdirSync(dirname(extOutPath), { recursive: true });
        const translated = await translateExtensionMessages(enMessages, lang);
        writeFileSync(extOutPath, JSON.stringify(translated, null, 2) + '\n', 'utf8');
        process.stdout.write(`    chunk... ✓\n`);
        processed++;
        await sleep(250);
      } catch (err) {
        console.error(`  ✗ extension/messages: ${err.message}`);
        errors++;
      }
    }
  }
}

console.log('\n' + '─'.repeat(60));
console.log(`Done: ${processed} translated, ${skipped} skipped, ${errors} errors`);
if (processed) console.log('Generated text is not a fluency certification. Run the offline locale checker and obtain fluent human review before release.');
if (errors > 0) {
  console.log('Re-run with --sync --lang <code> --ns <name> to retry missing translations.');
  process.exitCode = 1;
}
