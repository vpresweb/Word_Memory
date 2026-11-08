// Собирает data/en.json и data/pt.json из основной части словарей (без расширенного
// словаря из Викисловаря: там в основном редкая лексика). Порядок слов — как в словарях,
// по частоте, поэтому новые слова идут от самых нужных.
//
// Запуск: node scripts/build-data.mjs [путь к Dictionary_English] [путь к Dicionario_Portugues]
// По умолчанию словари ищутся рядом с этим репозиторием.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [enDir = join(root, '..', 'Dictionary_English'), ptDir = join(root, '..', 'Dicionario_Portugues')] =
  process.argv.slice(2);

const MAX_TRANSLATIONS = 3;

// Оставляем только то, что нужно для запоминания: слово, часть речи, род, переводы, один пример.
export function compact(entry, exampleKey) {
  const out = { word: entry.word, pos: entry.pos, translations: entry.translations.slice(0, MAX_TRANSLATIONS) };
  if (entry.gender) out.gender = entry.gender;
  const example = entry.examples?.[0];
  if (example?.[exampleKey] && example.ru) out.example = { text: example[exampleKey], ru: example.ru };
  return out;
}

async function build(dir, exampleKey, outFile) {
  const entries = JSON.parse(await readFile(join(dir, 'data', 'dictionary.json'), 'utf8'));
  const seen = new Set();
  const words = [];
  for (const entry of entries) {
    if (entry.extra || !entry.translations?.length) continue;
    const id = `${entry.word}|${entry.pos}`;
    if (seen.has(id)) continue;
    seen.add(id);
    words.push(compact(entry, exampleKey));
  }
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data', outFile), JSON.stringify(words));
  console.log(`${outFile}: ${words.length} слов`);
}

await build(enDir, 'en', 'en.json');
await build(ptDir, 'pt', 'pt.json');
