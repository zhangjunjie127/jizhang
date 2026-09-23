import { readFileSync, writeFileSync } from 'node:fs';

// Preserve compressed frames and transparency; only change GIF loop metadata.
const durations = {};
for (let index = 1; index <= 3; index++) {
  const name = `assistant-${String(index).padStart(2, '0')}`;
  const path = new URL(`../public/assistant-gifs/${name}.gif`, import.meta.url);
  const data = readFileSync(path);
  let cursor = 13 + ((data[10] & 128) ? 3 * (2 ** ((data[10] & 7) + 1)) : 0);
  let duration = 0;
  const parts = [data.subarray(0, cursor)];
  const skipBlocks = () => {
    while (data[cursor]) cursor += data[cursor] + 1;
    cursor++;
  };
  while (cursor < data.length) {
    const start = cursor;
    const marker = data[cursor++];
    if (marker === 0x3b) {
      parts.push(data.subarray(start, cursor));
      break;
    }
    if (marker === 0x21) {
      const label = data[cursor++];
      if (label === 0xf9) duration += data.readUInt16LE(cursor + 2) * 10;
      const application = label === 0xff ? data.toString('ascii', cursor + 1, cursor + 12) : '';
      skipBlocks();
      if (application === 'NETSCAPE2.0' || application === 'ANIMEXTS1.0') continue;
    } else if (marker === 0x2c) {
      const packed = data[cursor + 8];
      cursor += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
      cursor++;
      skipBlocks();
    } else {
      throw new Error(`Unexpected GIF block ${marker} in ${name}`);
    }
    parts.push(data.subarray(start, cursor));
  }
  if (!duration) throw new Error(`Missing animation duration: ${name}`);
  const once = Buffer.concat(parts);
  // NETSCAPE repeat count 1 means one repeat after the initial playback.
  const repeat = Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 1, 0, 0]);
  writeFileSync(new URL(`../public/assistant-gifs/${name}-once.gif`, import.meta.url), once);
  writeFileSync(new URL(`../public/assistant-gifs/${name}-twice.gif`, import.meta.url),
    Buffer.concat([parts[0], repeat, ...parts.slice(1)]));
  durations[`/assistant-gifs/${name}.gif`] = duration;
}
writeFileSync(new URL('../src/assistant-animation-durations.json', import.meta.url), `${JSON.stringify(durations, null, 2)}\n`);
console.log(durations);
