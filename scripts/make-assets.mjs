import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');
mkdirSync('public', { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" rx="108" fill="#316c57"/>
<text x="256" y="334" text-anchor="middle" font-family="Microsoft YaHei" font-weight="600" font-size="282" fill="#ffffff">在</text>
<circle cx="403" cy="112" r="18" fill="#d4b078"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile('public/app-icon.png');
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
<rect width="256" height="256" fill="#dfebe2"/>
<text x="128" y="169" text-anchor="middle" font-family="Microsoft YaHei" font-weight="400" font-size="135" fill="#537d63">在</text>
</svg>`;
await sharp(Buffer.from(avatar)).png().toFile('public/avatar.png');
if (existsSync('android/app/src/main/res')) {
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const path = `android/app/src/main/res/mipmap-${density}`;
    mkdirSync(path, { recursive: true });
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
      await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`${path}/${name}.png`);
    }
  }
}
