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

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function syncControls() {
    const s = ctx.settings();
    speed.value = String(s.streamSeconds);
    revealMode.value = s.streamReveal;
    directionMode.value = s.streamDirection ?? 'forward';
    speakBox.checked = s.streamSpeak;
    audioBox.checked = s.streamAudio;
    repeatBox.checked = s.streamRepeat;
    updateControls();
  }

  // В аудиорежиме темп задаёт сама речь, а слово всегда произносится.
  function updateControls() {
    const audio = audioBox.checked;
    speed.disabled = audio;
    speakBox.disabled = audio;
    repeatBox.disabled = !audio;
    repeatBox.closest('label').hidden = !audio;
  }

  function nextEntry() {
    if (index >= list.length) {
      list = shuffle(list);
      index = 0;
    }
    return list[index++];
  }

  // Обратный поток: сначала перевод, ответ — слово. «Вперемешку» — случайно для каждого слова.
  const isReverse = () => directionMode.value === 'reverse' || (directionMode.value === 'mixed' && Math.random() < 0.5);

  const wordHtml = (entry) => `<span class="speak">${escapeHtml(entry.word)}</span>`;
  const translationHtml = (entry) => escapeHtml(entry.translations.join(', '));

  // Верхняя строка — то, что надо вспомнить, нижняя — ответ.
  function showWord(entry, reverse, withAnswer) {
    word.innerHTML = reverse ? translationHtml(entry) : wordHtml(entry);
    word.classList.toggle('reverse', reverse);
    translation.innerHTML = withAnswer ? (reverse ? wordHtml(entry) : translationHtml(entry)) : '';
  }

  function showAnswer(entry, reverse) {
    translation.innerHTML = reverse ? wordHtml(entry) : translationHtml(entry);
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
    const ms = Number(speed.value) * 1000;
    const after = revealMode.value === 'after';
    const reverse = isReverse();
    showWord(entry, reverse, !after);
    const delay = Math.min(500, ms / 2);
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
      const after = revealMode.value === 'after';
      const reverse = isReverse();
      showWord(entry, reverse, !after);
      if (silent >= 2) {
        // Два слова подряд не озвучились — дальше без звука, чтобы поток не тормозил.
        if (after) timers.push(setTimeout(() => showAnswer(entry, reverse), 700));
        count();
        counter.textContent += ' · озвучка не отвечает: нажмите «Пауза» и снова «Запустить»';
        await wait(2000);
        continue;
      }
      const sayWord = () => speakAndWait(entry.word, lang);
      const sayTranslation = () => speakAndWait(spokenTranslation(entry), 'ru');
      const firstOk = await (reverse ? sayTranslation() : sayWord());
      if (!alive()) return;
      if (after) showAnswer(entry, reverse);
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
      } else if (!document.hidden) {
        // Короткая пауза между словами — только когда вкладка видна: в свёрнутой вкладке
        // таймер мог бы растянуться до минуты, а паузы между фразами и так есть.
        await wait(400);
      }
    }
  }

  function start() {
    list = shuffle(ctx.wordsFor(source.value));
    if (!list.length) {
      counter.textContent = 'В этом наборе пока нет слов — выберите другой.';
      return;
    }
    running = true;
    run += 1;
    index = 0;
    shown = 0;
    toggle.textContent = 'Пауза';
    if (audioBox.checked) {
      const id = run;
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
    toggle.textContent = 'Запустить';
  }

  const restart = () => {
    if (running) {
      stop();
      start();
    }
  };

  toggle.addEventListener('click', () => (running ? stop() : start()));
  source.addEventListener('change', restart);
  const persist = () => {
    ctx.saveSettings({
      streamSeconds: Number(speed.value),
      streamReveal: revealMode.value,
      streamDirection: directionMode.value,
      streamSpeak: speakBox.checked,
      streamAudio: audioBox.checked,
      streamRepeat: repeatBox.checked,
    });
  };
  speed.addEventListener('change', persist);
  revealMode.addEventListener('change', persist);
  directionMode.addEventListener('change', persist);
  speakBox.addEventListener('change', persist);
  repeatBox.addEventListener('change', persist);
  audioBox.addEventListener('change', () => {
    persist();
    updateControls();
    restart();
  });

  return {
    stop,
    syncControls,
    isRunning: () => running,
    reset: () => {
      stop();
      word.textContent = '';
      translation.textContent = '';
      counter.textContent = '';
    },
  };
}
