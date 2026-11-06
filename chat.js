/* Встроенный AI-чат в нижнем блоке. Бэкенд: POST /api/chat (Claude + Telegram). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const chat = $('#chat');
  if (!chat) return;
  // Боевой бэкенд на Render. Сайт открывается и с GitHub Pages, поэтому адрес полный, а не относительный.
  // На localhost используется тот же сервер (относительный путь); переопределить можно через <meta name="chat-api">.
  const PROD_API = 'https://daniela-lawyer.onrender.com';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const API = (((document.querySelector('meta[name=chat-api]') || {}).content || '').trim() || (isLocal ? '' : PROD_API)).replace(/\/$/, '');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = k => ((window.I18N || {})[root.lang] || {})[k] || (window.I18N?.es || {})[k] || '';

  const log = $('#chat-log'), form = $('#chat-form'), input = $('#chat-text'), sendBtn = $('#chat-send');
  const tags = $('#chat-tags'), handBtn = $('#chat-handbtn'), hand = $('#chat-hand'), ok = $('#chat-ok');
  const hName = $('#hand-name'), hContact = $('#hand-contact'), hErr = $('#hand-err'), hGo = $('#hand-go');

  const sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '').slice(0, 8);
  let history = [];          // [{role, content}]
  let topic = '';
  let busy = false;

  const scrollDown = () => log.scrollTo({ top: log.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });

  function bubble(role, text, { words = false } = {}) {
    const el = document.createElement('div');
    el.className = 'msg-b ' + role;
    const p = document.createElement('p');
    if (words && !reduce) {
      const parts = text.split(/(\s+)/);
      const step = Math.min(0.045, 1.4 / Math.max(1, parts.length));
      let i = 0;
      for (const w of parts) {
        if (/^\s+$/.test(w) || !w) { p.append(w); continue; }
        const s = document.createElement('span');
        s.className = 'w'; s.style.animationDelay = (i++ * step).toFixed(3) + 's'; s.textContent = w;
        p.append(s);
      }
    } else p.textContent = text;
    el.append(p);
    log.append(el);
    scrollDown();
    return el;
  }

  function typing() {
    const el = document.createElement('div');
    el.className = 'msg-b ai typing';
    el.setAttribute('aria-label', '…');
    el.innerHTML = '<i></i><i></i><i></i>';
    log.append(el); scrollDown();
    return el;
  }

  const setBusy = b => { busy = b; chat.classList.toggle('is-busy', b); sendBtn.disabled = b; };

  async function post(payload) {
    const r = await fetch(API + '/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sid, lang: root.lang, topic, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'http_' + r.status), { status: r.status });
    return j;
  }

  function errorBubble() { bubble('ai err', t('ch_err')); }

  async function send(text) {
    text = text.trim().slice(0, 1500);
    if (!text || busy) return;
    setBusy(true);
    bubble('user', text);
    history.push({ role: 'user', content: text });
    input.value = ''; autosize();
    const dots = typing();
    const t0 = performance.now();
    try {
      const { reply, lead } = await post({ messages: history });
      const wait = Math.max(0, 750 - (performance.now() - t0)); // чтобы индикатор не мигал
      await new Promise(r => setTimeout(r, wait));
      dots.remove();
      history.push({ role: 'assistant', content: reply });
      bubble('ai', reply, { words: true });
      handBtn.hidden = false;
      if (lead) setTimeout(showOk, reduce ? 0 : 1800 + Math.min(reply.length * 12, 1400));
    } catch (e) {
      dots.remove();
      history.pop();
      errorBubble();
      handBtn.hidden = true;
    }
    setBusy(false);
    if (hand.hidden && matchMedia('(pointer:fine)').matches) input.focus({ preventScroll: true });
  }

  /* поле ввода: авто-высота, Enter — отправить, Shift+Enter — перенос */
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); send(input.value); });

  /* быстрые теги */
  tags.addEventListener('click', e => {
    const b = e.target.closest('button[data-topic]');
    if (!b || busy) return;
    topic = b.dataset.topic;
    tags.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    send(t('ch_msg_' + topic));
  });

  /* передача адвокату */
  handBtn.addEventListener('click', () => {
    hand.hidden = !hand.hidden;
    handBtn.setAttribute('aria-expanded', String(!hand.hidden));
    if (!hand.hidden) { hContact.focus({ preventScroll: true }); setTimeout(() => hand.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }), 60); }
  });
  hand.addEventListener('submit', async e => {
    e.preventDefault();
    const contact = hContact.value.trim();
    hErr.hidden = contact.length < 5;
    if (contact.length < 5) { hErr.textContent = t('ch_hand_err'); hContact.focus(); return; }
    hGo.disabled = true; chat.classList.add('is-busy');
    try {
      await post({ handoff: true, urgent: topic === 'ur', name: hName.value, contact, messages: history });
      chat.classList.remove('is-busy');
      showOk();
    } catch {
      chat.classList.remove('is-busy'); hGo.disabled = false;
      hErr.hidden = false; hErr.textContent = t('ch_err');
    }
  });

  function showOk() {
    chat.classList.add('is-done');
    ok.hidden = false;
    ok.querySelector('svg').classList.remove('go'); void ok.offsetWidth; ok.querySelector('svg').classList.add('go');
    setTimeout(() => ok.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }), 60);
  }
  $('#chat-new').addEventListener('click', () => {
    history = []; topic = '';
    log.querySelectorAll('.msg-b:not(.first)').forEach(n => n.remove());
    tags.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
    hand.hidden = true; handBtn.hidden = true; ok.hidden = true; hGo.disabled = false;
    hName.value = hContact.value = ''; hErr.hidden = true;
    chat.classList.remove('is-done'); input.focus({ preventScroll: true });
  });

  /* анимации кнопки в Hero не крутим, пока Hero не на экране или вкладка скрыта (экономия батареи и GPU на телефоне) */
  const heroAi = $('#hero-ai'), heroEl = $('.hero');
  if (heroAi && heroEl && 'IntersectionObserver' in window) {
    let vis = true;
    const apply = () => heroAi.classList.toggle('is-off', !vis || document.hidden);
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; apply(); }, { threshold: 0 }).observe(heroEl);
    document.addEventListener('visibilitychange', apply);
  }

  if (heroAi && matchMedia('(max-width:768px),(pointer:coarse)').matches) {
    let st = 0;
    addEventListener('scroll', () => { if (!heroAi.classList.contains('is-moving')) heroAi.classList.add('is-moving'); clearTimeout(st); st = setTimeout(() => heroAi.classList.remove('is-moving'), 150); }, { passive: true });
  }

  addEventListener('ask-open', () => { if (!chat.classList.contains('is-done')) input.focus({ preventScroll: true }); });

  /* плейсхолдеры зависят от языка: обновляем при смене lang у <html> */
  const phs = () => {
    input.placeholder = t('ch_ph');
    sendBtn.setAttribute('aria-label', t('ch_send'));
    hName.placeholder = t('ch_hand_name');
    hContact.placeholder = t('ch_hand_contact');
    input.setAttribute('aria-label', t('ch_ph'));
  };
  new MutationObserver(phs).observe(root, { attributes: true, attributeFilter: ['lang'] });
  phs();
})();
