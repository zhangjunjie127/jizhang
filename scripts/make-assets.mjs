import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');
mkdirSync('public', { recursive: true });
const svg = readFileSync('public/app-icon-source.svg');
await sharp(svg).png().toFile('public/app-icon.png');
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
<rect width="256" height="256" fill="#dfebe2"/>
<text x="128" y="169" text-anchor="middle" font-family="Microsoft YaHei" font-weight="400" font-size="135" fill="#537d63">在</text>
</svg>`;
await sharp(Buffer.from(avatar)).png().toFile('public/avatar.png');
if (existsSync('android/app/src/main/res')) {
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const path = `android/app/src/main/res/mipmap-${density}`;
    mkdirSync(path, { recursive: true });
    await sharp(svg).resize(size, size).png().toFile(`${path}/ic_launcher.png`);
    const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
    await sharp(svg).resize(size, size).composite([{ input: circle, blend: 'dest-in' }]).png().toFile(`${path}/ic_launcher_round.png`);
    const foregroundSize = Math.round(size * 108 / 48);
    await sharp(svg).resize(foregroundSize, foregroundSize).png().toFile(`${path}/ic_launcher_foreground.png`);
  }
}
