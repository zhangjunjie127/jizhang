// Session-only: never persist medical records to browser storage.
export function createHealthDashboardCache(fetchData, now = Date.now) {
  let key, data = null, updated = 0, pending = null, generation = 0;
  const select = next => {
    if (key === next) return;
    key = next; data = null; updated = 0; pending = null; generation++;
  };
  return {
    read(next) { select(next); return data; },
    write(next, value) {
      select(next); generation++; pending = null;
      data = value; updated = now();
    },
    load(next, force = false) {
      select(next);
      if (pending) return pending;
      if (!force && data && now() - updated < 30000) return Promise.resolve(data);
      const version = generation;
      pending = fetchData().then(value => {
        if (version !== generation) return key === next ? data : null;
        data = value; updated = now();
        return value;
      }).finally(() => { if (version === generation) pending = null; });
      return pending;
    },
    clear() { key = undefined; data = null; pending = null; updated = 0; generation++; },
  };
}
