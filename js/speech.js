// Озвучивание через Web Speech API браузера — общее для словаря, теста и запоминания слов.
// Язык (английский или португальский) задаёт setSpeechLang(); русский — для перевода в аудиопотоке.
// Любой элемент с классом .speak озвучивается по нажатию.

const VOICES = {
  en: { preferred: ['en-gb', 'en-us'], prefix: 'en', fallback: 'en-GB' },
  pt: { preferred: ['pt-pt', 'pt-br'], prefix: 'pt', fallback: 'pt-PT' },
  // Русский — для перевода в аудиопотоке.
  ru: { preferred: ['ru-ru'], prefix: 'ru', fallback: 'ru-RU' },
};

// Если фраза не начала звучать за это время, синтезатор считается зависшим.
// Сетевым голосам (Google …) нужно больше: первый запрос к серверу идёт 2–4 секунды.
const START_TIMEOUT_LOCAL = 2000;
const START_TIMEOUT_NETWORK = 5000;
// Chrome молча теряет фразу, отправленную сразу после cancel() (проверено с голосами Google):
// новая фраза уходит с небольшой паузой.
const CANCEL_GAP = 120;

let lang = 'en';
let voice = null;
let onVoiceChange = null;
// Текущая фраза. Ссылка ещё и не даёт сборщику мусора удалить utterance — иначе Chrome
// не присылает end и считает, что речь продолжается.
let active = null;
let pendingTimer = null;

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const langOf = (v) => v.lang.replace('_', '-').toLowerCase();

// Локальный голос надёжнее сетевого: отвечает сразу и без интернета.
export function chooseVoice(voices, preferred, prefix) {
  const candidates = [...preferred.map((code) => (v) => langOf(v) === code), (v) => langOf(v).startsWith(prefix)];
  for (const local of [true, false]) {
    for (const matches of candidates) {
      const found = voices.find((v) => matches(v) && Boolean(v.localService) === local);
      if (found) return found;
    }
  }
  return null;
}

function pickVoice() {
  const { preferred, prefix } = VOICES[lang];
  return chooseVoice(speechSynthesis.getVoices(), preferred, prefix);
}

export function setSpeechLang(code) {
  lang = VOICES[code] && code !== 'ru' ? code : 'en';
  if (!speechSupported()) return;
  voice = pickVoice();
  onVoiceChange?.(Boolean(voice) || !speechSynthesis.getVoices().length);
}

export function stopSpeech() {
  clearTimeout(pendingTimer);
  if (speechSupported()) speechSynthesis.cancel();
  active = null;
}

// Если синтезатор занят, прерываем его и отправляем фразу после паузы CANCEL_GAP.
// При быстрых нажатиях прозвучит последняя фраза.
function cancelThen(run) {
  clearTimeout(pendingTimer);
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    pendingTimer = setTimeout(run, CANCEL_GAP);
  } else {
    run();
  }
}

// retry — повторная попытка после сбоя: сетевые голоса Chrome иногда молча не отвечают.
export function speak(text, element, retry = false) {
  if (!speechSupported() || !text) return;
  voice ??= pickVoice();
  if (active && active.text === text && active.started && !active.ended && speechSynthesis.speaking) return;
  cancelThen(() => say(text, element, retry));
}

function say(text, element, retry) {
  // resume() снимает «залипшую» паузу синтезатора после простоя.
  speechSynthesis.resume();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? VOICES[lang].fallback;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;

  const state = { text, element, utterance, started: false, ended: false };
  active = state;
  element?.classList.add('speaking');
  const finish = () => {
    state.ended = true;
    if (element && (active === state || active?.element !== element)) element.classList.remove('speaking');
  };
  const again = () => {
    if (retry || active !== state) return;
    active = null;
    clearTimeout(pendingTimer);
    speechSynthesis.cancel();
    pendingTimer = setTimeout(() => say(text, element, true), CANCEL_GAP);
  };

  utterance.addEventListener('start', () => { state.started = true; });
  utterance.addEventListener('end', finish);
  utterance.addEventListener('error', (event) => {
    finish();
    // interrupted и canceled — это наш собственный cancel(), а не сбой.
    if (event.error !== 'interrupted' && event.error !== 'canceled') again();
  });
  setTimeout(() => {
    if (state.started || state.ended) return;
    finish();
    again();
  }, voice && !voice.localService ? START_TIMEOUT_NETWORK : START_TIMEOUT_LOCAL);

  speechSynthesis.speak(utterance);
}

