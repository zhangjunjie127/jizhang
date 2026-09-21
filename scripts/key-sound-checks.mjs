import assert from 'node:assert/strict';

export async function checkKeySounds(page) {
  await page.evaluate(() => {
    window.__keySoundProbe = { count: 0, peak: 0 };
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      window.__keySoundProbe.count++;
      return createOscillator.call(this);
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      const connect = gain.connect.bind(gain);
      gain.connect = destination => {
        const analyser = this.createAnalyser();
        analyser.fftSize = 2048;
        connect(analyser); analyser.connect(destination);
        const buffer = new Float32Array(2048);
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buffer);
          window.__keySoundProbe.peak = Math.max(window.__keySoundProbe.peak, ...buffer.map(Math.abs));
        }, 5);
        setTimeout(() => { clearInterval(timer); analyser.disconnect(); }, 150);
        return destination;
      };
      return gain;
    };
  });
  await page.getByRole('button', { name: '声音与触感', exact: true }).click();
  const sound = page.getByRole('checkbox', { name: '按键音', exact: true });
  assert.equal(await sound.isChecked(), true);
  await page.waitForFunction(() => window.__keySoundProbe.peak > 0);
  const peak = await page.evaluate(() => window.__keySoundProbe.peak);
  assert.ok(peak < .025, 'Tone uses a low gain envelope');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/key-sound-390.png' });
  await sound.uncheck();
  const muted = await page.evaluate(() => window.__keySoundProbe.count);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '声音与触感', exact: true }).click();
  assert.equal(await sound.isChecked(), false);
  assert.equal(await page.evaluate(() => window.__keySoundProbe.count), muted);
  await sound.check();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '账号设置', exact: true }).click();
  await page.getByRole('button', { name: /^昵称/ }).click();
  const keyboard = page.getByRole('region', { name: '文字键盘', exact: true });
  await keyboard.waitFor();
  const beforeKey = await page.evaluate(() => window.__keySoundProbe.count);
  await keyboard.getByRole('button', { name: 'q', exact: true }).click();
  await page.waitForFunction(count => window.__keySoundProbe.count > count, beforeKey);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}
