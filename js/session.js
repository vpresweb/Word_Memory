// Состав занятия и статистика. Чистые функции: прогресс и время передаются снаружи.
// progress: { cards: { [id]: card }, days: ['YYYY-MM-DD', ...] }
import { DAY, MINUTE, isLearned, isLearning } from './srs.js';

// Слова изучения разрешено показать раньше срока, если до него осталось меньше 20 минут
// (иначе пришлось бы ждать минуту-другую с пустым экраном).
export const LEARN_AHEAD = 20 * MINUTE;

// Ключ слова: слово и часть речи — у омонимов (work: глагол и существительное) прогресс раздельный.
export const wordId = (entry) => `${entry.word}|${entry.pos}`;

// Дата по местному времени в виде YYYY-MM-DD.
export function dayKey(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function endOfDay(time) {
  const d = new Date(time);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// Сколько новых слов уже начато сегодня.
export function introducedToday(progress, now) {
  const today = dayKey(now);
  return Object.values(progress.cards).filter((c) => c.added === today).length;
}

// Новые слова на сегодня: первые по частоте, которых ещё нет в прогрессе.
export function freshWords(words, progress, newPerDay, now) {
  const limit = Math.max(0, newPerDay - introducedToday(progress, now));
  const fresh = [];
  for (const entry of words) {
    if (fresh.length >= limit) break;
    if (!(wordId(entry) in progress.cards)) fresh.push(entry);
  }
  return fresh;
}

// Слова к повторению: срок наступил до конца сегодняшнего дня, раньше — первыми.
export function dueWords(words, progress, now) {
  const until = endOfDay(now);
  return words
    .filter((entry) => {
      const card = progress.cards[wordId(entry)];
      return card && card.state !== 'new' && card.due <= until;
    })
    .sort((a, b) => progress.cards[wordId(a)].due - progress.cards[wordId(b)].due);
}

// Следующая карточка занятия.
// queue — ещё не показанные слова по порядку; waiting — слова изучения, которые вернутся позже
// ([{ entry, due }]). Возвращает { entry, from: 'waiting' | 'queue' } или null, если всё сделано.
export function pickNext(queue, waiting, now) {
  const ready = waiting.filter((w) => w.due <= now).sort((a, b) => a.due - b.due)[0];
  if (ready) return { entry: ready.entry, from: 'waiting' };
  if (queue.length) return { entry: queue[0], from: 'queue' };
  const soon = waiting.filter((w) => w.due <= now + LEARN_AHEAD).sort((a, b) => a.due - b.due)[0];
  if (soon) return { entry: soon.entry, from: 'waiting' };
  return null;
}

// Незаконченное занятие — для сохранения: только ключи слов, сами слова берутся из словаря.
// Показанная, но не оценённая карточка возвращается в начало очереди.
export function packSession({ queue, waiting, fresh, introDone, reviewed, current }, now) {
  return {
    day: dayKey(now),
    queue: [...(current ? [current] : []), ...queue].map(wordId),
    waiting: waiting.map((w) => ({ id: wordId(w.entry), due: w.due })),
    fresh: [...fresh],
    introDone: Boolean(introDone),
    reviewed: reviewed || 0,
  };
}

// Восстановить занятие. null — восстанавливать нечего: занятие вчерашнее, пустое или испорчено.
// Прогресс мог измениться на другом устройстве: уже повторённые там слова пропускаются,
// а сроки слов изучения берутся из прогресса.
export function unpackSession(saved, words, progress, now) {
  if (!saved || saved.day !== dayKey(now) || !Array.isArray(saved.queue) || !Array.isArray(saved.waiting)) return null;
  const byId = new Map(words.map((e) => [wordId(e), e]));
  const fresh = new Set(Array.isArray(saved.fresh) ? saved.fresh : []);
  const until = endOfDay(now);
  const queue = [];
  const seen = new Set();
  for (const id of saved.queue) {
    const entry = byId.get(id);
    if (!entry || seen.has(id)) continue;
    const card = progress.cards[id];
    if (fresh.has(id) ? Boolean(card) : !card || card.due > until) continue;
    seen.add(id);
    queue.push(entry);
  }
  const waiting = [];
  for (const w of saved.waiting) {
    const entry = byId.get(w?.id);
    const card = progress.cards[w?.id];
    if (!entry || seen.has(w.id) || !card || !isLearning(card) || card.due > until) continue;
    seen.add(w.id);
    waiting.push({ entry, due: card.due });
  }
  if (!queue.length && !waiting.length) return null;
  const freshLeft = queue.map(wordId).filter((id) => fresh.has(id));
  return {
    queue,
    waiting,
    fresh: freshLeft,
    introDone: Boolean(saved.introDone) || !freshLeft.length,
    reviewed: Number(saved.reviewed) || 0,
  };
}

// Серия дней подряд с занятиями, заканчивающаяся сегодня или вчера.
export function streak(days, now) {
  const set = new Set(days);
  let count = 0;
  let t = now;
  if (!set.has(dayKey(t))) t -= DAY;
  while (set.has(dayKey(t))) {
    count += 1;
    t -= DAY;
  }
  return count;
}

export function summary(words, progress, now) {
  const ids = new Set(words.map(wordId));
  const cards = Object.entries(progress.cards).filter(([id]) => ids.has(id)).map(([, c]) => c);
  return {
    total: words.length,
    started: cards.length,
    learning: cards.filter(isLearning).length,
    learned: cards.filter(isLearned).length,
    due: dueWords(words, progress, now).length,
    streak: streak(progress.days, now),
  };
}

// Сколько повторений придётся на каждый из ближайших дней (сегодня включительно).
export function forecast(progress, now, days = 7) {
  const result = Array(days).fill(0);
  const start = endOfDay(now) - DAY;
  for (const card of Object.values(progress.cards)) {
    if (card.state === 'new') continue;
    const index = Math.max(0, Math.ceil((card.due - start) / DAY) - 1);
    if (index < days) result[index] += 1;
  }
  return result;
}

// Наборы слов для «Потока» и «25-го кадра».
export const SOURCES = {
  today: 'Новые на сегодня и слова в изучении',
  learning: 'Все начатые, но ещё не выученные',
  next: 'Следующие 30 новых слов',
  learned: 'Выученные — освежить',
};

export function wordsForSource(kind, words, progress, settings, now) {
  const cardOf = (entry) => progress.cards[wordId(entry)];
  if (kind === 'today') {
    const fresh = freshWords(words, progress, settings.newPerDay, now);
    const started = words.filter((e) => {
      const c = cardOf(e);
      return c && (isLearning(c) || c.added === dayKey(now));
    });
    return [...new Set([...fresh, ...started])];
  }
  if (kind === 'learning') return words.filter((e) => cardOf(e) && !isLearned(cardOf(e)));
  if (kind === 'learned') return words.filter((e) => cardOf(e) && isLearned(cardOf(e)));
  return words.filter((e) => !cardOf(e)).slice(0, 30);
}

// Отметить день занятия; храним не больше года.
export function markDay(progress, now) {
  const today = dayKey(now);
  if (!progress.days.includes(today)) progress.days = [...progress.days, today].slice(-400);
}
