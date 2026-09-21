import React from 'react';
import {
  UtensilsCrossed, ShoppingBasket, SprayCan, BusFront, Carrot, Apple, Cookie,
  Dumbbell, Clapperboard, Phone, Shirt, Paintbrush, Building2, Armchair, Baby,
  Accessibility, MessagesSquare, Plane, Wine, Smartphone, Car, Stethoscope,
  BookOpen, GraduationCap, PawPrint, HandCoins, Gift, BriefcaseBusiness, Wrench,
  HeartHandshake, Ticket, Users, Package, Ellipsis, WalletCards, Clock3,
  ChartNoAxesCombined, HeartPulse, Sunrise, Sun, Moon, Landmark,
} from 'lucide-react';
import './category-colors.css';

const CATEGORY_TONES = new Map(Object.entries({
  food: ['早餐', '午餐', '晚餐', '餐饮', '食材', '蔬菜', '水果', '零食'],
  travel: ['交通', '旅行', '汽车', '快递'],
  home: ['购物', '日用', '住房', '居住', '居家', '服饰', '数码', '宠物', '维修'],
  health: ['运动', '医疗', '健康', '美容'],
  social: ['孩子', '长辈', '社交', '礼金', '礼物', '捐赠', '亲友'],
  work: ['通讯', '书籍', '学习', '办公'],
  finance: ['还贷', '工资', '兼职', '理财', '债务', '收回借款'],
  leisure: ['娱乐', '烟酒', '彩票'],
}).flatMap(([tone, categories]) => categories.map(category => [category, tone])));
export const categoryTone = category => `category-tone-${CATEGORY_TONES.get(category) || 'other'}`;

export const EXPENSE_CATEGORIES = [
  '早餐', '午餐', '晚餐', '蔬菜', '水果', '零食',
  '交通', '旅行', '汽车', '快递',
  '购物', '日用', '住房', '居家', '服饰', '数码', '宠物', '维修',
  '运动', '医疗', '美容',
  '孩子', '长辈', '社交', '礼金', '礼物', '捐赠', '亲友',
  '通讯', '书籍', '学习', '办公',
  '娱乐', '烟酒', '彩票',
  '还贷', '其他',
];
export const INCOME_CATEGORIES = ['工资', '兼职', '理财', '债务', '礼金', '其他'];
// Historical category names remain available when filtering and editing old records.
export const CATEGORIES = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, '餐饮', '居住', '健康', '收回借款'])];
const ICONS = {
  早餐: Sunrise, 午餐: Sun, 晚餐: Moon,
  餐饮: UtensilsCrossed, 购物: ShoppingBasket, 日用: SprayCan, 交通: BusFront,
  蔬菜: Carrot, 水果: Apple, 零食: Cookie, 运动: Dumbbell, 娱乐: Clapperboard,
  通讯: Phone, 服饰: Shirt, 美容: Paintbrush, 住房: Building2, 居家: Armchair,
  孩子: Baby, 长辈: Accessibility, 社交: MessagesSquare, 旅行: Plane, 烟酒: Wine,
  数码: Smartphone, 汽车: Car, 医疗: Stethoscope, 书籍: BookOpen, 学习: GraduationCap,
  宠物: PawPrint, 礼金: HandCoins, 礼物: Gift, 办公: BriefcaseBusiness, 维修: Wrench,
  捐赠: HeartHandshake, 彩票: Ticket, 亲友: Users, 快递: Package, 其他: Ellipsis,
  工资: WalletCards, 兼职: Clock3, 理财: ChartNoAxesCombined, 居住: Building2, 健康: HeartPulse,
  还贷: Landmark, 债务: HandCoins, 收回借款: HandCoins,
};
export function CategoryIcon({ category, size = 20 }) {
  const Icon = ICONS[category] || Ellipsis;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
