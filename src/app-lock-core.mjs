export const LOCK_ITERATIONS = 210000;
export const emptyLock = () => ({ version: 1, enabled: false, pin: null, gesture: null, biometric: false, failures: 0, blockedUntil: 0 });
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const bytes = text => Uint8Array.from(text.match(/../g), part => parseInt(part, 16));
export function validSecret(mode, value) {
  return typeof value === 'string' && (mode === 'pin' ? /^\d{6}$/.test(value) : mode === 'gesture' && /^[0-8]{4,9}$/.test(value) && new Set(value).size === value.length);
}
function validCredential(value) {
  return value && /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{64}$/.test(value.hash) && value.iterations === LOCK_ITERATIONS;
}
export function parseLock(raw) {
  if (raw === null || raw === undefined) return emptyLock();
  const config = JSON.parse(raw);
  if (!config || config.version !== 1 || typeof config.enabled !== 'boolean' || typeof config.biometric !== 'boolean' ||
    !Number.isInteger(config.failures) || config.failures < 0 || config.failures > 4 ||
    !Number.isSafeInteger(config.blockedUntil) || config.blockedUntil < 0 ||
    (config.pin !== null && !validCredential(config.pin)) || (config.gesture !== null && !validCredential(config.gesture)) ||
    (config.enabled && !config.pin && !config.gesture) || (config.biometric && !config.enabled)) throw new Error('应用锁配置损坏，请验证账号密码后重置');
  return config;
}
async function derive(mode, value, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全设置应用锁，请使用安卓 App 或本机预览');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${mode}:${value}`), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: LOCK_ITERATIONS }, key, 256)));
}
export async function createCredential(mode, value) {
  if (!validSecret(mode, value)) throw new Error(mode === 'pin' ? '请输入 6 位数字密码' : '请连接至少 4 个不同的点');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(mode, value, salt), iterations: LOCK_ITERATIONS };
}
export async function checkCredential(mode, value, credential) {
  if (!validSecret(mode, value) || !validCredential(credential)) return false;
  const actual = await derive(mode, value, credential.salt);
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ credential.hash.charCodeAt(index);
  return difference === 0;
}
export function failedAttempt(config, now = Date.now()) {
  const failures = config.failures + 1;
  return { ...config, failures: failures >= 5 ? 0 : failures, blockedUntil: failures >= 5 ? now + 60000 : 0 };
}
export function appendGesture(path, point) {
  if (!Number.isInteger(point) || point < 0 || point > 8 || path.includes(String(point))) return path;
  const previous = path.length ? Number(path.at(-1)) : null;
  if (previous !== null) {
    const x = previous % 3 + point % 3, y = Math.floor(previous / 3) + Math.floor(point / 3);
    if (x % 2 === 0 && y % 2 === 0) {
      const middle = y / 2 * 3 + x / 2;
      if (middle !== previous && middle !== point && !path.includes(String(middle))) path += middle;
    }
  }
  return path + point;
}
