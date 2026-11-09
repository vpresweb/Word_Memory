// Точка входа: язык, разделы (Сегодня, Поток, 25-й кадр, Настройки), занятие.
import { LANGUAGES, loadWords } from './data.js';
import { summary, forecast, freshWords, wordsForSource, SOURCES, dayKey } from './session.js';
import { loadProgress, saveProgress, loadSettings, saveSettings, validProgress, emptyProgress } from './storage.js';
import { initSpeech, setSpeechLang, stopSpeech } from './speech.js';
import { createSession, nextDueText } from './learn.js';
import { createStream } from './stream.js';
import { createFlash } from './flash.js';
import { LEVELS, levelOf } from './levels.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['today', 'session', 'stream', 'flash', 'settings'];

const state = { lang: 'en', words: [], progress: emptyProgress(), settings: loadSettings() };

function updateSettings(patch) {
  Object.assign(state.settings, patch);
  saveSettings(state.settings);
}

const save = () => saveProgress(state.lang, state.progress);
const wordsFor = (kind) => wordsForSource(kind, state.words, state.progress, state.settings, Date.now());

const session = createSession($('session-view'), {
  get: () => state,
  save,
  onExit: () => {
    location.hash = '';
    showView('today');
  },
  // Незаконченное занятие здесь не сохраняется (это умеет приложение «Языки»).
  loadState: () => null,
  saveState: () => {},
  clearState: () => {},
});
const stream = createStream($('stream-view'), {
  wordsFor,
  lang: () => state.lang,
  settings: () => state.settings,
  saveSettings: updateSettings,
});
const flash = createFlash($('flash-view'), { wordsFor, settings: () => state.settings, saveSettings: updateSettings });

// --- Разделы -----------------------------------------------------------------

function showView(name) {
  if (name !== 'session') session.stop();
  if (name !== 'stream') stream.stop();
  if (name !== 'flash') flash.stop();
  for (const view of VIEWS) $(`${view}-view`).hidden = view !== name;
  const tab = name === 'session' ? 'today' : name;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (name === 'today') renderToday();
  if (name === 'stream') stream.syncControls();
  if (name === 'flash') flash.syncControls();
  if (name === 'settings') renderSettings();
}

function viewFromHash() {
  const name = location.hash.slice(1);
  return ['stream', 'flash', 'settings'].includes(name) ? name : 'today';
}

window.addEventListener('hashchange', () => showView(viewFromHash()));

// --- Сегодня -----------------------------------------------------------------

