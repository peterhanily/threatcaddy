#!/usr/bin/env node

import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const svgPath = join(rootDir, 'assets/icon.svg');

if (!existsSync(svgPath)) {
  console.error('Error: assets/icon.svg not found');
  process.exit(1);
}

const sizes = [16, 48, 128];

console.log('Generating PNG icons from SVG...');

for (const size of sizes) {
  const outPath = join(rootDir, 'assets', `icon-${size}.png`);
  await sharp(svgPath)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  icon-${size}.png`);
}

console.log('Done!');
