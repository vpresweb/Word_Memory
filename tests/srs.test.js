import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newCard, review, previewIntervals, formatInterval, isLearned, isLearning,
  AGAIN, HARD, GOOD, EASY, MINUTE, DAY, LEARNING_STEPS, RELEARN_STEP, MIN_EASE, START_EASE,
} from '../js/srs.js';

const T0 = Date.UTC(2026, 10, 8, 9, 0);

test('новое слово проходит шаги изучения и переходит в повторение через день', () => {
  let card = newCard(T0);
  card = review(card, GOOD, T0);
  assert.equal(card.state, 'learning');
  assert.equal(card.due, T0 + LEARNING_STEPS[1]);
  card = review(card, GOOD, card.due);
  assert.equal(card.state, 'review');
  assert.equal(card.interval, 1);
  assert.equal(card.reps, 2);
});

test('«снова» на изучении возвращает слово через минуту', () => {
  const card = review(review(newCard(T0), GOOD, T0), AGAIN, T0 + 10 * MINUTE);
  assert.equal(card.state, 'learning');
  assert.equal(card.step, 0);
  assert.equal(card.due, T0 + 10 * MINUTE + LEARNING_STEPS[0]);
});

test('«легко» у нового слова — сразу интервал 4 дня', () => {
  const card = review(newCard(T0), EASY, T0);
  assert.equal(card.state, 'review');
  assert.equal(card.interval, 4);
  assert.equal(card.due, T0 + 4 * DAY);
});

test('«трудно» на первом шаге — между первым и вторым шагом, шаг не растёт', () => {
  const card = review(newCard(T0), HARD, T0);
  assert.equal(card.step, 0);
  assert.equal(card.due, T0 + (LEARNING_STEPS[0] + LEARNING_STEPS[1]) / 2);
});

test('интервалы растут с каждым «хорошо»', () => {
  let card = review(newCard(T0), EASY, T0); // 4 дня
  const intervals = [];
  let now = T0;
  for (let i = 0; i < 4; i++) {
    now = card.due;
    card = review(card, GOOD, now);
    intervals.push(card.interval);
  }
  assert.deepEqual(intervals, [10, 25, 63, 158]);
  assert.ok(isLearned(card));
});

test('ошибка в выученном слове: переучивание, интервал вдвое меньше, лёгкость снижается', () => {
  let card = { ...newCard(T0), state: 'review', interval: 30, ease: 2.5 };
  card = review(card, AGAIN, T0);
  assert.equal(card.state, 'relearning');
  assert.equal(card.interval, 15);
  assert.equal(card.lapses, 1);
  assert.equal(card.ease, 2.3);
  assert.equal(card.due, T0 + RELEARN_STEP);
  assert.ok(isLearning(card));
  card = review(card, GOOD, card.due);
  assert.equal(card.state, 'review');
  assert.equal(card.due, T0 + RELEARN_STEP + 15 * DAY);
});

test('лёгкость не опускается ниже минимума', () => {
  let card = { ...newCard(T0), state: 'review', interval: 5, ease: MIN_EASE };
  card = review(card, HARD, T0);
  assert.equal(card.ease, MIN_EASE);
  assert.equal(card.interval, 6); // минимум +1 день
});

test('исходная карточка не изменяется', () => {
  const card = newCard(T0);
  const copy = structuredClone(card);
  review(card, GOOD, T0);
  assert.deepEqual(card, copy);
  assert.equal(card.ease, START_EASE);
});

test('неизвестная оценка — ошибка', () => {
  assert.throws(() => review(newCard(T0), 5, T0), RangeError);
});

test('подписи интервалов на кнопках', () => {
  const p = previewIntervals(newCard(T0), T0);
  assert.equal(formatInterval(p[AGAIN]), '1 мин');
  assert.equal(formatInterval(p[GOOD]), '10 мин');
  assert.equal(formatInterval(p[EASY]), '4 дн.');
  assert.equal(formatInterval(3 * 3600_000), '3 ч');
  assert.equal(formatInterval(90 * DAY), '3 мес.');
  assert.equal(formatInterval(400 * DAY), '1,1 г.');
  assert.equal(formatInterval(730 * DAY), '2 г.');
});
