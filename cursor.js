/* Курсор в стиле Apple: маленький бесцветный круг (инвертирует фон — белый на тёмном, тёмный на светлом).
   Над кликабельным плавно «раскрывается» в мягкий круг, при нажатии сжимается, в полях ввода уступает системному. Только мышь/трекпад. */
(function () {
  'use strict';
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  var root = document.documentElement, el = document.createElement('div');
  el.id = 'cursor'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<i></i>'; document.body.appendChild(el);
  root.classList.add('has-cursor');
  var x = -100, y = -100, cx = x, cy = y, shown = false, raf = 0;
  var HOT = 'a,button,[role=button],label,summary,select,.row,.dots button';
  var TXT = 'input,textarea,[contenteditable=true]';
  function tick() {
    cx += (x - cx) * 0.32; cy += (y - cy) * 0.32;
    el.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
    raf = (Math.abs(x - cx) + Math.abs(y - cy) > 0.1) ? requestAnimationFrame(tick) : 0;
  }
  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    x = e.clientX; y = e.clientY;
    if (!shown) { shown = true; cx = x; cy = y; el.classList.add('on'); }
    var t = e.target && e.target.closest ? e.target : null;
    el.classList.toggle('hot', !!(t && t.closest(HOT)));
    el.classList.toggle('txt', !!(t && t.closest(TXT)));
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
  addEventListener('pointerdown', function () { el.classList.add('down'); });
  addEventListener('pointerup', function () { el.classList.remove('down'); });
  document.addEventListener('pointerleave', function () { el.classList.remove('on'); shown = false; });
  document.addEventListener('pointerenter', function () { shown = false; });
})();
