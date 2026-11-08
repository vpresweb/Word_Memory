// Занятие: сначала повторения на сегодня, затем знакомство с новыми словами (быстрый поток)
// и карточки «вспомни → проверь → оцени». Оценка решает, когда слово вернётся.
import { newCard, review, previewIntervals, formatInterval, isLearning, GRADES } from './srs.js';
import { wordId, dueWords, freshWords, pickNext, dayKey, endOfDay, markDay } from './session.js';
import { entryMeta, escapeHtml } from './data.js';
import { speak, stopSpeech } from './speech.js';

function wordHtml(entry, className = 'word') {
  return `<span class="${className} speak" data-word title="Прослушать">${escapeHtml(entry.word)}</span>`;
}

function exampleHtml(entry) {
  if (!entry.example) return '';
  return `<span class="example"><span class="speak">${escapeHtml(entry.example.text)}</span> — ${escapeHtml(entry.example.ru)}</span>`;
}

const translationText = (entry) => entry.translations.join(', ');

// Когда вернётся слово — для экрана «на сегодня всё».
export function nextDueText(progress, now) {
  const dues = Object.values(progress.cards).filter((c) => c.state !== 'new').map((c) => c.due);
  if (!dues.length) return '';
  const next = Math.min(...dues);
  if (next <= now) return 'Есть слова к повторению.';
  if (next <= endOfDay(now)) return `Следующее повторение — сегодня в ${new Date(next).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`;
  if (next <= endOfDay(now + 86_400_000)) return 'Следующее повторение — завтра.';
  return `Следующее повторение — ${new Date(next).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.`;
}

