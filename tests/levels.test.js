import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, streakOf, applyAnswer, gradeFor, pickOptions, PROMOTE_AFTER, SLOW_MS } from '../js/levels.js';
import { AGAIN, HARD, GOOD } from '../js/srs.js';

const e = (word, pos, ...translations) => ({ word, pos, translations });

test('уровень: новые слова — 1-й; старые карточки — по накопленному интервалу', () => {
  assert.equal(levelOf(undefined), 1);
  assert.equal(levelOf({ state: 'learning', interval: 0 }), 1);
  assert.equal(levelOf({ state: 'review', interval: 3 }), 2);
  assert.equal(levelOf({ state: 'review', interval: 10 }), 3);
  assert.equal(levelOf({ state: 'review', interval: 30, level: 1 }), 1);
  assert.equal(streakOf({}), 0);
});

test('3 верных подряд — следующий уровень, серия с нуля', () => {
  let card = { level: 1, streak: 0 };
  for (let i = 1; i < PROMOTE_AFTER; i++) {
    const r = applyAnswer(card, true);
    assert.deepEqual([r.level, r.streak, r.promoted], [1, i, false]);
    card = { ...card, ...r };
  }
  const up = applyAnswer(card, true);
  assert.deepEqual([up.level, up.streak, up.promoted], [2, 0, true]);
});

test('ошибка обнуляет серию; на 3-м уровне — возврат на 2-й; 3-й уровень — последний', () => {
  assert.deepEqual(applyAnswer({ level: 2, streak: 2 }, false), { level: 2, streak: 0, promoted: false, demoted: false });
  assert.deepEqual(applyAnswer({ level: 3, streak: 2 }, false), { level: 2, streak: 0, promoted: false, demoted: true });
  const top = applyAnswer({ level: 3, streak: 2 }, true);
  assert.equal(top.level, 3);
  assert.equal(top.promoted, false);
  assert.ok(top.streak <= PROMOTE_AFTER);
});

test('оценка для интервалов: неверно — «Снова», долго — «Трудно», иначе — «Хорошо»', () => {
  assert.equal(gradeFor(false, 1000), AGAIN);
  assert.equal(gradeFor(true, SLOW_MS + 1), HARD);
  assert.equal(gradeFor(true, 2000), GOOD);
});

test('варианты: слово и 3 других той же части речи без общих переводов', () => {
  const words = [
    e('be', 'verb', 'быть', 'являться'),
    e('exist', 'verb', 'существовать', 'быть'), // общий перевод — не годится
    e('have', 'verb', 'иметь'),
    e('do', 'verb', 'делать'),
    e('say', 'verb', 'сказать'),
    e('go', 'verb', 'идти'),
    e('house', 'noun', 'дом'),
  ];
  for (let i = 0; i < 30; i++) {
    const options = pickOptions(words[0], words);
    assert.equal(options.length, 4);
    assert.ok(options.includes(words[0]));
    assert.ok(!options.some((o) => o.word === 'exist'));
    assert.ok(options.every((o) => o.pos === 'verb'));
    assert.equal(new Set(options.map((o) => o.word)).size, 4);
  }
});

test('варианты: если той же части речи мало — добирает из других', () => {
  const words = [e('cat', 'noun', 'кошка'), e('dog', 'noun', 'собака'), e('run', 'verb', 'бежать'), e('red', 'adj', 'красный')];
  const options = pickOptions(words[0], words);
  assert.equal(options.length, 4);
  assert.equal(options.filter((o) => o.word === 'cat').length, 1);
});
