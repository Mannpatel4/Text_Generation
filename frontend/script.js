(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const editor = $('editor');
  const mirror = $('mirror');
  const sheet = $('sheet');
  const list = $('candidates');
  const emptyMsg = $('empty');
  const message = $('message');
  const unknownNote = $('unknown');
  const statusEl = $('status');
  const statusText = $('status-text');
  const continueBtn = $('continue');
  const clearBtn = $('clear');

  // FastAPI address. Change this if your server runs on another host or port.
  const API_URL = 'https://text-generation-oah3.onrender.com';

  const CONTEXT_WORDS = 40;   // the model only reads the last 12 words; send a few more to be safe
  const GENERATE_WORDS = 25;  // words added by "Continue the story"
  const DEBOUNCE_MS = 300;
  const STEP_DELAY_MS = 90;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = emptyState();
  let timer = null;
  let abortCtl = null;
  let generating = false;
  let stopRequested = false;

  function emptyState() {
    return { suggestions: [], forText: null, unknown: [], message: '', kind: '', loading: false };
  }

  /* ---------- API ---------- */

  function contextOf(text) {
    return text.trim().split(/\s+/).slice(-CONTEXT_WORDS).join(' ');
  }

  async function fetchPrediction(text, signal) {
    const res = await fetch(API_URL + '/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: contextOf(text) }),
      signal,
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON error body */ }

    if (!res.ok) {
      const detail = data && typeof data.detail === 'string' ? data.detail : 'The server returned an error.';
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function checkHealth() {
    try {
      const res = await fetch(API_URL + '/health');
      const data = await res.json();
      setStatus(res.ok && data.model_loaded ? 'ready' : 'checking');
    } catch (_) {
      setStatus('offline');
    }
  }

  function setStatus(kind) {
    const labels = {
      ready: 'Model ready',
      offline: 'Server not reachable',
      checking: 'Checking server…',
    };
    statusEl.dataset.state = kind;
    statusText.textContent = labels[kind];
  }

  function explain(err) {
    if (!err.status) {
      return 'Can’t reach the server. In the RNN folder, run “uvicorn run:app --reload” and reload this page.';
    }
    return err.message;
  }

  /* ---------- Rendering ---------- */

  function needsSpace(text) {
    return text.length > 0 && !/\s$/.test(text);
  }

  function ghostWord() {
    const value = editor.value;
    if (!state.suggestions.length || state.forText !== value) return '';
    if (editor.selectionStart !== value.length || editor.selectionEnd !== value.length) return '';
    return state.suggestions[0].word;
  }

  function renderMirror() {
    const value = editor.value;
    mirror.replaceChildren();

    const typed = document.createElement('span');
    typed.textContent = value;
    mirror.append(typed);

    const word = ghostWord();
    if (word) {
      const ghost = document.createElement('span');
      ghost.className = 'ghost';
      ghost.textContent = (needsSpace(value) ? ' ' : '') + word;
      mirror.append(ghost);
    }

    // Keeps a trailing newline from collapsing so the heights match.
    mirror.append('\u200b');
  }

  function formatPercent(p) {
    if (p >= 0.995) return '100%';
    if (p < 0.01) return '<1%';
    return Math.round(p * 100) + '%';
  }

  function renderList() {
    list.replaceChildren();
    list.classList.toggle('is-loading', state.loading && state.suggestions.length > 0);

    const hasSuggestions = state.suggestions.length > 0;
    emptyMsg.hidden = hasSuggestions || Boolean(state.message) || state.loading;

    message.hidden = !state.message;
    message.textContent = state.message;
    message.dataset.kind = state.kind;

    const fills = [];
    state.suggestions.forEach((s, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cand' + (i === 0 ? ' top' : '');
      btn.dataset.word = s.word;
      btn.setAttribute('aria-label', `Add “${s.word}”, ${formatPercent(s.probability)} likely`);

      const word = document.createElement('span');
      word.className = 'cand-word';
      word.textContent = s.word;

      const track = document.createElement('span');
      track.className = 'cand-track';
      const fill = document.createElement('span');
      fill.className = 'cand-fill';
      track.append(fill);
      fills.push([fill, Math.max(0, Math.min(1, s.probability))]);

      const pct = document.createElement('span');
      pct.className = 'cand-pct';
      pct.textContent = formatPercent(s.probability);

      btn.append(word, track, pct);
      li.append(btn);
      list.append(li);
    });

    // Set widths on the next frame so the bars grow from zero.
    requestAnimationFrame(() => {
      fills.forEach(([fill, p]) => { fill.style.width = (p * 100).toFixed(1) + '%'; });
    });
  }

  function renderUnknown() {
    const words = state.unknown;
    if (state.forText !== editor.value || !words.length) {
      unknownNote.hidden = true;
      return;
    }
    const shown = words.slice(0, 6).map((w) => `“${w}”`).join(', ');
    const more = words.length > 6 ? ` and ${words.length - 6} more` : '';
    unknownNote.textContent = `The model hasn’t seen ${shown}${more}. It treats unfamiliar words as unknown.`;
    unknownNote.hidden = false;
  }

  function renderAll() {
    renderMirror();
    renderList();
    renderUnknown();
  }

  function updateButtons() {
    continueBtn.textContent = generating ? 'Stop' : 'Continue the story';
    clearBtn.disabled = generating;
  }

  function keepSheetInView() {
    const rect = sheet.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      sheet.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  /* ---------- Prediction flow ---------- */

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  }

  async function refresh() {
    clearTimeout(timer);
    const text = editor.value;

    if (!text.trim()) {
      if (abortCtl) abortCtl.abort();
      state = emptyState();
      renderAll();
      return;
    }

    if (abortCtl) abortCtl.abort();
    const ctl = new AbortController();
    abortCtl = ctl;

    state = { ...state, loading: true };
    renderList();

    try {
      const data = await fetchPrediction(text, ctl.signal);
      state = {
        suggestions: data.suggestions,
        forText: text,
        unknown: data.unknown_words || [],
        message: '',
        kind: '',
        loading: false,
      };
      setStatus('ready');
    } catch (err) {
      if (err.name === 'AbortError') return;
      state = {
        ...emptyState(),
        message: explain(err),
        kind: err.status ? 'note' : 'error',
      };
      if (!err.status) setStatus('offline');
    }

    if (abortCtl === ctl) renderAll();
  }

  function appendWord(word) {
    const value = editor.value;
    editor.value = value + (needsSpace(value) ? ' ' : '') + word + ' ';
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  function acceptWord(word) {
    appendWord(word);
    editor.focus({ preventScroll: true });
    state = { ...state, forText: null };
    renderAll();
    refresh();
  }

  // Picks one of the suggestions at random, weighted by probability.
  function sample(suggestions) {
    const total = suggestions.reduce((sum, s) => sum + s.probability, 0);
    let r = Math.random() * total;
    for (const s of suggestions) {
      r -= s.probability;
      if (r <= 0) return s;
    }
    return suggestions[0];
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function continueStory() {
    if (generating) {
      stopRequested = true;
      return;
    }

    if (!editor.value.trim()) {
      state = { ...emptyState(), message: 'Write a few words first, or pick a line from the story below.', kind: 'note' };
      renderAll();
      editor.focus();
      return;
    }

    generating = true;
    stopRequested = false;
    clearTimeout(timer);
    if (abortCtl) abortCtl.abort();
    updateButtons();

    try {
      for (let i = 0; i < GENERATE_WORDS && !stopRequested; i++) {
        const data = await fetchPrediction(editor.value);
        if (stopRequested) break;
        appendWord(sample(data.suggestions).word);
        state = {
          suggestions: data.suggestions,
          forText: null,
          unknown: [],
          message: '',
          kind: '',
          loading: false,
        };
        renderAll();
        keepSheetInView();
        setStatus('ready');
        await sleep(reduceMotion ? 0 : STEP_DELAY_MS);
      }
    } catch (err) {
      state = { ...emptyState(), message: explain(err), kind: err.status ? 'note' : 'error' };
      if (!err.status) setStatus('offline');
      renderAll();
    } finally {
      generating = false;
      stopRequested = false;
      updateButtons();
      if (!state.message) refresh();
    }
  }

  /* ---------- Events ---------- */

  editor.addEventListener('input', () => {
    if (generating) stopRequested = true;
    state = { ...state, forText: null };
    renderMirror();
    renderUnknown();
    if (editor.value.trim()) schedule(DEBOUNCE_MS);
    else refresh();
  });

  editor.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const word = ghostWord();
    if (!word) return;
    event.preventDefault();
    acceptWord(word);
  });

  ['keyup', 'click', 'focus', 'select'].forEach((name) => {
    editor.addEventListener(name, renderMirror);
  });

  list.addEventListener('click', (event) => {
    const btn = event.target.closest('.cand');
    if (btn) acceptWord(btn.dataset.word);
  });

  document.querySelectorAll('[data-starter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.value = btn.dataset.starter + ' ';
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
      state = emptyState();
      renderAll();
      refresh();
    });
  });

  continueBtn.addEventListener('click', continueStory);

  clearBtn.addEventListener('click', () => {
    editor.value = '';
    editor.focus();
    refresh();
  });

  window.addEventListener('online', checkHealth);

  /* ---------- Start ---------- */

  renderAll();
  updateButtons();
  checkHealth();
  if (editor.value.trim()) refresh();
})();