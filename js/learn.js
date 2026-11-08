// Занятие: сначала повторения на сегодня, затем знакомство с новыми словами (быстрый поток)
// и карточки. Проверка — выбором из 4 вариантов по уровням (levels.js) или, по настройке,
// самооценкой «вспомни → проверь → оцени». Ответ решает, когда слово вернётся.
import { newCard, review, previewIntervals, formatInterval, isLearning, GRADES } from './srs.js';
import { LEVELS, MAX_LEVEL, PROMOTE_AFTER, levelOf, streakOf, applyAnswer, gradeFor, pickOptions } from './levels.js';
import { wordId, dueWords, freshWords, pickNext, dayKey, endOfDay, markDay, packSession, unpackSession } from './session.js';
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

// ctx: { get() → { words, progress, settings }, save(), onExit(),
//        loadState(), saveState(data), clearState() — незаконченное занятие }
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
  const levelLine = $('level-line');
  const choices = $('choices');
  const recall = $('recall');
  const note = $('answer-note');
  const nextButton = $('next-card');
  const keysHint = $('keys-hint');

  // Проверка выбором: уровень текущего слова, варианты, время показа и ответа.
  let level = 1;
  let options = [];
  let answered = false;
  let shownAt = 0;
  let revealedAt = 0;
  let advanceTimer = null;
  const choiceMode = () => ctx.get().settings.check !== 'self';

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

  // Сохранить, где остановились: после перезагрузки или на другом устройстве занятие продолжится.
  function persist() {
    if (!active) return;
    ctx.saveState(packSession({ queue, waiting, fresh, introDone, reviewed, current }, Date.now()));
  }

  // Что осталось от сохранённого сегодняшнего занятия (null — нечего продолжать).
  function saved() {
    const { words, progress } = ctx.get();
    return unpackSession(ctx.loadState(), words, progress, Date.now());
  }

  // Сколько карточек осталось в незаконченном занятии (0 — его нет).
  function pending() {
    const s = saved();
    return s ? s.queue.length + s.waiting.length : 0;
  }

  // Продолжить незаконченное занятие. false — продолжать нечего.
  function resume() {
    const s = saved();
    if (!s) {
      ctx.clearState();
      return false;
    }
    ({ queue, waiting, introDone, reviewed } = s);
    fresh = new Set(s.fresh);
    current = null;
    active = true;
    next();
    return true;
  }

  function stop() {
    active = false;
    clearTimeout(introState.timer);
    clearTimeout(advanceTimer);
    stopSpeech();
  }

  function next() {
    clearTimeout(advanceTimer);
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
    persist();
  }

  // «Уровень 2 из 3 · Обратный выбор ●●○» — точки: верные ответы подряд на этом уровне.
  function levelHtml(lvl, streak) {
    const dots = lvl < MAX_LEVEL
      ? ` <span class="dots" title="Верных ответов подряд: ${streak} из ${PROMOTE_AFTER}">${'●'.repeat(streak)}${'○'.repeat(PROMOTE_AFTER - streak)}</span>`
      : '';
    return `Уровень ${lvl} из ${MAX_LEVEL} · ${LEVELS[lvl].name}${dots}`;
  }

  function renderCard() {
    const { settings, progress, words } = ctx.get();
    clearTimeout(advanceTimer);
    revealed = false;
    answered = false;
    shownAt = Date.now();
    back.hidden = true;
    grades.hidden = true;
    choices.hidden = true;
    recall.hidden = true;
    nextButton.hidden = true;
    note.textContent = '';
    note.className = 'answer-note';
    const meta = `<span class="meta">${escapeHtml(entryMeta(current))}</span>`;
    const translation = `<span class="translation">${escapeHtml(translationText(current))}</span>`;

    if (!choiceMode()) {
      reverse = settings.direction === 'reverse' || (settings.direction === 'mixed' && Math.random() < 0.5);
      levelLine.textContent = '';
      front.innerHTML = reverse ? `${translation}${meta}` : `${wordHtml(current)}${meta}`;
      back.innerHTML = `${reverse ? wordHtml(current) : translation}${exampleHtml(current)}`;
      revealButton.hidden = false;
      keysHint.textContent = 'Клавиши: пробел — ответ, 1–4 — оценка';
      show('review');
      updateLeft();
      revealButton.focus({ preventScroll: true });
      if (!reverse && settings.autospeak) speak(current.word, front.querySelector('[data-word]'));
      return;
    }

    const card = progress.cards[wordId(current)];
    level = levelOf(card);
    reverse = level > 1;
    levelLine.innerHTML = `${levelHtml(level, streakOf(card))} <span class="task">— ${LEVELS[level].task}</span>`;
    if (level === 1) {
      front.innerHTML = `${wordHtml(current)}${meta}`;
      back.innerHTML = exampleHtml(current);
    } else {
      front.innerHTML = `${translation}${meta}`;
      back.innerHTML = `${wordHtml(current)}${exampleHtml(current)}`;
    }
    if (level < 3) {
      options = pickOptions(current, words);
      choices.innerHTML = options
        .map((e, i) => `<button type="button" data-choice="${i}"${level === 2 ? ' lang="' + escapeHtml(ctx.get().lang ?? '') + '"' : ''}>${escapeHtml(level === 1 ? e.translations.slice(0, 3).join(', ') : e.word)}</button>`)
        .join('');
      choices.hidden = false;
      revealButton.hidden = true;
      keysHint.textContent = 'Клавиши: 1–4 — вариант, Enter — дальше';
    } else {
      revealButton.hidden = false;
      keysHint.textContent = 'Клавиши: пробел — ответ, 1 — не вспомнил, 2 — вспомнил';
    }
    show('review');
    updateLeft();
    if (level === 3) revealButton.focus({ preventScroll: true });
    else document.activeElement?.blur?.();
    if (level === 1 && settings.autospeak) speak(current.word, front.querySelector('[data-word]'));
  }

  // Ответ выбором (уровни 1 и 2).
  function choose(index) {
    if (!current || answered || level >= 3 || !options[index]) return;
    const correct = wordId(options[index]) === wordId(current);
    choices.querySelectorAll('[data-choice]').forEach((button, j) => {
      button.disabled = true;
      if (wordId(options[j]) === wordId(current)) button.classList.add('right');
      else if (j === index) button.classList.add('wrong');
    });
    back.hidden = !back.innerHTML;
    if (level === 2 && ctx.get().settings.autospeak) speak(current.word, back.querySelector('[data-word]'));
    answer(correct, Date.now() - shownAt);
  }

  // Ответ на 3-м уровне: «Вспомнил» / «Не вспомнил» после открытого ответа.
  function recallAnswer(remembered) {
    if (!current || answered || level !== 3 || !revealed) return;
    answer(remembered, revealedAt - shownAt);
  }

  // Записать ответ: уровень и серия слова, интервал по алгоритму повторения.
  function answer(correct, ms) {
    answered = true;
    const now = Date.now();
    const { progress } = ctx.get();
    const entry = current;
    const id = wordId(entry);
    const card = progress.cards[id] ?? { ...newCard(now), added: dayKey(now) };
    const result = applyAnswer(card, correct);
    const updated = { ...review(card, gradeFor(correct, ms), now), level: result.level, streak: result.streak };
    progress.cards[id] = updated;
    markDay(progress, now);
    ctx.save();
    reviewed += 1;
    if (isLearning(updated) && updated.due <= endOfDay(now)) waiting.push({ entry, due: updated.due });
    // Слово отвечено: при перезагрузке на этой странице оно не должно показаться снова.
    current = null;
    persist();
    current = entry;

    levelLine.innerHTML = levelHtml(result.level, result.streak);
    recall.hidden = true;
    let text = correct ? '✓ Верно' : '✗ Неверно';
    if (!correct && level < 3) text += ' — правильный ответ выделен';
    if (result.promoted) text += ` · Новый уровень: ${LEVELS[result.level].name.toLowerCase()}!`;
    if (result.demoted) text += ` · Слово вернулось на уровень ${result.level}`;
    note.textContent = text;
    note.className = `answer-note ${correct ? 'ok' : 'no'}`;
    if (level === 3 && correct && !result.promoted) {
      next();
      return;
    }
    nextButton.hidden = false;
    // Верный ответ — дальше само через секунду; неверный — дать рассмотреть.
    if (correct) advanceTimer = setTimeout(() => { if (active && answered) next(); }, result.promoted ? 2000 : 1100);
  }

  function reveal() {
    if (!current || revealed) return;
    if (choiceMode()) {
      if (level !== 3 || answered) return;
      revealed = true;
      revealedAt = Date.now();
      back.hidden = false;
      revealButton.hidden = true;
      recall.hidden = false;
      revealButton.blur();
      if (ctx.get().settings.autospeak) speak(current.word, back.querySelector('[data-word]'));
      return;
    }
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
    if (!current || !revealed || choiceMode()) return;
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
    persist();
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
    ctx.clearState();
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
  choices.addEventListener('click', (event) => {
    const button = event.target.closest('[data-choice]');
    if (button) choose(Number(button.dataset.choice));
  });
  recall.addEventListener('click', (event) => {
    const button = event.target.closest('[data-recall]');
    if (button) recallAnswer(button.dataset.recall === '1');
  });
  nextButton.addEventListener('click', () => {
    if (answered) next();
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
    if (choiceMode()) {
      const key = event.key;
      if (answered && (key === 'Enter' || key === ' ')) {
        event.preventDefault();
        next();
      } else if (!answered && level < 3 && ['1', '2', '3', '4'].includes(key)) {
        event.preventDefault();
        choose(Number(key) - 1);
      } else if (!answered && level === 3 && !revealed && (key === ' ' || key === 'Enter')) {
        event.preventDefault();
        reveal();
      } else if (!answered && level === 3 && revealed && (key === '1' || key === '2')) {
        event.preventDefault();
        recallAnswer(key === '2');
      }
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && !revealed) {
      event.preventDefault();
      reveal();
    } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      grade(Number(event.key));
    }
  });

  return { start, resume, pending, stop, isActive: () => active };
}
