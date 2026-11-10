// Занятие: сначала повторения на сегодня, затем знакомство с новыми словами (быстрый поток)
// и карточки. Проверка — выбором из 4 вариантов по уровням (levels.js) или, по настройке,
// самооценкой «вспомни → проверь → оцени» в обе стороны. Ответ решает, когда слово вернётся.
import { newCard, review, previewIntervals, formatInterval, isLearning, GRADES, AGAIN } from './srs.js';
import { LEVELS, MAX_LEVEL, PROMOTE_AFTER, levelOf, streakOf, applyAnswer, gradeFor, pickOptions, levelRule, checkTyped, SLOW_TYPED_MS } from './levels.js';
import { wordId, dueWords, freshWords, pickNext, dayKey, endOfDay, markDay, packSession, unpackSession, sample } from './session.js';
import { entryMeta, escapeHtml } from './data.js';
import { speak, stopSpeech } from './speech.js';
import { mnemonicHtml } from './mnemonics.js';

function wordHtml(entry, className = 'word') {
  return `<span class="${className} speak" data-word title="Прослушать">${escapeHtml(entry.word)}</span>`;
}

// Пример к слову и ассоциация для запоминания — показываются вместе с ответом.
function exampleHtml(entry) {
  const example = entry.example
    ? `<span class="example"><span class="speak">${escapeHtml(entry.example.text)}</span> — ${escapeHtml(entry.example.ru)}</span>`
    : '';
  return example + mnemonicHtml(entry, 'span');
}

const translationText = (entry) => entry.translations.join(', ');

