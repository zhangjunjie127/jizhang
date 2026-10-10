export const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
export const SYMPTOMS = ['腹痛', '疲倦', '腹胀', '头痛', '情绪变化'];
export const healthToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
export function healthReminders(entries, after = Date.now(), before = Infinity) {
  return entries.filter(entry => entry.kind === 'visit' && entry.followUp)
    .map(entry => ({ key: `health:${entry.id}:${entry.followUp}`, healthId: entry.id, title: '你有一项复诊安排', at: Date.parse(entry.followUp) }))
    .filter(item => Number.isFinite(item.at) && item.at > after && item.at <= before)
    .sort((a, b) => a.at - b.at);
}
// USDA FoodData Central SR Legacy, per 100 g edible portion; retrieved 2026-10-09.
export const FOODS = [
  [171688, '苹果（带皮）', 52, .26, .17, 13.81],
  [173944, '香蕉', 89, 1.09, .33, 22.84],
  [168878, '白米饭（熟长粒米）', 130, 2.69, .28, 28.17],
  [173424, '水煮鸡蛋', 155, 12.58, 10.61, 1.12],
  [171477, '鸡胸肉（去皮烤熟）', 165, 31.02, 3.57, 0],
  [171265, '全脂牛奶（按克计）', 61, 3.15, 3.25, 4.8],
  [170379, '西兰花（生）', 34, 2.82, .37, 6.64],
  [173904, '燕麦片（干）', 379, 13.15, 6.52, 67.7],
  [169910, '芒果', 60, .82, .38, 14.98],
  [168482, '红薯（生）', 86, 1.57, .05, 20.12],
  [169247, '生菜（罗马生菜）', 17, 1.23, .3, 3.29],
  [172183, '鸡蛋蛋清（生）', 52, 10.9, .17, .73],
].map(([id, name, kcal, protein, fat, carbs]) => ({ id, name, grams: 100, kcal, protein, fat, carbs, source: 'USDA' }));
export function nutritionTotal(items) {
  return ['kcal', 'protein', 'fat', 'carbs'].reduce((result, key) => ({
    ...result, [key]: Math.round(items.reduce((sum, item) => sum + Number(item[key] || 0), 0) * 10) / 10,
  }), {});
}
export function healthSummary(entries, date) {
  const day = entries.filter(item => item.date === date);
  return {
    ...nutritionTotal(day.filter(item => item.kind === 'meal').flatMap(item => item.items)),
    exercise: day.filter(item => item.kind === 'exercise').reduce((sum, item) => sum + item.kcal, 0),
    minutes: day.filter(item => item.kind === 'exercise').reduce((sum, item) => sum + item.minutes, 0),
    water: day.filter(item => item.kind === 'water').reduce((sum, item) => sum + item.ml, 0),
  };
}
