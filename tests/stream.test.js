import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, spokenTranslation } from '../js/stream.js';

test('перевод для чтения вслух — первые два значения', () => {
  assert.equal(spokenTranslation({ translations: ['быть', 'являться', 'находиться'] }), 'быть, являться');
  assert.equal(spokenTranslation({ translations: ['дом'] }), 'дом');
});

test('перемешивание не теряет и не дублирует слова', () => {
  const list = Array.from({ length: 50 }, (_, i) => i);
  const mixed = shuffle(list);
  assert.equal(mixed.length, list.length);
  assert.deepEqual([...mixed].sort((a, b) => a - b), list);
  assert.notEqual(mixed, list);
});
