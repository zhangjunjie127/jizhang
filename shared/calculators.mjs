export function numberValue(value, label, { min = 0, max = 1e12, integer = false } = {}) {
  const text = String(value ?? '').trim();
  if (text === '') throw new Error(`请填写${label}`);
  if (typeof value !== 'number' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`${label}请输入十进制数字`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label}超出范围或格式不正确`);
  return n;
}
const rounded = n => {
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER / 100) throw new Error('计算结果过大，请缩小输入范围');
  // Shift the decimal exponent before rounding to avoid 10.075 * 100 losing a cent.
  const [coefficient, exponent = '0'] = n.toString().split('e');
  return Math.round(Number(`${coefficient}e${Number(exponent) + 2}`)) / 100;
};
const monthlyPayment = (principal, rate, months) => rate === 0 ? principal / months
  : principal * rate / -Math.expm1(-months * Math.log1p(rate));

function maturityDate(value, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('请选择放款日期');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('放款日期不正确');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function calculateTool(id, fields, rows = []) {
  const num = (key, label, options) => numberValue(fields[key], label, options);
  const result = (label, value, detail, unit = '元') => ({ label, value: rounded(value), unit, detail });
  if (id === 'discount') {
    const price = num('price', '原价'), discount = num('discount', '折扣', { max: 10 });
    const reduction = fields.reduction === '' || fields.reduction == null ? 0 : num('reduction', '优惠金额');
    const final = Math.max(0, price * discount / 10 - reduction);
    return result('实付金额', final, `原价 ${price} × ${discount} ÷ 10 − 优惠 ${reduction}；共节省 ${rounded(price - final)} 元`);
  }
  if (id === 'split') {
    const total = num('total', '总费用'), people = num('people', '人数', { min: 1, max: 100000, integer: true });
    const cents = Math.round(rounded(total) * 100), each = Math.floor(cents / people), extra = cents % people;
    return result('每人基础金额', each / 100, extra ? `${extra} 人各付 ${(each + 1) / 100} 元，其余 ${people - extra} 人各付 ${each / 100} 元；合计 ${(cents / 100).toFixed(2)} 元` : `${people} 人各付 ${(each / 100).toFixed(2)} 元`);
  }
  if (id === 'salary') {
    const salary = num('salary', '税前月薪');
    const optional = (key, label) => String(fields[key] ?? '').trim() === '' ? 0 : num(key, label);
    const social = optional('social', '个人社保'), fund = optional('fund', '个人公积金');
    const special = optional('special', '专项附加扣除');
    if (social + fund > salary) throw new Error('个人社保与公积金合计不能超过税前月薪');
    // PRC resident comprehensive-income brackets; annual allowance is CNY 60,000.
    // Individual Income Tax Law, comprehensive-income rate table.
    const taxable = Math.max(0, rounded((salary - social - fund - special) * 12 - 60000));
    const brackets = [[36000, 0.03, 0], [144000, 0.1, 2520], [300000, 0.2, 16920],
      [420000, 0.25, 31920], [660000, 0.3, 52920], [960000, 0.35, 85920], [Infinity, 0.45, 181920]];
    const [, rate, deduction] = brackets.find(([limit]) => taxable <= limit);
    const annualTax = rounded(taxable * rate - deduction), annualNet = rounded((salary - social - fund) * 12 - annualTax);
    return result('月均到手（估算）', annualNet / 12,
      `税前月薪 ${salary.toFixed(2)} 元\n个人社保 ${social.toFixed(2)} 元/月\n个人公积金 ${fund.toFixed(2)} 元/月\n专项附加扣除 ${special.toFixed(2)} 元/月（仅抵税）\n全年应纳税所得额 ${taxable.toFixed(2)} 元\n适用税率 ${rate * 100}%，速算扣除数 ${deduction} 元\n全年个税 ${annualTax.toFixed(2)} 元\n月均个税 ${rounded(annualTax / 12).toFixed(2)} 元\n全年到手 ${annualNet.toFixed(2)} 元\n按全年仅有固定工资估算，实际以税务申报及工资单为准。`);
  }
  if (id === 'compare') {
    if (!rows.length) throw new Error('请至少添加一项');
    const values = rows.map((row, i) => {
      const price = numberValue(row.price, `第 ${i + 1} 项价格`);
      const quantity = numberValue(row.quantity, `第 ${i + 1} 项数量`, { min: 0.000001 });
      return { name: row.name.trim() || `第 ${i + 1} 项`, price, quantity, value: price / quantity };
    });
    if (rows.length < 2) throw new Error('请至少添加两项进行比价');
    const best = Math.min(...values.map(row => row.value));
    return { label: '最低单价', value: Number(best.toPrecision(8)), unit: '元 / 单位',
      detail: values.map(row => `${row.name}：${Number(row.value.toPrecision(8))} 元 / 单位${row.value === best ? '（最低）' : ''}`).join('\n') };
  }
  if (id === 'interest') {
    const principal = num('principal', '本金'), rate = num('rate', '年利率', { max: 100 });
    const days = num('days', '天数', { integer: true, max: 36500 });
    const basis = Number(fields.basis);
    if (![360, 365].includes(basis)) throw new Error('请选择计息基准');
    const interest = principal * rate / 100 * days / basis;
    return result('利息', interest, `单利：${principal} × ${rate}% × ${days} ÷ ${basis}\n本息合计 ${rounded(principal + interest).toFixed(2)} 元`);
  }
  if (id === 'mortgage') {
    const principal = num('principal', '贷款本金'), rate = num('rate', '年利率', { max: 100 });
    const months = num('months', '期数', { min: 1, max: 360, integer: true }), r = rate / 1200;
    const type = fields.loanType || 'standard';
    if (!['standard', 'bullet', 'fixed'].includes(type)) throw new Error('请选择贷款类型');
    if (type === 'bullet') {
      const maturity = maturityDate(fields.loanDate, months);
      const monthlyInterest = principal * r, interest = monthlyInterest * months;
      const method = fields.interestMethod || 'monthly';
      if (!['monthly', 'maturity'].includes(method)) throw new Error('请选择还息方法');
      const final = principal + (method === 'monthly' ? monthlyInterest : interest);
      return result(method === 'monthly' ? '每月应付利息' : '到期应还本息',
        method === 'monthly' ? monthlyInterest : final,
        `到期日期 ${maturity}\n到期应付 ${rounded(final).toFixed(2)} 元\n总利息 ${rounded(interest).toFixed(2)} 元\n还款总额 ${rounded(principal + interest).toFixed(2)} 元\n按整月单利计算，月利率 = 年利率 ÷ 12；不复利。`);
    }
    if (!['equalPayment', 'equalPrincipal'].includes(fields.method || 'equalPayment')) throw new Error('请选择还款方式');
    if (type === 'fixed') {
      const firstMonths = num('discountMonths', '首段折扣期限', { min: 1, max: months, integer: true });
      const discount = num('rateDiscount', '首段利率折扣', { max: 100 });
      const firstRate = r * discount / 100;
      let balance = principal, totalInterest = 0;
      const payments = [];
      let payment = monthlyPayment(balance, firstRate, months);
      // Re-amortize the remaining balance only when the introductory rate ends.
      for (let i = 0; i < months; i++) {
        const currentRate = i < firstMonths ? firstRate : r;
        if (i === firstMonths) payment = monthlyPayment(balance, r, months - i);
        const interest = balance * currentRate;
        const repayment = i === months - 1 ? balance : fields.method === 'equalPrincipal'
          ? principal / months : Math.max(0, Math.min(balance, payment - interest));
        payments.push(repayment + interest);
        totalInterest += interest;
        balance = Math.max(0, balance - repayment);
      }
      return result('首月月供', payments[0],
        `首段 ${firstMonths} 个月，年利率 ${Number((rate * discount / 100).toPrecision(10))}%\n`
        + (firstMonths < months ? `第 ${firstMonths + 1} 月恢复年利率 ${rate}%，月供 ${rounded(payments[firstMonths]).toFixed(2)} 元\n` : '折扣覆盖全部期限\n')
        + `末月月供 ${rounded(payments.at(-1)).toFixed(2)} 元\n总利息 ${rounded(totalInterest).toFixed(2)} 元\n还款总额 ${rounded(principal + totalInterest).toFixed(2)} 元`);
    }
    if (fields.method === 'equalPrincipal') {
      const first = principal / months + principal * r, interest = principal * r * (months + 1) / 2;
      return result('首月月供', first, `末月 ${rounded(principal / months * (1 + r)).toFixed(2)} 元\n每月递减 ${rounded(principal / months * r).toFixed(2)} 元\n总利息 ${rounded(interest).toFixed(2)} 元\n还款总额 ${rounded(principal + interest).toFixed(2)} 元`);
    }
    const payment = monthlyPayment(principal, r, months);
    return result('每月月供', payment, `总利息 ${rounded(payment * months - principal).toFixed(2)} 元\n还款总额 ${rounded(payment * months).toFixed(2)} 元`);
  }
  if (id === 'lesson') {
    const count = num('count', '课时数'), price = num('price', '每课时费用');
    return result('课时费合计', count * price, `${count} 课时 × ${price} 元 / 课时`);
  }
  throw new Error('未知计算工具');
}
