import { registerPlugin } from '@capacitor/core';
import { isNative } from './api';
import { parseLock } from './app-lock-core.mjs';

export const NativeAppLock = registerPlugin('AppLock');
export function lockStorage(userId) {
  const key = `zaizai-app-lock-${userId}`;
  return {
    async read() {
      return parseLock(isNative ? (await NativeAppLock.read({ userId })).data ?? null : localStorage.getItem(key));
    },
    async write(value) {
      const data = JSON.stringify(value);
      parseLock(data);
      if (isNative) await NativeAppLock.write({ userId, data });
      else localStorage.setItem(key, data);
    },
  };
}
