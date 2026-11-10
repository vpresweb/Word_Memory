// Быстрый поток: слова одно за другим с переводом и произношением — прямой (слово → перевод),
// обратный (перевод → слово) или вперемешку.
// Пассивный режим — на интервалы повторения не влияет.
//
// Два режима:
// - обычный: слово на экране N секунд, смена по таймеру;
// - аудио: слово произносится, затем русский перевод, затем следующее слово. Смена идёт по
//   событию «фраза дозвучала», а не по таймеру, поэтому поток продолжает звучать, когда вкладка
//   свёрнута или открыта другая программа (таймеры свёрнутых вкладок Chrome замедляет).
import { escapeHtml } from './data.js';
import { mnemonicHtml } from './mnemonics.js';
import { speak, speakAndWait, stopSpeech, unlockSpeech, speechSupported } from './speech.js';

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Перевод для чтения вслух: первые два значения.
export const spokenTranslation = (entry) => entry.translations.slice(0, 2).join(', ');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// iPhone, iPad (в том числе iPad, который называет себя Mac).
const isIOS = typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// ctx: { wordsFor(kind) → entries, lang() → 'en' | 'pt', settings(), saveSettings() }
export function createStream(root, ctx) {
  const $ = (id) => root.querySelector(`#${id}`);
  const source = $('stream-source');
  const speed = $('stream-speed');
  const revealMode = $('stream-reveal');
  const directionMode = $('stream-direction');
  const speakBox = $('stream-speak');
  const audioBox = $('stream-audio');
  const repeatBox = $('stream-repeat');
  const mnemonicBox = $('stream-mnemonic');
  const word = $('stream-word');
  const translation = $('stream-translation');
  const toggle = $('stream-toggle');
  const counter = $('stream-count');

  let running = false;
  let run = 0; // номер запуска: старый цикл аудио видит, что его остановили
  let list = [];
  let index = 0;
  let shown = 0;
  let timers = [];

  // Шкала «Время на слово»: 0,5–5 с с шагом 0,5; подпись рядом со шкалой.
  const speedLabel = $('stream-speed-value');
  function showSpeed() {
    if (speedLabel) speedLabel.textContent = `${String(Number(speed.value)).replace('.', ',')} с`;
  }

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function syncControls() {
    const s = ctx.settings();
    speed.value = String(s.streamSeconds);
    showSpeed();
    revealMode.value = s.streamReveal;
    directionMode.value = s.streamDirection ?? 'forward';
    speakBox.checked = s.streamSpeak;
    audioBox.checked = s.streamAudio;
    repeatBox.checked = s.streamRepeat;
    if (mnemonicBox) mnemonicBox.checked = s.streamMnemonic !== false;
    updateControls();
  }

  // В аудиорежиме слово всегда произносится, а шкала задаёт паузу после перевода.
  function updateControls() {
    const audio = audioBox.checked;
    speakBox.disabled = audio;
    repeatBox.disabled = !audio;
    repeatBox.closest('label').hidden = !audio;
  }

  function nextEntry() {
    if (index >= list.length) {
      // Случайный набор пройден — следующие случайные слова, иначе — тот же набор вперемешку.
      list = source.value === 'random' ? ctx.wordsFor('random') : shuffle(list);
      index = 0;
    }
    return list[index++];
  }

  // Через сколько миллисекунд показать ответ: «сразу» — 0, «after» (прежнее значение) — 0,5 с,
  // числа — секунды.
  const revealDelay = () => {
    const v = revealMode.value;
    if (v === 'together') return 0;
    if (v === 'after') return 500;
    return (Number(v) || 0.5) * 1000;
  };

  // Тишина нужной длины через <audio>: в свёрнутой вкладке таймеры браузер замедляет,
  // а проигрывание звука — нет. Если звук не заиграл, обычная пауза.
  const silenceUrls = new Map();
  let silencePlayer = null;
  function silenceUrl(ms) {
    if (silenceUrls.has(ms)) return silenceUrls.get(ms);
    const rate = 8000, n = Math.round((rate * ms) / 1000);
    const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128); // 8-битная тишина
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    silenceUrls.set(ms, url);
    return url;
  }
  // Разблокировать плеер нажатием «Запустить» (иначе телефон не даст играть звук позже).
  function unlockSilence() {
    // На iPhone/iPad проигрывание <audio> перехватывает звук у синтезатора речи — озвучка
    // не начинается. Там паузы — обычным таймером.
    if (isIOS) {
      silencePlayer = null;
      return;
    }
    try {
      silencePlayer = silencePlayer || new Audio();
      silencePlayer.src = silenceUrl(100);
      silencePlayer.play().catch(() => {});
    } catch { silencePlayer = null; }
  }
  async function pause(ms) {
    if (ms <= 0) return;
    if (silencePlayer) {
      try {
        silencePlayer.src = silenceUrl(ms);
        await new Promise((resolve, reject) => {
          silencePlayer.onended = resolve;
          silencePlayer.onerror = reject;
          silencePlayer.play().catch(reject);
        });
        return;
      } catch { /* не заиграло — ниже обычная пауза */ }
    }
    await wait(ms);
  }

  // Обратный поток: сначала перевод, ответ — слово. «Вперемешку» — случайно для каждого слова.
  const isReverse = () => directionMode.value === 'reverse' || (directionMode.value === 'mixed' && Math.random() < 0.5);

  const wordHtml = (entry) => `<span class="speak">${escapeHtml(entry.word)}</span>`;
  const translationHtml = (entry) => escapeHtml(entry.translations.join(', '));

  // Ответ, под ним ассоциация (если включена) — вместе с ответом, чтобы не подсказывать.
  const answerHtml = (entry, reverse) =>
    (reverse ? wordHtml(entry) : translationHtml(entry)) + (mnemonicBox?.checked ? mnemonicHtml(entry, 'span') : '');

  // Верхняя строка — то, что надо вспомнить, нижняя — ответ.
  function showWord(entry, reverse, withAnswer) {
    word.innerHTML = reverse ? translationHtml(entry) : wordHtml(entry);
    word.classList.toggle('reverse', reverse);
    translation.innerHTML = withAnswer ? answerHtml(entry, reverse) : '';
  }

  function showAnswer(entry, reverse) {
    translation.innerHTML = answerHtml(entry, reverse);
  }

  // Элемент, где сейчас слово, — для подсветки при произношении.
  const wordElement = () => word.querySelector('.speak') ?? translation.querySelector('.speak');

  function count() {
    shown += 1;
    counter.textContent = `Показано слов: ${shown} · в наборе: ${list.length}`;
  }

  // Обычный режим: смена по таймеру.
  function step() {
    if (!running) return;
    const entry = nextEntry();
    const delay = revealDelay();
    const after = delay > 0;
    // Ответ после задержки виден ещё не меньше секунды.
    const ms = Math.max(Number(speed.value) * 1000, delay + 1000);
    const reverse = isReverse();
    showWord(entry, reverse, !after);
    if (after) timers.push(setTimeout(() => showAnswer(entry, reverse), delay));
    if (speakBox.checked) {
      // В обратном потоке слово звучит вместе с ответом, а не раньше — иначе подсказка.
      if (reverse && after) timers.push(setTimeout(() => speak(entry.word, wordElement()), delay));
      else speak(entry.word, wordElement());
    }
    count();
    timers.push(setTimeout(step, ms));
  }

  // Аудиорежим: слово → перевод по-русски → (слово ещё раз) → следующее.
  // Обратный: перевод по-русски → слово → (слово ещё раз).
  async function audioLoop(id) {
    const alive = () => running && run === id;
    const lang = ctx.lang();
    let silent = 0; // сколько слов подряд не удалось озвучить
    while (alive()) {
      const entry = nextEntry();
      const delay = revealDelay();
      const after = delay > 0;
      const reverse = isReverse();
      showWord(entry, reverse, !after);
      if (silent >= 2) {
        // Два слова подряд не озвучились — дальше без звука, чтобы поток не тормозил.
        // Ответ — строго после своего слова (раньше таймер ответа мог сработать уже на следующем
        // слове и показать чужой перевод), затем пауза по шкале «Время на слово».
        count();
        counter.textContent += ' · озвучка не отвечает: нажмите «Пауза» и снова «Запустить»';
        if (after) {
          await pause(delay);
          if (!alive()) return;
          showAnswer(entry, reverse);
        }
        await pause(Math.max(1000, Number(speed.value) * 1000));
        if (!alive()) return;
        continue;
      }
      const sayWord = () => speakAndWait(entry.word, lang);
      const sayTranslation = () => speakAndWait(spokenTranslation(entry), 'ru');
      const firstOk = await (reverse ? sayTranslation() : sayWord());
      if (!alive()) return;
      // Время вспомнить: тишина перед ответом (при «сразу» — без паузы).
      if (after) {
        await pause(delay);
        if (!alive()) return;
        showAnswer(entry, reverse);
      }
      const secondOk = await (reverse ? sayWord() : sayTranslation());
      if (!alive()) return;
      const [wordOk, translationOk] = [firstOk, secondOk];
      if (repeatBox.checked) {
        await speakAndWait(entry.word, lang);
        if (!alive()) return;
      }
      count();
      silent = wordOk || translationOk ? 0 : silent + 1;
      if (silent) {
        // Озвучка не работает — поток всё равно идёт, но с паузой, чтобы слово успели прочитать.
        counter.textContent += ' · озвучка не отвечает';
        await wait(1500);
      } else {
        // Время на осмысление после перевода — по шкале «Время на слово». Тишина идёт через
        // <audio>, поэтому не растягивается и в свёрнутой вкладке.
        await pause(Number(speed.value) * 1000);
      }
    }
  }

  // fresh — начать набор заново; иначе (после паузы или возврата на вкладку) — с того же места.
  let listSource = null;
  function start(fresh = false) {
    if (fresh || !list.length || listSource !== source.value) {
      list = shuffle(ctx.wordsFor(source.value));
      listSource = source.value;
      index = 0;
      shown = 0;
    } else if (index > 0) {
      // Продолжение: слово, которое было на экране, показать ещё раз.
      index -= 1;
      shown = Math.max(0, shown - 1);
    }
    if (!list.length) {
      counter.textContent = 'В этом наборе пока нет слов — выберите другой.';
      return;
    }
    running = true;
    run += 1;
    toggle.textContent = 'Пауза';
    if (audioBox.checked) {
      const id = run;
      unlockSilence(); // паузы аудиорежима — тишина через <audio>
      if (speechSupported() && (speechSynthesis.speaking || speechSynthesis.pending)) {
        // Остановить то, что звучало, и начать с паузой (иначе Chrome потеряет первую фразу).
        stopSpeech();
        unlockSpeech();
        timers.push(setTimeout(() => audioLoop(id), 150));
      } else {
        // Первая фраза — прямо в обработчике нажатия: иначе телефон не разрешит озвучку.
        unlockSpeech();
        audioLoop(id);
      }
    } else {
      step();
    }
  }

  function stop() {
    running = false;
    run += 1;
    clearTimers();
    stopSpeech();
    if (silencePlayer) {
      silencePlayer.pause();
      silencePlayer.onended?.(); // отпустить ожидающую паузу — цикл увидит остановку и выйдет
    }
    toggle.textContent = 'Запустить';
  }

  const restart = () => {
    if (running) {
      stop();
      start(true);
    } else list = [];
  };

  // Уход на другую вкладку — поток замирает; при возврате продолжается, если шёл.
  let wasRunning = false;
  function suspend() {
    if (!running) return;
    wasRunning = true;
    stop();
  }
  function wake() {
    if (!wasRunning) return;
    wasRunning = false;
    start();
  }

  toggle.addEventListener('click', () => {
    wasRunning = false;
    if (running) stop();
    else start();
  });
  source.addEventListener('change', restart);
  const persist = () => {
    ctx.saveSettings({
      streamSeconds: Number(speed.value),
      streamReveal: revealMode.value,
      streamDirection: directionMode.value,
      streamSpeak: speakBox.checked,
      streamAudio: audioBox.checked,
      streamRepeat: repeatBox.checked,
      streamMnemonic: mnemonicBox ? mnemonicBox.checked : true,
    });
  };
  speed.addEventListener('change', persist);
  speed.addEventListener('input', showSpeed);
  revealMode.addEventListener('change', persist);
  directionMode.addEventListener('change', persist);
  speakBox.addEventListener('change', persist);
  repeatBox.addEventListener('change', persist);
  mnemonicBox?.addEventListener('change', persist);
  audioBox.addEventListener('change', () => {
    persist();
    updateControls();
    restart();
  });

  return {
    stop,
    suspend,
    wake,
    syncControls,
    isRunning: () => running,
    reset: () => {
      stop();
      wasRunning = false;
      list = [];
      word.textContent = '';
      translation.textContent = '';
      counter.textContent = '';
    },
  };
}
