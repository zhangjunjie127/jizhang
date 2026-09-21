import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { attachKeySounds } from './key-sound.mjs';

export const DEFAULT_PREFERENCES = { defaultDirection: 'ask', calendarScope: 'month', hideTotals: false, quickEdit: true, theme: 'blue', haptics: false, keySound: true };
const Context = createContext({ preferences: DEFAULT_PREFERENCES, update: () => {} });
export const usePreferences = () => useContext(Context);
export function PreferencesProvider({ userId, children }) {
  const key = `zaizai-preferences-${userId}`;
  const [revision, setRevision] = useState(0);
  const preferences = useMemo(() => {
    let stored;
    try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch { stored = {}; }
    const result = { ...DEFAULT_PREFERENCES };
    for (const name of ['hideTotals', 'quickEdit', 'haptics', 'keySound']) if (typeof stored?.[name] === 'boolean') result[name] = stored[name];
    for (const [name, values] of Object.entries({ defaultDirection: ['ask', 'expense', 'income'], calendarScope: ['month', 'today'], theme: ['blue', 'green', 'rose'] })) {
      if (values.includes(stored?.[name])) result[name] = stored[name];
    }
    return result;
  }, [key, revision]);
  function update(changes) {
    localStorage.setItem(key, JSON.stringify({ ...preferences, ...changes }));
    setRevision(value => value + 1);
  }
  useEffect(() => {
    if (!preferences.keySound) return;
    return attachKeySounds(document, window.AudioContext || window.webkitAudioContext);
  }, [preferences.keySound, userId]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [preferences.theme]);
  useEffect(() => {
    if (!preferences.haptics || !navigator.vibrate) return;
    const tap = event => { if (event.target.closest('button:not(:disabled),input[type="checkbox"]')) navigator.vibrate(10); };
    document.addEventListener('click', tap);
    return () => document.removeEventListener('click', tap);
  }, [preferences.haptics]);
  return <Context.Provider value={{ preferences, update }}>{children}</Context.Provider>;
}
