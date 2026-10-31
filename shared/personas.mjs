export const PERSONA_OPTIONS = Object.freeze({
  gentle: { name: '小在', label: '温柔坚定', detail: '先听懂你的感受，再一起拿主意', color: 'green', initial: '在' },
  blunt: { name: '阿直', label: '坦率可靠', detail: '有话直说，帮你抓住最重要的事', color: 'coral', initial: '直' },
  witty: { name: '小酸', label: '机灵嘴损', detail: '笑看麻烦事，认真站在你这边', color: 'blue', initial: '酸' },
  rational: { name: '阿衡', label: '理性沉稳', detail: '理清事实和取舍，陪你想明白', color: 'teal', initial: '衡' },
  bright: { name: '小晴', label: '热情好奇', detail: '一起发现新可能，试点不一样的', color: 'rose', initial: '晴' },
  calm: { name: '慢慢', label: '松弛通透', detail: '不急着催你，先把生活过轻一点', color: 'olive', initial: '慢' },
});

export const PERSONA_IDS = Object.freeze(Object.keys(PERSONA_OPTIONS));
export const validPersona = id => typeof id === 'string' && Object.hasOwn(PERSONA_OPTIONS, id);
export const personaOption = id => PERSONA_OPTIONS[validPersona(id) ? id : 'gentle'];