function stat(value, label) {
  return `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function dayLabel(offset, now) {
  if (offset === 0) return 'Сегодня';
  if (offset === 1) return 'Завтра';
  return new Date(now + offset * 86_400_000).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderToday() {
  const now = Date.now();
  const s = summary(state.words, state.progress, now);
  const fresh = freshWords(state.words, state.progress, state.settings.newPerDay, now).length;
  $('stats').innerHTML = [
    stat(s.due, 'к повторению сегодня'),
    stat(fresh, 'новых слов сегодня'),
    stat(s.learning, 'в изучении'),
    stat(s.learned, 'запомнено надолго'),
    stat(s.streak, 'дней подряд'),
    stat(`${s.started} / ${s.total}`, 'начато слов'),
  ].join('');
  // Сколько начатых слов на каждом уровне проверки.
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  const ids = new Set(state.words.map((e) => `${e.word}|${e.pos}`));
  for (const [id, card] of Object.entries(state.progress.cards)) if (ids.has(id)) byLevel[levelOf(card)] += 1;
  $('levels-line').textContent = state.settings.check === 'self' || !s.started
    ? ''
    : `По уровням: ${Object.entries(LEVELS).map(([n, l]) => `${n}. ${l.name.toLowerCase()} — ${byLevel[n]}`).join(' · ')}`;

  const start = $('start');
  const work = s.due + fresh;
  start.disabled = !work;
  start.textContent = work ? `Начать занятие · ${work}` : 'Начать занятие';
  $('start-hint').textContent = work ? '' : `На сегодня всё. ${nextDueText(state.progress, now)}`;

  const days = forecast(state.progress, now);
  const max = Math.max(1, ...days);
  $('forecast').innerHTML = days
    .map((n, i) => `<li><span class="day">${dayLabel(i, now)}</span>
      <span class="bar" style="width:${(n / max) * 100}%"></span><span class="num">${n}</span></li>`)
    .join('');
}

$('start').addEventListener('click', () => {
  showView('session');
  session.start();
});

// --- Настройки ---------------------------------------------------------------

function renderSettings() {
  $('set-new').value = String(state.settings.newPerDay);
  $('set-check').value = state.settings.check;
  $('set-order').value = state.settings.cardOrder ?? 'random';
  $('set-intro').value = String(state.settings.introSeconds);
  $('set-autospeak').checked = state.settings.autospeak;
  $('backup-status').textContent = '';
}

$('set-new').addEventListener('change', (e) => updateSettings({ newPerDay: Number(e.target.value) }));
$('set-check').addEventListener('change', (e) => updateSettings({ check: e.target.value }));
$('set-order').addEventListener('change', (e) => updateSettings({ cardOrder: e.target.value }));
$('set-intro').addEventListener('change', (e) => updateSettings({ introSeconds: Number(e.target.value) }));
$('set-autospeak').addEventListener('change', (e) => updateSettings({ autospeak: e.target.checked }));

$('export').addEventListener('click', () => {
  const data = { app: 'Word_Memory', version: 1, lang: state.lang, exported: new Date().toISOString(), progress: state.progress };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `word-memory-${state.lang}-${dayKey(Date.now())}.json` });
  a.click();
  URL.revokeObjectURL(url);
  $('backup-status').textContent = 'Копия сохранена в папку загрузок.';
});

$('import').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const status = $('backup-status');
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'Word_Memory' || !LANGUAGES[data.lang] || !validProgress(data.progress)) throw new Error('format');
    saveProgress(data.lang, data.progress);
    if (data.lang === state.lang) state.progress = data.progress;
    status.textContent = `Прогресс загружен (${LANGUAGES[data.lang].label.toLowerCase()} язык, слов: ${Object.keys(data.progress.cards).length}).`;
  } catch {
    status.textContent = 'Не получилось прочитать файл: это не копия прогресса этого приложения.';
  }
});

// Сброс в два нажатия вместо confirm().
let resetArmed = null;
$('reset').addEventListener('click', () => {
  const button = $('reset');
  const label = 'Сбросить прогресс этого языка';
  if (!resetArmed) {
    button.textContent = 'Нажмите ещё раз — прогресс удалится без возможности вернуть';
    resetArmed = setTimeout(() => {
      resetArmed = null;
      button.textContent = label;
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  button.textContent = label;
  state.progress = emptyProgress();
  save();
  $('backup-status').textContent = 'Прогресс сброшен.';
});

// --- Язык --------------------------------------------------------------------

function fillSources() {
  const options = Object.entries(SOURCES).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  $('stream-source').innerHTML = options;
  $('flash-source').innerHTML = options;
}

async function setLang(lang) {
  session.stop();
  stream.reset();
  flash.reset();
  stopSpeech();
  state.lang = LANGUAGES[lang] ? lang : 'en';
  updateSettings({ lang: state.lang });
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.lang === state.lang));
  });
  setSpeechLang(state.lang);
  const status = $('status');
  status.textContent = 'Загрузка слов…';
  try {
    state.words = await loadWords(state.lang);
    state.progress = loadProgress(state.lang);
    status.textContent = '';
  } catch (error) {
    status.textContent = `${error.message}. Обновите страницу.`;
    return;
  }
  const view = viewFromHash();
  showView(view);
}

document.querySelector('.lang-switch').addEventListener('click', (event) => {
  const button = event.target.closest('[data-lang]');
  if (button && button.dataset.lang !== state.lang) setLang(button.dataset.lang);
});

// --- Запуск ------------------------------------------------------------------

initSpeech((found) => {
  const note = $('voice-note');
  note.hidden = found;
  note.textContent = found
    ? ''
    : `В системе не найден голос для языка «${LANGUAGES[state.lang].label.toLowerCase()}» — слова прочитает голос по умолчанию. Голос можно установить в настройках речи системы.`;
});
fillSources();
setLang(state.settings.lang);

// Если занятие открыто, а день сменился или вкладка вернулась — обновить «Сегодня».
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('today-view').hidden) renderToday();
});
