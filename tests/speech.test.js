import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVoice } from '../js/speech.js';

const v = (name, lang, localService) => ({ name, lang, localService });
// Как на Windows без английского голоса: только сетевые голоса Google.
const windowsRu = [
  v('Microsoft Irina', 'ru-RU', true),
  v('Microsoft Helia', 'pt-PT', true),
  v('Google US English', 'en-US', false),
  v('Google UK English Female', 'en-GB', false),
  v('Google português do Brasil', 'pt-BR', false),
];

test('без локального английского — сетевой en-GB', () => {
  assert.equal(chooseVoice(windowsRu, ['en-gb', 'en-us'], 'en').name, 'Google UK English Female');
});

test('локальный голос предпочтительнее сетевого, даже если язык во втором приоритете', () => {
  const voices = [...windowsRu, v('Microsoft Zira', 'en-US', true)];
  assert.equal(chooseVoice(voices, ['en-gb', 'en-us'], 'en').name, 'Microsoft Zira');
});

test('португальский: локальный pt-PT раньше сетевого pt-BR', () => {
  assert.equal(chooseVoice(windowsRu, ['pt-pt', 'pt-br'], 'pt').name, 'Microsoft Helia');
});

test('нет голоса языка — null', () => {
  assert.equal(chooseVoice([v('Microsoft Irina', 'ru-RU', true)], ['en-gb', 'en-us'], 'en'), null);
});

test('язык вида en_GB тоже распознаётся', () => {
  assert.equal(chooseVoice([v('X', 'en_GB', true)], ['en-gb'], 'en').name, 'X');
});
