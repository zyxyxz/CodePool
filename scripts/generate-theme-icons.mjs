import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { TEAM_COLORS, getTheme } = require('../apps/miniapp/utils/theme.js');
const directory = path.resolve('apps/miniapp/assets/icons');

// Retain the existing icon shapes and anti-aliasing; only recolor their pixels.
async function recolor(source, color, destination) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    data[pixel] = rgb[0]; data[pixel + 1] = rgb[1]; data[pixel + 2] = rgb[2];
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(destination);
}

for (const name of ['home', 'team', 'logs', 'profile']) {
  const selectedSource = await sharp(path.join(directory, `${name}-active.png`)).toBuffer();
  for (const color of TEAM_COLORS) {
    const theme = getTheme(color);
    const destination = path.join(directory, 'themes', theme.key);
    await mkdir(destination, { recursive: true });
    await recolor(selectedSource, theme.accent, path.join(destination, `${name}-active.png`));
  }
  await recolor(selectedSource, getTheme().accent, path.join(directory, `${name}-active.png`));
  const neutralSource = await sharp(path.join(directory, `${name}.png`)).toBuffer();
  await recolor(neutralSource, getTheme().muted, path.join(directory, `${name}.png`));
}
console.log('Generated six theme icon sets and neutral navigation icons.');
