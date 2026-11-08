// Озвучивание через Web Speech API браузера. Взято из словарей Dictionary_English и
// Dicionario_Portugues (с их обходами сбоев Chrome) и обобщено на два языка.
// Любой элемент с классом .speak озвучивается по нажатию.

const VOICES = {
  en: { preferred: ['en-gb', 'en-us'], prefix: 'en', fallback: 'en-GB' },
  pt: { preferred: ['pt-pt', 'pt-br'], prefix: 'pt', fallback: 'pt-PT' },
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
  lang = VOICES[code] ? code : 'en';
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
  document.addEventListener('click', (event) => {
    const element = event.target.closest?.('.speak');
    if (element) speak(element.dataset.speak ?? element.textContent.trim(), element);
  });
  document.addEventListener('keydown', (event) => {
    const element = event.key === 'Enter' && event.target.closest?.('.speak[tabindex]');
    if (element) speak(element.dataset.speak ?? element.textContent.trim(), element);
    else warmUp();
  });
}
