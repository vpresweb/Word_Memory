// Экспериментальный режим «25-й кадр»: слово мелькает на доли секунды, затем маска.
// Эффект для запоминания не доказан (см. README) — режим не влияет на прогресс.
// Вспышки не чаще раза в секунду и только в рамке, без засветки всего экрана.
import { shuffle } from './stream.js';

const MASK_MS = 100;
const MASK = '▒▒▒▒▒▒▒▒';

export function createFlash(root, ctx) {
  const $ = (id) => root.querySelector(`#${id}`);
  const consent = $('flash-consent');
  const source = $('flash-source');
  const duration = $('flash-ms');
  const gap = $('flash-gap');
  const withTranslation = $('flash-translation');
  const stage = $('flash-stage');
  const word = $('flash-word');
  const translation = $('flash-translation-text');
  const toggle = $('flash-toggle');
  const counter = $('flash-count');

  let running = false;
  let list = [];
  let index = 0;
  let shown = 0;
  let timer = null;
  let frame = null;

  function syncControls() {
    const s = ctx.settings();
    duration.value = String(s.flashMs);
    gap.value = String(s.flashGap);
    withTranslation.checked = s.flashWithTranslation;
  }

  function rest() {
    stage.classList.remove('flashing');
    word.textContent = '+';
    translation.textContent = '';
  }

  // Показ держится заданное время по часам кадров (requestAnimationFrame), затем маска.
  function flashOnce() {
    if (!running) return;
    if (index >= list.length) {
      // Случайный набор пройден — следующие случайные слова, иначе — тот же набор вперемешку.
      list = source.value === 'random' ? ctx.wordsFor('random') : shuffle(list);
      index = 0;
    }
    const entry = list[index++];
    const ms = Number(duration.value);
    word.textContent = entry.word;
    translation.textContent = withTranslation.checked ? entry.translations.join(', ') : '';
    stage.classList.add('flashing');
    const startTime = performance.now();
    const tick = (time) => {
      if (!running) return;
      // Половина кадра запаса: показ закончится на ближайшем к заданному времени кадре.
      if (time - startTime < ms - 8) {
        frame = requestAnimationFrame(tick);
        return;
      }
      stage.classList.remove('flashing');
      word.textContent = MASK;
      translation.textContent = '';
      timer = setTimeout(() => {
        rest();
        shown += 1;
        counter.textContent = `Вспышек: ${shown}`;
        if (running) timer = setTimeout(flashOnce, Number(gap.value) * 1000);
      }, MASK_MS);
    };
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (!consent.checked) return;
    list = shuffle(ctx.wordsFor(source.value));
    if (!list.length) {
      counter.textContent = 'В этом наборе пока нет слов — выберите другой.';
      return;
    }
    running = true;
    index = 0;
    shown = 0;
    toggle.textContent = 'Остановить';
    rest();
    timer = setTimeout(flashOnce, 1000);
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    rest();
    toggle.textContent = 'Запустить';
  }

  consent.addEventListener('change', () => {
    toggle.disabled = !consent.checked;
    if (!consent.checked) stop();
  });
  toggle.addEventListener('click', () => (running ? stop() : start()));
  const persist = () => {
    ctx.saveSettings({ flashMs: Number(duration.value), flashGap: Number(gap.value), flashWithTranslation: withTranslation.checked });
  };
  duration.addEventListener('change', persist);
  gap.addEventListener('change', persist);
  withTranslation.addEventListener('change', persist);
  // Вкладка скрыта — вспышки останавливаются.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  return { stop, syncControls, reset: () => { stop(); counter.textContent = ''; } };
}
