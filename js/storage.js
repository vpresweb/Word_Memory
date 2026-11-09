// Прогресс и настройки в localStorage браузера. У каждого языка свой прогресс.
// Если хранилище недоступно (приватный режим), всё работает до перезагрузки страницы.

const PROGRESS_KEY = (lang) => `wordmem.v1.progress.${lang}`;
const SETTINGS_KEY = 'wordmem.v1.settings';

export const DEFAULT_SETTINGS = {
  lang: 'en',
  newPerDay: 10,
  check: 'choice', // choice: выбор из 4 вариантов по уровням (levels.js); self: самооценка
  autospeak: true,
  introSeconds: 2.5, // знакомство с новыми словами: сколько секунд на слово
  introRounds: 2,
  streamSeconds: 1.5,
  streamReveal: 'together', // together: слово и перевод сразу; after: перевод через полсекунды
  streamDirection: 'forward', // forward: слово → перевод; reverse: перевод → слово; mixed
  streamSpeak: true,
  streamAudio: false, // аудиорежим потока: перевод вслух, работает в свёрнутой вкладке
  streamRepeat: false,
  flashMs: 40,
  flashGap: 2,
  flashWithTranslation: true,
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function emptyProgress() {
  return { cards: {}, days: [] };
}

// Проверка структуры: из файла резервной копии может прийти что угодно.
export function validProgress(data) {
  if (!data || typeof data !== 'object' || !data.cards || typeof data.cards !== 'object') return false;
  if (!Array.isArray(data.days)) return false;
  return Object.values(data.cards).every(
    (c) => c && typeof c.due === 'number' && typeof c.interval === 'number' && typeof c.state === 'string',
  );
}

export function loadProgress(lang) {
  const data = read(PROGRESS_KEY(lang));
  return validProgress(data) ? data : emptyProgress();
}

export const saveProgress = (lang, progress) => write(PROGRESS_KEY(lang), progress);

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) ?? {}) };
}

export const saveSettings = (settings) => write(SETTINGS_KEY, settings);
