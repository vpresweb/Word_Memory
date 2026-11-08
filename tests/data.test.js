import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../js/data.js';
import { wordId } from '../js/session.js';
import { validProgress, emptyProgress } from '../js/storage.js';

for (const [lang, { file }] of Object.entries(LANGUAGES)) {
  test(`набор слов ${lang}: корректные статьи без повторов`, async () => {
    const words = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.ok(words.length > 9000, `слов: ${words.length}`);
    const ids = new Set();
    for (const entry of words) {
      assert.equal(typeof entry.word, 'string');
      assert.ok(entry.word.trim(), 'пустое слово');
      assert.ok(Array.isArray(entry.translations) && entry.translations.length, `нет перевода: ${entry.word}`);
      assert.ok(entry.translations.length <= 3);
      if (entry.example) assert.ok(entry.example.text && entry.example.ru);
      const id = wordId(entry);
      assert.ok(!ids.has(id), `повтор: ${id}`);
      ids.add(id);
    }
  });
}

test('частотный порядок: первыми идут самые нужные слова', async () => {
  const en = JSON.parse(await readFile(new URL('../data/en.json', import.meta.url), 'utf8'));
  const pt = JSON.parse(await readFile(new URL('../data/pt.json', import.meta.url), 'utf8'));
  assert.equal(en[0].word, 'be');
  assert.equal(pt[0].word, 'ser');
});

test('проверка резервной копии прогресса', () => {
  assert.ok(validProgress(emptyProgress()));
  assert.ok(validProgress({ cards: { 'be|verb': { state: 'review', due: 1, interval: 3 } }, days: [] }));
  assert.ok(!validProgress(null));
  assert.ok(!validProgress({ cards: {} }));
  assert.ok(!validProgress({ cards: { x: { state: 'review' } }, days: [] }));
});
