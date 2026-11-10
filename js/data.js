import { loadMnemonics, attachMnemonics } from './mnemonics.js';
// Наборы слов. Файлы data/en.json и data/pt.json собираются скриптом scripts/build-data.mjs
// из основной части словарей Dictionary_English и Dicionario_Portugues (порядок — по частоте).

export const LANGUAGES = {
  en: { name: 'English', label: 'Английский', code: 'en', file: 'data/en.json' },
  pt: { name: 'Português', label: 'Португальский', code: 'pt', file: 'data/pt.json' },
};

export const POS_NAMES = {
  noun: 'сущ.',
  verb: 'гл.',
  adj: 'прил.',
  adv: 'нареч.',
  prep: 'предлог',
  pron: 'местоим.',
  conj: 'союз',
  interj: 'межд.',
  num: 'числ.',
  det: 'опред.',
  phrase: 'выражение',
};

const GENDERS = { m: 'м. р.', f: 'ж. р.', mf: 'м./ж. р.' };

export function entryMeta(entry) {
  const parts = [POS_NAMES[entry.pos] ?? entry.pos];
  if (entry.gender && GENDERS[entry.gender]) parts.push(GENDERS[entry.gender]);
  return parts.filter(Boolean).join(', ');
}

const cache = new Map();

export async function loadWords(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const response = await fetch(LANGUAGES[lang].file);
  if (!response.ok) throw new Error(`Не удалось загрузить слова: ${response.status}`);
  const words = attachMnemonics(await response.json(), await loadMnemonics(lang));
  cache.set(lang, words);
  return words;
}

export const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
