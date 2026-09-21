export const PAGE_LABELS = { chat: '助手', tasks: '待办', ledger: '记账', health: '健康', mine: '我的' };
export const PAGE_KIND = { tasks: 'task', ledger: 'expense', health: 'weight' };
export function initialPage(value) {
  return Object.hasOwn(PAGE_LABELS, value) ? value : 'ledger';
}
export function pendingForPage(records, page) {
  return records.filter(r => r.status === 'pending' && !r.deleted_at && (!PAGE_KIND[page] || r.kind === PAGE_KIND[page] || (page === 'ledger' && r.kind === 'debt_repayment')));
}

export function requestId() {
  // getRandomValues also works in LAN HTTP browsers where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
