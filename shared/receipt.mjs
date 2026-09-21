function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
export function receiptCents(value, signed = false) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!(signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(text)) invalid('金额需填写数字，最多两位小数');
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 100000000) invalid('金额超出范围');
  return cents;
}
const textField = (value, max, label, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid(`请核对${label}`);
  return value.trim();
};
export function validateReceipt(receipt, totalCents) {
  if (!receipt || typeof receipt !== 'object' || !Array.isArray(receipt.items) || receipt.items.length < 1 || receipt.items.length > 100) invalid('小票需包含 1–100 项商品');
  if (receipt.currency !== 'CNY') invalid('目前仅支持人民币小票');
  const items = receipt.items.map((item, index) => {
    if (!item || typeof item !== 'object') invalid('商品格式无效');
    const quantity = Number(item.quantity);
    if (!/^\d+(\.\d{1,3})?$/.test(String(item.quantity)) || quantity <= 0 || quantity > 100000) invalid(`请核对第 ${index + 1} 项数量`);
    const cents = receiptCents(item.amount);
    return {
      name: textField(item.name, 120, `第 ${index + 1} 项商品名称`),
      category: textField(item.category, 30, `第 ${index + 1} 项品类`),
      quantity, unit: textField(item.unit ?? '', 10, '商品单位', false),
      amount: cents / 100, cents,
    };
  });
  const adjustmentCents = receiptCents(receipt.adjustmentAmount, true);
  const adjustmentLabel = textField(receipt.adjustmentLabel ?? '', 60, '优惠或补差说明', adjustmentCents !== 0);
  if (items.reduce((sum, item) => sum + item.cents, 0) + adjustmentCents !== totalCents) invalid('商品合计加优惠或补差与实付金额不一致，请先核对');
  const result = {
    currency: 'CNY', merchant: textField(receipt.merchant ?? '', 80, '商户名称', false),
    items, adjustmentAmount: adjustmentCents / 100, adjustmentCents, adjustmentLabel,
  };
  if (receipt.imageHash !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(receipt.imageHash)) invalid('小票图片标识无效');
    result.imageHash = receipt.imageHash;
  }
  return result;
}