// ctx: { get() → { words, progress, settings }, save(), onExit() }
export function createSession(root, ctx) {
  const $ = (id) => root.querySelector(`#${id}`);
  const left = $('session-left');
  const intro = $('intro');
  const introCard = $('intro-card');
  const introProgress = $('intro-progress');
  const introPause = $('intro-pause');
  const reviewBox = $('review');
  const front = $('card-front');
  const back = $('card-back');
  const revealButton = $('reveal');
  const grades = $('grades');
  const done = $('session-done');

  let queue = [];
  let waiting = [];
  let fresh = new Set();
  let introDone = true;
  let current = null;
  let reverse = false;
  let revealed = false;
  let reviewed = 0;
  let active = false;
  const introState = { list: [], index: 0, round: 1, timer: null, paused: false };

  const show = (part) => {
    intro.hidden = part !== 'intro';
    reviewBox.hidden = part !== 'review';
    done.hidden = part !== 'done';
  };

  function updateLeft() {
    const count = queue.length + waiting.length + (current ? 1 : 0);
    left.textContent = count ? `Осталось карточек: ${count}` : '';
  }

  function start() {
    const now = Date.now();
    const { words, progress, settings } = ctx.get();
    const due = dueWords(words, progress, now);
    const freshList = freshWords(words, progress, settings.newPerDay, now);
    queue = [...due, ...freshList];
    waiting = [];
    fresh = new Set(freshList.map(wordId));
    introDone = settings.introSeconds <= 0 || !freshList.length;
    current = null;
    reviewed = 0;
    active = true;
    next();
  }

  function stop() {
    active = false;
    clearTimeout(introState.timer);
    stopSpeech();
  }

  function next() {
    current = null;
    const pick = pickNext(queue, waiting, Date.now());
    if (!pick) {
      finish();
      return;
    }
    if (pick.from === 'queue' && !introDone && fresh.has(wordId(pick.entry))) {
      runIntro(queue.filter((e) => fresh.has(wordId(e))));
      return;
    }
    if (pick.from === 'queue') queue.shift();
    else waiting = waiting.filter((w) => w.entry !== pick.entry);
    current = pick.entry;
    renderCard();
  }

  function renderCard() {
    const { settings } = ctx.get();
    reverse = settings.direction === 'reverse' || (settings.direction === 'mixed' && Math.random() < 0.5);
    revealed = false;
    const meta = `<span class="meta">${escapeHtml(entryMeta(current))}</span>`;
    const translation = `<span class="translation">${escapeHtml(translationText(current))}</span>`;
    front.innerHTML = reverse ? `${translation}${meta}` : `${wordHtml(current)}${meta}`;
    back.innerHTML = `${reverse ? wordHtml(current) : translation}${exampleHtml(current)}`;
    back.hidden = true;
    grades.hidden = true;
    revealButton.hidden = false;
    show('review');
    updateLeft();
    revealButton.focus({ preventScroll: true });
    if (!reverse && settings.autospeak) speak(current.word, front.querySelector('[data-word]'));
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    back.hidden = false;
    revealButton.hidden = true;
    const now = Date.now();
    const { progress, settings } = ctx.get();
    const card = progress.cards[wordId(current)] ?? newCard(now);
    const intervals = previewIntervals(card, now);
    for (const g of GRADES) grades.querySelector(`[data-grade="${g}"] small`).textContent = formatInterval(intervals[g]);
    grades.hidden = false;
    // Фокус на кнопки оценки не переводим: отпущенный пробел нажал бы «Хорошо» сам.
    revealButton.blur();
    if (reverse && settings.autospeak) speak(current.word, back.querySelector('[data-word]'));
  }

  function grade(value) {
    if (!current || !revealed) return;
    const now = Date.now();
    const { progress } = ctx.get();
    const id = wordId(current);
    const card = progress.cards[id] ?? { ...newCard(now), added: dayKey(now) };
    const updated = review(card, value, now);
    progress.cards[id] = updated;
    markDay(progress, now);
    ctx.save();
    reviewed += 1;
    // Слова на этапе изучения возвращаются в это же занятие через минуты.
    if (isLearning(updated) && updated.due <= endOfDay(now)) waiting.push({ entry: current, due: updated.due });
    next();
  }

  // Знакомство: новые слова идут потоком — слово, перевод, произношение.
  function runIntro(list) {
    Object.assign(introState, { list, index: 0, round: 1, paused: false });
    introPause.textContent = 'Пауза';
    show('intro');
    left.textContent = `Новых слов: ${list.length}`;
    introStep();
  }

  function introStep() {
    clearTimeout(introState.timer);
    const { list, index, round } = introState;
    const { settings } = ctx.get();
    const entry = list[index];
    introCard.innerHTML = `${wordHtml(entry)}<span class="meta">${escapeHtml(entryMeta(entry))}</span>
      <span class="translation">${escapeHtml(translationText(entry))}</span>${exampleHtml(entry)}`;
    introProgress.textContent = `${index + 1} из ${list.length} · круг ${round} из ${settings.introRounds}`;
    if (settings.autospeak) speak(entry.word, introCard.querySelector('[data-word]'));
    if (!introState.paused) introState.timer = setTimeout(introAdvance, settings.introSeconds * 1000);
  }

  function introAdvance() {
    const { settings } = ctx.get();
    introState.index += 1;
    if (introState.index >= introState.list.length) {
      introState.index = 0;
      introState.round += 1;
      if (introState.round > settings.introRounds) {
        endIntro();
        return;
      }
    }
    introStep();
  }

  function endIntro() {
    clearTimeout(introState.timer);
    introDone = true;
    next();
  }

  function toggleIntroPause() {
    introState.paused = !introState.paused;
    introPause.textContent = introState.paused ? 'Продолжить' : 'Пауза';
    if (introState.paused) clearTimeout(introState.timer);
    else introStep();
  }

  function finish() {
    active = false;
    current = null;
    left.textContent = '';
    const { progress } = ctx.get();
    const now = Date.now();
    done.innerHTML = `
      <p class="word">${reviewed ? 'На сегодня всё' : 'Сейчас повторять нечего'}</p>
      <p>${reviewed ? `Карточек в занятии: ${reviewed}.` : ''} ${escapeHtml(nextDueText(progress, now))}</p>
      <button type="button" class="primary" id="session-back">К статистике</button>`;
    show('done');
    done.querySelector('#session-back').addEventListener('click', ctx.onExit);
  }

  revealButton.addEventListener('click', reveal);
  grades.addEventListener('click', (event) => {
    const button = event.target.closest('[data-grade]');
    if (button) grade(Number(button.dataset.grade));
  });
  // Нажатие на карточку тоже открывает ответ (но не на слово — оно озвучивается).
  $('card').addEventListener('click', (event) => {
    if (!event.target.closest('.speak')) reveal();
  });
  introPause.addEventListener('click', toggleIntroPause);
  $('intro-skip').addEventListener('click', endIntro);
  $('session-exit').addEventListener('click', () => {
    stop();
    ctx.onExit();
  });

  document.addEventListener('keydown', (event) => {
    if (!active || root.hidden || event.target.closest?.('select, input, textarea')) return;
    if (!intro.hidden) {
      if (event.key === ' ') {
        event.preventDefault();
        toggleIntroPause();
      }
      return;
    }
    if (reviewBox.hidden) return;
    if ((event.key === ' ' || event.key === 'Enter') && !revealed) {
      event.preventDefault();
      reveal();
    } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      grade(Number(event.key));
    }
  });

  return { start, stop, isActive: () => active };
}
