// Интервальное повторение (вариант алгоритма SM-2, как в Anki).
// Карточка проходит этапы: новая → изучение (короткие шаги в минутах) → повторение
// (интервалы в днях растут с каждым удачным ответом) → при ошибке — переучивание.
// Все функции чистые: время передаётся снаружи, карточка не изменяется, а копируется.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// Шаги изучения новой карточки: через 1 минуту, затем через 10 минут.
export const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
// Шаг переучивания после ошибки в уже выученном слове.
export const RELEARN_STEP = 10 * MINUTE;
export const GRADUATING_INTERVAL = 1; // дней — первый интервал после изучения
export const EASY_INTERVAL = 4; // дней — если новое слово сразу «легко»
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
// Слово считается запомненным надолго, если следующий повтор не раньше чем через 3 недели.
export const LEARNED_INTERVAL = 21;

export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;
export const GRADES = [AGAIN, HARD, GOOD, EASY];

export function newCard(now) {
  return { state: 'new', due: now, interval: 0, ease: START_EASE, step: 0, reps: 0, lapses: 0 };
}

function learningStep(card, grade, now) {
  const steps = LEARNING_STEPS;
  if (grade === AGAIN) return { ...card, state: 'learning', step: 0, due: now + steps[0] };
  if (grade === HARD) {
    // «Трудно» не продвигает шаг; на первом шаге — середина между первым и вторым.
    const delay = card.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[card.step];
    return { ...card, state: 'learning', due: now + delay };
  }
  if (grade === EASY) return graduate(card, EASY_INTERVAL, now);
  const step = card.step + 1;
  if (step >= steps.length) return graduate(card, GRADUATING_INTERVAL, now);
  return { ...card, state: 'learning', step, due: now + steps[step] };
}

function graduate(card, interval, now) {
  return { ...card, state: 'review', step: 0, interval, due: now + interval * DAY };
}

function relearningStep(card, grade, now) {
  if (grade === AGAIN || grade === HARD) return { ...card, due: now + RELEARN_STEP };
  return { ...card, state: 'review', due: now + card.interval * DAY };
}

function reviewStep(card, grade, now) {
  if (grade === AGAIN) {
    return {
      ...card,
      state: 'relearning',
      lapses: card.lapses + 1,
      ease: Math.max(MIN_EASE, card.ease - 0.2),
      interval: Math.max(1, Math.round(card.interval * 0.5)),
      due: now + RELEARN_STEP,
    };
  }
  let { ease } = card;
  let interval;
  if (grade === HARD) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    interval = card.interval * 1.2;
  } else if (grade === GOOD) {
    interval = card.interval * ease;
  } else {
    ease += 0.15;
    interval = card.interval * ease * 1.3;
  }
  // Интервал всегда растёт хотя бы на день, иначе слово «застревает».
  interval = Math.max(card.interval + 1, Math.round(interval));
  return { ...card, ease, interval, due: now + interval * DAY };
}

// Ответ на карточку: grade — AGAIN | HARD | GOOD | EASY.
export function review(card, grade, now) {
  if (!GRADES.includes(grade)) throw new RangeError(`Неизвестная оценка: ${grade}`);
  let next;
  if (card.state === 'new' || card.state === 'learning') next = learningStep(card, grade, now);
  else if (card.state === 'relearning') next = relearningStep(card, grade, now);
  else next = reviewStep(card, grade, now);
  return { ...next, reps: card.reps + 1, last: now };
}

// Через сколько миллисекунд карточка вернётся при каждой из оценок — для подписей на кнопках.
export function previewIntervals(card, now) {
  return Object.fromEntries(GRADES.map((g) => [g, review(card, g, now).due - now]));
}

export function formatInterval(ms) {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${Math.max(1, minutes)} мин`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(ms / DAY);
  if (days < 31) return `${days} дн.`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} мес.`;
  return `${(days / 365).toFixed(1).replace('.0', '').replace('.', ',')} г.`;
}

export const isLearned = (card) => card.state === 'review' && card.interval >= LEARNED_INTERVAL;
export const isLearning = (card) => card.state === 'learning' || card.state === 'relearning';
