// Ассоциации-созвучия для запоминания слов: «ler — ЛЕРмонтова ЧИТАЮ».
// Файл data/mnemonics-<язык>.json: { "слово|часть речи": "ассоциация" }. Его собирает
// scripts/build-mnemonics.mjs из data/mnemonics-<язык>-*.tsv. Нет файла — нет ассоциаций.
const cache = new Map();

export function loadMnemonics(lang) {
  if (!cache.has(lang)) {
    cache.set(lang, fetch(`data/mnemonics-${lang}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})));
  }
  return cache.get(lang);
}

// Добавить к словам поле mnemonic (на месте). Возвращает те же записи.
export function attachMnemonics(entries, map) {
  for (const e of entries) {
    const text = map[`${e.word}|${e.pos}`];
    if (text) e.mnemonic = text;
  }
  return entries;
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const mnemonicHtml = (entry, tag = 'p') =>
  entry?.mnemonic ? `<${tag} class="mnemonic" title="Ассоциация для запоминания">💡 ${esc(entry.mnemonic)}</${tag}>` : '';
