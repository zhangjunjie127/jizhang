export const MAX_LEDGER_CENTS = 9_999_999_999;
export const MAX_LEDGER_AMOUNT = MAX_LEDGER_CENTS / 100;

export function exactMoney(cents) {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function moneyLabels(cents, prefix = '') {
  const full = `${prefix}${exactMoney(cents)}`;
  const absolute = Math.abs(cents);
  const unit = absolute >= 10_000_000_000 ? [10_000_000_000, '亿']
    : absolute >= 1_000_000_000 ? [1_000_000_000, '千万']
    : absolute >= 100_000_000 ? [100_000_000, '百万']
    : absolute >= 1_000_000 ? [1_000_000, '万'] : null;
  return unit ? [full, `${prefix}${(cents / unit[0]).toFixed(2)}${unit[1]}`] : [full];
}