// Фразы аудиопотока, которые ещё звучат или ждут очереди: ссылка не даёт сборщику мусора
// удалить utterance (иначе Chrome не присылает end).
const queued = new Set();

// Произнести фразу и дождаться её конца. Для аудиопотока, который работает в свёрнутой вкладке:
// там Chrome замедляет таймеры (через 5 минут — до раза в минуту), поэтому следующая фраза
// запускается по событию end синтезатора, а не по таймеру. cancel() не вызывается — фразы
// идут друг за другом. Promise всегда завершается: true — фраза прозвучала.
// language: 'en' | 'pt' | 'ru'.
export function speakAndWait(text, language = lang) {
  return new Promise((resolve) => {
    if (!speechSupported() || !text) {
      resolve(false);
      return;
    }
    const conf = VOICES[language] ?? VOICES[lang];
    const chosen = language === lang ? (voice ??= pickVoice()) : chooseVoice(speechSynthesis.getVoices(), conf.preferred, conf.prefix);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = chosen?.lang ?? conf.fallback;
    if (chosen) utterance.voice = chosen;
    utterance.rate = 0.9;

    let done = false;
    let guard = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      queued.delete(utterance);
      resolve(ok);
    };
    queued.add(utterance);
    utterance.addEventListener('end', () => finish(true));
    utterance.addEventListener('error', () => finish(false));
    // Фраза не началась (телефон не разрешил озвучку, сетевой голос завис) — сбросить
    // синтезатор и идти дальше (после паузы, иначе следующая фраза потеряется, см. CANCEL_GAP).
    const stall = () => {
      speechSynthesis.cancel();
      setTimeout(() => finish(false), CANCEL_GAP);
    };
    guard = setTimeout(stall, chosen && !chosen.localService ? START_TIMEOUT_NETWORK : START_TIMEOUT_LOCAL + 500);
    // Началась — ждём end, но не дольше расчётной длительности (~12 знаков в секунду):
    // на Android Chrome end иногда не приходит. Синтезатор не сбрасываем — если фраза
    // ещё звучит, следующая просто встанет за ней в очередь.
    utterance.addEventListener('start', () => {
      clearTimeout(guard);
      guard = setTimeout(() => finish(true), 700 + text.length * 80);
    });

    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
  });
}

// Разрешить озвучку: мобильные браузеры пускают речь, только если первая фраза произнесена
// прямо в обработчике нажатия. Вызывать синхронно из обработчика клика.
export function unlockSpeech() {
  if (!speechSupported()) return;
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  queued.add(utterance);
  const release = () => queued.delete(utterance);
  utterance.addEventListener('end', release);
  utterance.addEventListener('error', release);
  speechSynthesis.speak(utterance);
}

// onVoice(found) вызывается, когда становится известно, есть ли в системе голос языка.
export function initSpeech(onVoice) {
  onVoiceChange = onVoice;
  if (!speechSupported()) {
    document.documentElement.classList.add('no-speech');
    return;
  }
  const check = () => {
    if (!speechSynthesis.getVoices().length) return;
    voice = pickVoice();
    onVoiceChange?.(Boolean(voice));
  };
  check();
  speechSynthesis.addEventListener('voiceschanged', check);

  // Первое действие пользователя прогревает синтезатор беззвучной фразой:
  // иначе первое слово часто звучит с задержкой.
  let warmed = false;
  const warmUp = () => {
    if (warmed) return;
    warmed = true;
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    speechSynthesis.speak(utterance);
  };
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.speak, button')) warmUp();
  });
  // Варианты формы (learnt / learned) читаются через запятую.
  const textOf = (element) => (element.dataset.speak ?? element.textContent.trim()).replace(/\s*\/\s*/g, ', ');
  document.addEventListener('click', (event) => {
    const element = event.target.closest?.('.speak');
    if (element) speak(textOf(element), element);
  });
  document.addEventListener('keydown', (event) => {
    const element = event.key === 'Enter' && event.target.closest?.('.speak[tabindex]');
    if (element) speak(textOf(element), element);
    else warmUp();
  });
}
