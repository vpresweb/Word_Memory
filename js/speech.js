// Озвучивание через Web Speech API браузера. Взято из словарей Dictionary_English и
// Dicionario_Portugues (с их обходами сбоев Chrome) и обобщено на два языка.
// Любой элемент с классом .speak озвучивается по нажатию.

const VOICES = {
  en: { preferred: ['en-gb', 'en-us'], prefix: 'en', fallback: 'en-GB' },
  pt: { preferred: ['pt-pt', 'pt-br'], prefix: 'pt', fallback: 'pt-PT' },
};

// Если фраза не начала звучать за это время, синтезатор считается зависшим.
const START_TIMEOUT = 2000;

let lang = 'en';
let voice = null;
let onVoiceChange = null;
// Текущая фраза. Ссылка ещё и не даёт сборщику мусора удалить utterance — иначе Chrome
// не присылает end и считает, что речь продолжается.
let active = null;

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const langOf = (v) => v.lang.replace('_', '-').toLowerCase();

function pickVoice() {
  const { preferred, prefix } = VOICES[lang];
  const voices = speechSynthesis.getVoices();
  for (const code of preferred) {
    const found = voices.find((v) => langOf(v) === code);
    if (found) return found;
  }
  return voices.find((v) => langOf(v).startsWith(prefix)) ?? null;
}

export function setSpeechLang(code) {
  lang = VOICES[code] ? code : 'en';
  if (!speechSupported()) return;
  voice = pickVoice();
  onVoiceChange?.(Boolean(voice) || !speechSynthesis.getVoices().length);
}

export function stopSpeech() {
  if (speechSupported()) speechSynthesis.cancel();
  active = null;
}

// retry — повторная попытка после сбоя: сетевые голоса Chrome иногда молча не отвечают.
export function speak(text, element, retry = false) {
  if (!speechSupported() || !text) return;
  voice ??= pickVoice();
  if (active && active.text === text && active.started && !active.ended && speechSynthesis.speaking) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
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
    speechSynthesis.cancel();
    speak(text, element, true);
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
  }, START_TIMEOUT);

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