// Слова, начатые сегодня, — для «Пройти обучение снова».
export function startedToday(words, progress, now) {
  const today = dayKey(now);
  return words.filter((e) => progress.cards[wordId(e)]?.added === today);
}

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
  const levelNote = $('level-rule');
  const choices = $('choices');
  const typed = $('typed');
  const typedInput = $('typed-input');
  let typedNote = ''; // подсказка о написании для отметки ответа
  const note = $('answer-note');
  const nextButton = $('next-card');
  const keysHint = $('keys-hint');

  // Проверка выбором: уровень текущего слова, варианты, время показа и ответа.
  let level = 1;
  let options = [];
  let answered = false;
  let shownAt = 0;
  let advanceTimer = null;
  const choiceMode = () => ctx.get().settings.check !== 'self';

  let queue = [];
  let waiting = [];
  let fresh = new Set();
  let introDone = true;
  let current = null;
  let reverse = false;
  // Самооценка: слово проходит оба направления. Здесь — оценки за «слово → перевод»,
  // слово ждёт в очереди обратную карточку; интервал — по худшей из двух оценок.
  let halves = new Map();
  const REVERSE_GAP = 3; // через сколько карточек показать обратную
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
    begin(due, freshList, settings);
  }

  // Пройти обучение снова: слова, начатые сегодня, возвращаются к самому началу —
  // знакомство, затем карточки с 1-го уровня. Возвращает число слов (0 — проходить нечего).
  function restartToday() {
    const now = Date.now();
    const { words, progress, settings } = ctx.get();
    const list = startedToday(words, progress, now);
    if (!list.length) return 0;
    for (const entry of list) delete progress.cards[wordId(entry)];
    ctx.save();
    begin([], list, settings);
    return list.length;
  }

  function begin(due, freshList, settings) {
    // Вперемешку — карточки в случайном порядке; иначе сначала повторения по сроку, затем новые от частых.
    queue = settings.cardOrder === 'order' ? [...due, ...freshList] : sample([...due, ...freshList], Infinity);
    waiting = [];
    fresh = new Set(freshList.map(wordId));
    introDone = settings.introSeconds <= 0 || !freshList.length;
    current = null;
    halves = new Map();
    reviewed = 0;
    active = true;
    next();
  }

  // Сохранить, где остановились: после перезагрузки или на другом устройстве занятие продолжится.
  function persist() {
    if (!active) return;
    ctx.saveState(packSession({ queue, waiting, fresh, introDone, reviewed, current, halves }, Date.now()));
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
    halves = new Map(s.halves);
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
    const last = current;
    current = null;
    const pick = pickNext(queue, waiting, Date.now(), last);
    if (!pick) {
      finish();
      return;
    }
    if (pick.from === 'queue' && !introDone && fresh.has(wordId(pick.entry))) {
      runIntro(queue.filter((e) => fresh.has(wordId(e))));
      return;
    }
    if (pick.from === 'queue') queue.splice(queue.indexOf(pick.entry), 1);
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
    typed.hidden = true;
    nextButton.hidden = true;
    note.textContent = '';
    note.className = 'answer-note';
    const meta = `<span class="meta">${escapeHtml(entryMeta(current))}</span>`;
    const translation = `<span class="translation">${escapeHtml(translationText(current))}</span>`;

    if (!choiceMode()) {
      reverse = halves.has(wordId(current));
      levelLine.textContent = reverse ? 'Карточка 2 из 2 · перевод → слово' : 'Карточка 1 из 2 · слово → перевод';
      levelNote.textContent = reverse
        ? 'Интервал повторения — по худшей из двух оценок.'
        : 'Через несколько карточек это слово вернётся в обратную сторону: перевод → слово.';
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
    // 1-й уровень — два вопроса: прямой (слово → перевод), через несколько карточек — обратный.
    const secondHalf = level === 1 && halves.has(wordId(current));
    reverse = level > 1 || secondHalf;
    const task = level === 1 ? (secondHalf ? 'Вопрос 2 из 2: выберите слово' : 'Вопрос 1 из 2: выберите перевод') : LEVELS[level].task;
    levelLine.innerHTML = `${levelHtml(level, streakOf(card))} <span class="task">— ${task}</span>`;
    levelNote.textContent = level === 1 && !secondHalf
      ? `Через несколько карточек — обратный вопрос: перевод → слово. Засчитывается, если верны оба. ${levelRule(level, streakOf(card))}`
      : levelRule(level, streakOf(card));
    if (!reverse) {
      front.innerHTML = `${wordHtml(current)}${meta}`;
      back.innerHTML = exampleHtml(current);
    } else {
      front.innerHTML = `${translation}${meta}`;
      back.innerHTML = `${wordHtml(current)}${exampleHtml(current)}`;
    }
    if (level < 3) {
      options = pickOptions(current, words);
      choices.innerHTML = options
        .map((e, i) => `<button type="button" data-choice="${i}"${reverse ? ' lang="' + escapeHtml(ctx.get().lang ?? '') + '"' : ''}>${escapeHtml(reverse ? e.word : e.translations.slice(0, 3).join(', '))}</button>`)
        .join('');
      choices.hidden = false;
      revealButton.hidden = true;
      keysHint.textContent = 'Клавиши: 1–4 — вариант, Enter — дальше';
    } else {
      // 3-й уровень: слово пишется с клавиатуры.
      revealButton.hidden = true;
      typedInput.value = '';
      typedInput.readOnly = false;
      typedInput.className = '';
      typedInput.lang = ctx.get().lang ?? '';
      typed.hidden = false;
      keysHint.textContent = 'Enter — проверить, затем Enter — дальше';
    }
    show('review');
    updateLeft();
    // Экран занятия может стать видимым чуть позже (после start) — фокус в следующем кадре.
    if (level === 3) requestAnimationFrame(() => { if (!answered && !typed.hidden) typedInput.focus({ preventScroll: true }); });
    else document.activeElement?.blur?.();
    if (!reverse && settings.autospeak) speak(current.word, front.querySelector('[data-word]'));
  }

  // Ответ выбором (уровни 1 и 2).
  function choose(index) {
    if (!current || answered || level >= 3 || !options[index]) return;
    const correct = wordId(options[index]) === wordId(current);
    choices.querySelectorAll('[data-choice]').forEach((button, j) => {
      // После ответа варианты неактивны (aria-disabled); дальше — только кнопкой «Дальше».
      button.setAttribute('aria-disabled', 'true');
      if (wordId(options[j]) === wordId(current)) button.classList.add('right');
      else if (j === index) button.classList.add('wrong');
    });
    back.hidden = !back.innerHTML;
    if (reverse && ctx.get().settings.autospeak) speak(current.word, back.querySelector('[data-word]'));
    answer(correct, Date.now() - shownAt);
  }

  // Ответ на 3-м уровне: написанное слово (skip — «Не помню»).
  function typedAnswer(skip = false) {
    if (!current || answered || level !== 3) return;
    const value = typedInput.value;
    if (!skip && !value.trim()) {
      typedInput.focus();
      return;
    }
    const check = skip ? 'wrong' : checkTyped(value, current.word);
    const correct = check !== 'wrong';
    typedInput.readOnly = true;
    typedInput.className = correct ? 'right' : 'wrong';
    typedInput.blur(); // Enter после ответа — «Дальше»
    revealed = true;
    back.hidden = false;
    if (ctx.get().settings.autospeak) speak(current.word, back.querySelector('[data-word]'));
    typedNote = check === 'accents' ? ` · пишется: ${current.word}`
      : check === 'typo' ? ` · опечатка, правильно: ${current.word}`
      : !correct ? ` · правильно: ${current.word}` : '';
    answer(correct, Date.now() - shownAt);
  }

  // Записать ответ: уровень и серия слова, интервал по алгоритму повторения.
  function answer(correctNow, ms) {
    answered = true;
    const now = Date.now();
    const { progress } = ctx.get();
    const entry = current;
    const id = wordId(entry);
    const card = progress.cards[id] ?? { ...newCard(now), added: dayKey(now) };
    let grade = gradeFor(correctNow, ms, level === 3 ? SLOW_TYPED_MS : undefined);
    if (level === 1 && !halves.has(id)) {
      firstHalf(entry, correctNow, grade);
      return;
    }
    // Второй вопрос 1-го уровня: итог — по худшему из двух ответов.
    if (halves.has(id)) grade = Math.min(grade, halves.get(id));
    halves.delete(id);
    const correct = grade > AGAIN;
    const result = applyAnswer(card, correct);
    const updated = { ...review(card, grade, now), level: result.level, streak: result.streak };
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
    levelNote.textContent = levelRule(result.level, result.streak);
    let text = (correctNow ? '✓ Верно' : '✗ Неверно') + (level === 3 ? typedNote : '');
    typedNote = '';
    if (!correctNow && level < 3) text += ' — правильный выделен';
    if (correctNow && !correct) text += ' · но в прямом вопросе была ошибка — серия с нуля';
    if (result.promoted) text += ` · Новый уровень: ${LEVELS[result.level].name.toLowerCase()}!`;
    if (result.demoted) text += ` · Слово вернулось на уровень ${result.level}`;
    note.textContent = text;
    note.className = `answer-note ${correct ? 'ok' : 'no'}`;
    autoAdvance();
  }

  // Прямой вопрос 1-го уровня отвечен: слово вернётся обратным вопросом через несколько карточек,
  // уровень и интервал решатся после него.
  function firstHalf(entry, correctNow, grade) {
    halves.set(wordId(entry), grade);
    queue.splice(Math.min(REVERSE_GAP, queue.length), 0, entry);
    current = null;
    persist();
    current = entry;
    note.textContent = `${correctNow ? '✓ Верно' : '✗ Неверно — правильный выделен'} · Скоро обратный вопрос: перевод → слово`;
    note.className = `answer-note ${correctNow ? 'ok' : 'no'}`;
    autoAdvance();
  }

  // После ответа — только кнопка «Дальше» (или Enter): карточка сама не перелистывается,
  // чтобы спокойно рассмотреть ответ, пример и ассоциацию.
  function autoAdvance() {
    nextButton.hidden = false;
    // На телефоне кнопка может оказаться ниже края экрана — прокрутить к ней.
    nextButton.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function reveal() {
    if (!current || revealed) return;
    if (choiceMode()) return; // в проверке выбором ответ открывается сам после ответа
    revealed = true;
    back.hidden = false;
    revealButton.hidden = true;
    const now = Date.now();
    const { progress, settings } = ctx.get();
    const card = progress.cards[wordId(current)] ?? newCard(now);
    const intervals = previewIntervals(card, now);
    // На прямой карточке интервал ещё не решён — его подписи покажет обратная.
    const first = halves.get(wordId(current));
    for (const g of GRADES) {
      grades.querySelector(`[data-grade="${g}"] small`).textContent = reverse ? formatInterval(intervals[Math.min(g, first ?? g)]) : '';
    }
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
    if (!halves.has(id)) {
      // Прямая карточка оценена — слово вернётся обратной через несколько карточек.
      halves.set(id, value);
      queue.splice(Math.min(REVERSE_GAP, queue.length), 0, current);
      next();
      return;
    }
    const worst = Math.min(value, halves.get(id));
    halves.delete(id);
    const card = progress.cards[id] ?? { ...newCard(now), added: dayKey(now) };
    const updated = review(card, worst, now);
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
    const ms = settings.introSeconds * 1000;
    const meta = `<span class="meta">${escapeHtml(entryMeta(entry))}</span>`;
    const translation = `<span class="translation">${escapeHtml(translationText(entry))}</span>`;
    // Чётные круги — обратный прогон: сначала перевод, через полпаузы — слово с произношением.
    const reverse = round % 2 === 0;
    introState.reveal = null;
    introProgress.textContent = `${index + 1} из ${list.length} · круг ${round} из ${settings.introRounds}`
      + (reverse ? ' · перевод → слово' : ' · слово → перевод');
    if (!reverse) {
      introCard.innerHTML = `${wordHtml(entry)}${meta}${translation}${exampleHtml(entry)}`;
      if (settings.autospeak) speak(entry.word, introCard.querySelector('[data-word]'));
      if (!introState.paused) introState.timer = setTimeout(introAdvance, ms);
      return;
    }
    introCard.innerHTML = `${translation}${meta}<span class="intro-answer" hidden>${wordHtml(entry)}${exampleHtml(entry)}</span>`;
    const answer = introCard.querySelector('.intro-answer');
    introState.reveal = () => {
      if (!answer.hidden) return;
      answer.hidden = false;
      if (settings.autospeak) speak(entry.word, answer.querySelector('[data-word]'));
    };
    if (introState.paused) {
      introState.reveal();
      return;
    }
    // Время на вспоминание — половина паузы, затем слово видно ещё полную паузу.
    introState.timer = setTimeout(() => {
      introState.reveal();
      introState.timer = setTimeout(introAdvance, ms);
    }, ms / 2);
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
    if (introState.paused) {
      clearTimeout(introState.timer);
      introState.reveal?.(); // на паузе слово видно сразу
    } else introStep();
  }

  function finish() {
    active = false;
    current = null;
    ctx.clearState();
    left.textContent = '';
    const { progress, words } = ctx.get();
    const now = Date.now();
    const today = startedToday(words, progress, now).length;
    done.innerHTML = `
      <p class="word">${reviewed ? 'На сегодня всё' : 'Сейчас повторять нечего'}</p>
      <p>${reviewed ? `Карточек в занятии: ${reviewed}.` : ''} ${escapeHtml(nextDueText(progress, now))}</p>
      <div class="row-buttons">
        <button type="button" class="primary" id="session-back">К статистике</button>
        ${today ? `<button type="button" id="session-again">Пройти обучение снова · ${today}</button>` : ''}
      </div>
      ${today ? '<p class="hint">Слова, начатые сегодня, начнутся с самого начала: знакомство и карточки с 1-го уровня.</p>' : ''}`;
    show('done');
    done.querySelector('#session-back').addEventListener('click', ctx.onExit);
    done.querySelector('#session-again')?.addEventListener('click', restartToday);
  }

  revealButton.addEventListener('click', reveal);
  grades.addEventListener('click', (event) => {
    const button = event.target.closest('[data-grade]');
    if (button) grade(Number(button.dataset.grade));
  });
  choices.addEventListener('click', (event) => {
    if (answered && choiceMode()) return; // дальше — только кнопкой «Дальше»
    const button = event.target.closest('[data-choice]');
    if (button) choose(Number(button.dataset.choice));
  });
  typed.addEventListener('submit', (event) => {
    event.preventDefault();
    if (answered) next();
    else typedAnswer();
  });
  $('typed-skip').addEventListener('click', () => {
    if (answered) next();
    else typedAnswer(true);
  });
  nextButton.addEventListener('click', () => {
    if (answered) next();
  });
  // Нажатие на карточку тоже открывает ответ (но не на слово — оно озвучивается).
  $('card').addEventListener('click', (event) => {
    if (event.target.closest('.speak')) return;
    if (!(answered && choiceMode())) reveal();
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
      } else if (!answered && level === 3 && /^\S$/u.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Фокус ушёл с поля — первая же буква возвращает его туда.
        typedInput.focus();
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

  return { start, resume, pending, restartToday, stop, isActive: () => active };
}
