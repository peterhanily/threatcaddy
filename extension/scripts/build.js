#!/usr/bin/env node

import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const browser = (process.env.BROWSER || 'chrome').toLowerCase();
if (browser !== 'chrome' && browser !== 'firefox') {
  console.error(`Unknown BROWSER="${browser}". Use "chrome" or "firefox".`);
  process.exit(1);
}

const outdir = join(rootDir, 'dist', browser);

console.log(`Building ThreatCaddy extension for ${browser}...`);

// Create output directories
mkdirSync(join(outdir, 'assets'), { recursive: true });

// Copy manifest (use browser-specific manifest for Firefox)
const manifestSrc = browser === 'firefox'
  ? join(rootDir, 'src/manifest.firefox.json')
  : join(rootDir, 'src/manifest.json');
copyFileSync(manifestSrc, join(outdir, 'manifest.json'));

// Copy popup files
copyFileSync(
  join(rootDir, 'src/popup.html'),
  join(outdir, 'popup.html')
);
copyFileSync(
  join(rootDir, 'src/popup.js'),
  join(outdir, 'popup.js')
);

// Copy background script
copyFileSync(
  join(rootDir, 'src/background.js'),
  join(outdir, 'background.js')
);

// Copy content script
copyFileSync(
  join(rootDir, 'src/content.js'),
  join(outdir, 'content.js')
);

// Copy bridge script (LLM proxy content script)
copyFileSync(
  join(rootDir, 'src/bridge.js'),
  join(outdir, 'bridge.js')
);

// Copy pages
mkdirSync(join(outdir, 'pages'), { recursive: true });
copyFileSync(
  join(rootDir, 'src/pages/clips.html'),
  join(outdir, 'pages/clips.html')
);
copyFileSync(
  join(rootDir, 'src/pages/clips.js'),
  join(outdir, 'pages/clips.js')
);

// Copy icon files
console.log('Copying icons...');
const iconSizes = [16, 48, 128];
iconSizes.forEach(size => {
  const iconFile = `icon-${size}.png`;
  const sourcePath = join(rootDir, 'assets', iconFile);
  const destPath = join(outdir, 'assets', iconFile);

  if (existsSync(sourcePath)) {
    copyFileSync(sourcePath, destPath);
  } else {
    console.warn(`  Warning: ${iconFile} not found. Run 'npm run generate:icons' first.`);
  }
});

// Copy SVG icon
const svgSource = join(rootDir, 'assets/icon.svg');
if (existsSync(svgSource)) {
  copyFileSync(svgSource, join(outdir, 'assets/icon.svg'));
}

console.log(`\nExtension built successfully for ${browser}!`);
console.log(`Output: ${outdir}`);

if (browser === 'chrome') {
  console.log('\nTo load in Chrome:');
  console.log('1. Go to chrome://extensions');
  console.log('2. Enable "Developer mode"');
  console.log(`3. Click "Load unpacked"`);
  console.log(`4. Select: ${outdir}`);
} else {
  console.log('\nTo load in Firefox:');
  console.log('1. Go to about:debugging#/runtime/this-firefox');
  console.log('2. Click "Load Temporary Add-on..."');
  console.log(`3. Select: ${join(outdir, 'manifest.json')}`);
}
