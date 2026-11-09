// Уровни проверки слова. Вместо самооценки «Снова / Трудно / Хорошо / Легко» слово проверяется
// выбором из 4 вариантов, а задание усложняется по мере запоминания:
//   1. Узнавание — видите слово, выбираете перевод из четырёх;
//   2. Обратный выбор — видите перевод, выбираете слово из четырёх;
//   3. Вспоминание — видите перевод и пишете слово сами; проверка — checkTyped.
// Переход на следующий уровень — после 3 верных ответов подряд. Ответы приходятся на разные
// повторы (через 10 минут, через день, через несколько дней), поэтому 3 подряд — это уже
// устойчивое знание, а не удачная догадка (шанс угадать 3 раза подряд — 1 из 64).
// Ошибка возвращает слово на один уровень ниже (с 1-го — остаётся на 1-м) и обнуляет серию.
// Когда повторять, по-прежнему решает алгоритм интервалов (srs.js): оценку он получает
// автоматически — неверно → «Снова», верно, но долго думали → «Трудно», верно → «Хорошо».
import { AGAIN, HARD, GOOD } from './srs.js';

export const LEVELS = {
  1: { name: 'Узнавание', task: 'Выберите перевод' },
  2: { name: 'Обратный выбор', task: 'Выберите слово' },
  3: { name: 'Вспоминание', task: 'Напишите слово' },
};
export const MAX_LEVEL = 3;
export const PROMOTE_AFTER = 3;
// Дольше — ответ верный, но слово вспоминается с трудом.
export const SLOW_MS = 8000;

// Уровень слова. У карточек, начатых до появления уровней, — по накопленному интервалу.
export function levelOf(card) {
  if (!card) return 1;
  if (card.level >= 1 && card.level <= MAX_LEVEL) return card.level;
  if (card.state === 'review' && card.interval >= 7) return 3;
  if (card.state === 'review') return 2;
  return 1;
}

export const streakOf = (card) => (card && Number.isInteger(card.streak) ? card.streak : 0);

// Новый уровень и серия после ответа: { level, streak, promoted, demoted }.
// Ошибка — на один уровень ниже (не ниже 1-го), серия с нуля.
export function applyAnswer(card, correct) {
  const level = levelOf(card);
  if (!correct) {
    const down = Math.max(1, level - 1);
    return { level: down, streak: 0, promoted: false, demoted: down < level };
  }
  const streak = streakOf(card) + 1;
  if (streak >= PROMOTE_AFTER && level < MAX_LEVEL) return { level: level + 1, streak: 0, promoted: true, demoted: false };
  return { level, streak: Math.min(streak, PROMOTE_AFTER), promoted: false, demoted: false };
}

// Примечание на карточке: как слово перейдёт на следующий уровень.
export function levelRule(level, streak) {
  if (level >= MAX_LEVEL) {
    return `Последний уровень. Ошибка вернёт слово на уровень ${MAX_LEVEL - 1}. `
      + 'Слово запомнено надолго, когда без ошибок дойдёт до повтора через 3 недели.';
  }
  const left = Math.max(1, PROMOTE_AFTER - streak);
  const answers = left === 1 ? 'верный ответ' : 'верных ответа';
  return `Ещё ${left} ${answers} подряд — переход на уровень ${level + 1} (${LEVELS[level + 1].name.toLowerCase()}). `
    + (level > 1 ? `Ошибка вернёт слово на уровень ${level - 1}.` : 'Ошибка обнулит серию.');
}

// --- 3-й уровень: слово пишется с клавиатуры --------------------------------

// Для сравнения: регистр, апострофы, знаки препинания и лишние пробелы не важны.
const normalize = (s) => s.normalize('NFC').toLowerCase().replace(/[’`´]/g, "'")
  .replace(/[?!¿¡.,;:…"«»()]/g, ' ').replace(/\s+/g, ' ').trim();
const stripMarks = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
// Частицы, которые пишут по привычке: to be, the house, o livro.
const LEADING = ['to ', 'the ', 'a ', 'an ', 'o ', 'os ', 'as ', 'um ', 'uma '];

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Проверка написанного слова: 'exact' — верно; 'accents' — верно, кроме диакритики (á, ç, ã);
// 'typo' — одна опечатка в длинном слове; 'wrong' — неверно. Пустой ввод — 'wrong'.
export function checkTyped(input, word) {
  const expected = normalize(word);
  let typed = normalize(input ?? '');
  if (!typed) return 'wrong';
  for (const p of LEADING) {
    if (typed.startsWith(p) && !expected.startsWith(p)) typed = typed.slice(p.length);
  }
  if (typed === expected) return 'exact';
  if (stripMarks(typed) === stripMarks(expected)) return 'accents';
  if (expected.length >= 6 && distance(stripMarks(typed), stripMarks(expected)) === 1) return 'typo';
  return 'wrong';
}

// Оценка для алгоритма интервалов.
// slow — порог «долго думал»; для написанного слова он больше: печать занимает время.
export function gradeFor(correct, ms, slow = SLOW_MS) {
  if (!correct) return AGAIN;
  return ms > slow ? HARD : GOOD;
}
export const SLOW_TYPED_MS = 15000;

const id = (e) => `${e.word}|${e.pos}`;
const shortTranslation = (e) => e.translations.slice(0, 3);

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Четыре варианта ответа: само слово и три похожих (та же часть речи, близкая частотность),
// у которых нет общего перевода с ним — иначе «неверный» вариант мог бы оказаться верным.
export function pickOptions(entry, words, count = 4, random = Math.random) {
  const own = new Set(shortTranslation(entry).map((t) => t.toLowerCase()));
  const ok = (e) =>
    id(e) !== id(entry)
    && e.word.toLowerCase() !== entry.word.toLowerCase()
    && e.translations.length > 0
    && !shortTranslation(e).some((t) => own.has(t.toLowerCase()));
  const index = words.findIndex((e) => id(e) === id(entry));
  const near = (list) => {
    if (index < 0) return list;
    return list.filter((e) => Math.abs(words.indexOf(e) - index) <= 150);
  };
  const samePos = words.filter((e) => e.pos === entry.pos && ok(e));
  const pools = [near(samePos), samePos, words.filter(ok)];
  const chosen = [];
  const used = new Set();
  for (const pool of pools) {
    for (const e of shuffle(pool, random)) {
      if (chosen.length >= count - 1) break;
      const key = e.word.toLowerCase();
      if (used.has(key)) continue;
      // Переводы вариантов тоже не должны совпадать между собой.
      if (chosen.some((c) => shortTranslation(c).some((t) => shortTranslation(e).includes(t)))) continue;
      used.add(key);
      chosen.push(e);
    }
    if (chosen.length >= count - 1) break;
  }
  return shuffle([entry, ...chosen], random);
}
