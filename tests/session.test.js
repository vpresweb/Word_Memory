import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordId, dayKey, freshWords, dueWords, pickNext, streak, summary, forecast, markDay, wordsForSource, sample, LEARN_AHEAD,
} from '../js/session.js';

test('случайная выборка: без повторов, не больше нужного, из всего списка', () => {
  const list = Array.from({ length: 100 }, (_, i) => i);
  const picked = sample(list, 30);
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked).size, 30);
  assert.ok(picked.every((x) => list.includes(x)));
  assert.equal(sample([1, 2], 30).length, 2);
  assert.notDeepEqual(sample(list, 30, () => 0.99), sample(list, 30, () => 0));
});
import { newCard, review, GOOD, EASY, MINUTE, DAY } from '../js/srs.js';

const NOW = new Date(2026, 10, 8, 12, 0).getTime(); // местное время, полдень
const words = ['be', 'have', 'do', 'say', 'go', 'get', 'make'].map((word) => ({ word, pos: 'verb', translations: ['x'] }));
const empty = () => ({ cards: {}, days: [] });

function started(progress, entry, card) {
  progress.cards[wordId(entry)] = card;
}

test('новые слова — первые по порядку, с учётом уже начатых сегодня', () => {
  const p = empty();
  assert.deepEqual(freshWords(words, p, 3, NOW).map((e) => e.word), ['be', 'have', 'do']);
  started(p, words[0], { ...review(newCard(NOW), GOOD, NOW), added: dayKey(NOW) });
  assert.deepEqual(freshWords(words, p, 3, NOW).map((e) => e.word), ['have', 'do']);
  // Вчера начатое слово не уменьшает сегодняшний лимит.
  started(p, words[1], { ...review(newCard(NOW - DAY), GOOD, NOW - DAY), added: dayKey(NOW - DAY) });
  assert.deepEqual(freshWords(words, p, 3, NOW).map((e) => e.word), ['do', 'say']);
});

test('к повторению — всё, что наступает до конца дня, раньше первыми', () => {
  const p = empty();
  started(p, words[0], { ...review(newCard(NOW - 5 * DAY), EASY, NOW - 5 * DAY) }); // due NOW-1d
  started(p, words[1], { ...newCard(NOW), state: 'review', interval: 3, due: NOW + 3 * 3600_000 }); // сегодня позже
  started(p, words[2], { ...newCard(NOW), state: 'review', interval: 3, due: NOW + 2 * DAY }); // не сегодня
  assert.deepEqual(dueWords(words, p, NOW).map((e) => e.word), ['be', 'have']);
});

test('следующая карточка: сначала готовые к повтору, затем очередь, затем изучение заранее', () => {
  const [a, b, c] = words;
  assert.equal(pickNext([a], [{ entry: b, due: NOW - 1 }], NOW).entry, b);
  assert.equal(pickNext([a], [{ entry: b, due: NOW + MINUTE }], NOW).entry, a);
  const ahead = pickNext([], [{ entry: c, due: NOW + 5 * MINUTE }, { entry: b, due: NOW + MINUTE }], NOW);
  assert.equal(ahead.entry, b);
  assert.equal(pickNext([], [{ entry: c, due: NOW + LEARN_AHEAD + MINUTE }], NOW), null);
});

test('серия дней: считается от сегодня или вчера', () => {
  const day = (offset) => dayKey(NOW + offset * DAY);
  assert.equal(streak([day(-2), day(-1), day(0)], NOW), 3);
  assert.equal(streak([day(-3), day(-2), day(-1)], NOW), 3);
  assert.equal(streak([day(-3), day(-2)], NOW), 0);
  assert.equal(streak([], NOW), 0);
});

test('сводка и прогноз', () => {
  const p = empty();
  started(p, words[0], { ...newCard(NOW), state: 'review', interval: 30, due: NOW + 30 * DAY });
  started(p, words[1], { ...newCard(NOW), state: 'learning', due: NOW + MINUTE });
  started(p, words[2], { ...newCard(NOW), state: 'review', interval: 2, due: NOW + DAY });
  const s = summary(words, p, NOW);
  assert.equal(s.started, 3);
  assert.equal(s.learned, 1);
  assert.equal(s.learning, 1);
  assert.equal(s.due, 1);
  assert.deepEqual(forecast(p, NOW, 3), [1, 1, 0]);
});

test('день занятия отмечается один раз', () => {
  const p = empty();
  markDay(p, NOW);
  markDay(p, NOW + MINUTE);
  assert.deepEqual(p.days, [dayKey(NOW)]);
});

test('наборы для потока', () => {
  const p = empty();
  const settings = { newPerDay: 2 };
  started(p, words[0], { ...newCard(NOW), state: 'review', interval: 40, due: NOW + 40 * DAY });
  started(p, words[1], { ...newCard(NOW), state: 'learning', due: NOW, added: dayKey(NOW) });
  assert.deepEqual(wordsForSource('learned', words, p, settings, NOW).map((e) => e.word), ['be']);
  assert.deepEqual(wordsForSource('learning', words, p, settings, NOW).map((e) => e.word), ['have']);
  assert.deepEqual(wordsForSource('today', words, p, settings, NOW).map((e) => e.word), ['do', 'have']);
  assert.equal(wordsForSource('next', words, p, settings, NOW).length, 5);
  const random = wordsForSource('random', words, p, settings, NOW);
  assert.equal(random.length, Math.min(30, words.length));
  assert.equal(new Set(random.map((e) => e.word)).size, random.length);
});

test('только что показанное слово не идёт второй раз подряд, если есть другие', () => {
  const [a, b, c] = ['be', 'have', 'do'].map((word) => ({ word, pos: 'verb', translations: ['x'] }));
  // b с ошибкой вернётся через минуту, c — через 10: всё равно следующим будет c, а не снова b.
  const waiting = [{ entry: b, due: NOW + MINUTE }, { entry: c, due: NOW + 10 * MINUTE }];
  assert.equal(pickNext([], waiting, NOW, b).entry, c);
  assert.equal(pickNext([b, a], [], NOW, b).entry, a);
  assert.equal(pickNext([], [{ entry: b, due: NOW - 1 }, { entry: a, due: NOW - 1 }], NOW, b).entry, a);
  // других нет — то же слово
  assert.equal(pickNext([b], [], NOW, b).entry, b);
  assert.equal(pickNext([], [{ entry: b, due: NOW + MINUTE }], NOW, b).entry, b);
});
