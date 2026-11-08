// Быстрый поток: слова одно за другим с переводом и произношением.
// Пассивный режим — на интервалы повторения не влияет.
import { escapeHtml } from './data.js';
import { speak, stopSpeech } from './speech.js';

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ctx: { wordsFor(kind) → entries, settings(), saveSettings() }
export function createStream(root, ctx) {
  const $ = (id) => root.querySelector(`#${id}`);
  const source = $('stream-source');
  const speed = $('stream-speed');
  const revealMode = $('stream-reveal');
  const speakBox = $('stream-speak');
  const word = $('stream-word');
  const translation = $('stream-translation');
  const toggle = $('stream-toggle');
  const counter = $('stream-count');

  let running = false;
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
    speakBox.checked = s.streamSpeak;
  }

  function step() {
    if (!running) return;
    if (index >= list.length) {
      list = shuffle(list);
      index = 0;
    }
    const entry = list[index++];
    const ms = Number(speed.value) * 1000;
    word.innerHTML = `<span class="speak">${escapeHtml(entry.word)}</span>`;
    const text = escapeHtml(entry.translations.join(', '));
    if (revealMode.value === 'after') {
      translation.textContent = '';
      timers.push(setTimeout(() => { translation.innerHTML = text; }, Math.min(500, ms / 2)));
    } else {
      translation.innerHTML = text;
    }
    if (speakBox.checked) speak(entry.word, word.firstElementChild);
    shown += 1;
    counter.textContent = `Показано слов: ${shown} · в наборе: ${list.length}`;
    timers.push(setTimeout(step, ms));
  }

  function start() {
    list = shuffle(ctx.wordsFor(source.value));
    if (!list.length) {
      counter.textContent = 'В этом наборе пока нет слов — выберите другой.';
      return;
    }
    running = true;
    index = 0;
    shown = 0;
    toggle.textContent = 'Пауза';
    step();
  }

  function stop() {
    running = false;
    clearTimers();
    stopSpeech();
    toggle.textContent = 'Запустить';
  }

  toggle.addEventListener('click', () => (running ? stop() : start()));
  source.addEventListener('change', () => {
    if (running) {
      stop();
      start();
    }
  });
  const persist = () => {
    ctx.saveSettings({ streamSeconds: Number(speed.value), streamReveal: revealMode.value, streamSpeak: speakBox.checked });
  };
  speed.addEventListener('change', persist);
  revealMode.addEventListener('change', persist);
  speakBox.addEventListener('change', persist);

  return { stop, syncControls, reset: () => { stop(); word.textContent = ''; translation.textContent = ''; counter.textContent = ''; } };
}
