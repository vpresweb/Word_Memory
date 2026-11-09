// Уровни проверки слова. Вместо самооценки «Снова / Трудно / Хорошо / Легко» слово проверяется
// выбором из 4 вариантов, а задание усложняется по мере запоминания:
//   1. Узнавание — видите слово, выбираете перевод из четырёх;
//   2. Обратный выбор — видите перевод, выбираете слово из четырёх;
//   3. Вспоминание — видите перевод, вспоминаете слово сами, открываете ответ и честно отмечаете.
// Переход на следующий уровень — после 3 верных ответов подряд. Ответы приходятся на разные
// повторы (через 10 минут, через день, через несколько дней), поэтому 3 подряд — это уже
// устойчивое знание, а не удачная догадка (шанс угадать 3 раза подряд — 1 из 64).
// Ошибка обнуляет серию; ошибка на 3-м уровне возвращает на 2-й. В первый день (слово начато
// сегодня) любая ошибка возвращает слово к самому началу — на 1-й уровень.
// Когда повторять, по-прежнему решает алгоритм интервалов (srs.js): оценку он получает
// автоматически — неверно → «Снова», верно, но долго думали → «Трудно», верно → «Хорошо».
import { AGAIN, HARD, GOOD } from './srs.js';

export const LEVELS = {
  1: { name: 'Узнавание', task: 'Выберите перевод' },
  2: { name: 'Обратный выбор', task: 'Выберите слово' },
  3: { name: 'Вспоминание', task: 'Вспомните слово и проверьте себя' },
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
// firstDay — слово начато сегодня: ошибка возвращает его к самому началу, на 1-й уровень.
export function applyAnswer(card, correct, firstDay = false) {
  const level = levelOf(card);
  if (!correct) {
    const down = firstDay ? 1 : level === MAX_LEVEL ? level - 1 : level;
    return { level: down, streak: 0, promoted: false, demoted: down < level };
  }
  const streak = streakOf(card) + 1;
  if (streak >= PROMOTE_AFTER && level < MAX_LEVEL) return { level: level + 1, streak: 0, promoted: true, demoted: false };
  return { level, streak: Math.min(streak, PROMOTE_AFTER), promoted: false, demoted: false };
}

// Примечание на карточке: как слово перейдёт на следующий уровень.
export function levelRule(level, streak, firstDay = false) {
  if (level >= MAX_LEVEL) {
    return `Последний уровень. «Не вспомнил» вернёт слово на уровень ${firstDay ? 1 : MAX_LEVEL - 1}. `
      + 'Слово запомнено надолго, когда без ошибок дойдёт до повтора через 3 недели.';
  }
  const left = Math.max(1, PROMOTE_AFTER - streak);
  const answers = left === 1 ? 'верный ответ' : 'верных ответа';
  return `Ещё ${left} ${answers} подряд — переход на уровень ${level + 1} (${LEVELS[level + 1].name.toLowerCase()}). `
    + (firstDay && level > 1 ? 'Слово начато сегодня: ошибка вернёт его на уровень 1.' : 'Ошибка обнулит серию.');
}

// Оценка для алгоритма интервалов.
export function gradeFor(correct, ms) {
  if (!correct) return AGAIN;
  return ms > SLOW_MS ? HARD : GOOD;
}

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
