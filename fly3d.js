/* «Полёт камеры» — Three.js + GSAP ScrollTrigger + Lenis.
   Виртуальная камера летит вдоль оси Z сквозь слои: фон героя, золотые арки-порталы, световые пылинки.
   Портрет и фото Фемиды — плоскости, привязанные к своим HTML-блокам (подлёт → покой → пролёт мимо камеры).
   Глубина резкости: фокус всегда на активном блоке (дистанция D0), всё остальное по оси Z мягко размывается.
   Блок «Áreas»: траектория камеры поворачивает в горизонтальный пролёт вдоль 4 арочных карточек (pin + горизонтальный сдвиг),
   затем камера возвращается к вертикальному погружению.
   Весь текст — обычный HTML (SEO, языки, форма, фокус с клавиатуры). Скролл нативный (Lenis только сглаживает):
   вверх/вниз работает одинаково везде, включая футер. Нет WebGL/библиотек/reduced-motion/file:// — работает прежняя версия. */
(function () {
  'use strict';
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || matchMedia('(max-width:768px),(max-width:1024px) and (pointer:coarse)').matches) return;   // телефоны: лёгкий режим без WebGL
  if (!window.THREE || !window.gsap || !window.ScrollTrigger || !window.Lenis) return;

  const $ = (s, r) => (r || document).querySelector(s);
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = x => 1 - Math.pow(1 - x, 3);
  const smooth = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { return; }
  if (!renderer.getContext()) return;

  const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const heroImg = $('.hero-img'), arch = $('.arch img'), band = $('.band-in img');
  if (!heroImg || !arch || !band) { renderer.dispose(); return; }

  Promise.all([load(heroImg.currentSrc || heroImg.src), load(arch.src), load(band.src)]).then(imgs => {
    // file:// «пачкает» canvas — WebGL-текстуры невозможны, остаёмся на обычной версии
    try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(imgs[0], 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); }
    catch (e) { renderer.dispose(); return; }
    try { init(imgs); } catch (e) { console.warn('fly3d off:', e); root.classList.remove('gl'); }
  }).catch(() => renderer.dispose());

  function init([heroI, archI, bandI]) {
    const coarse = matchMedia('(pointer:coarse)').matches;
    const L = 72;                                   // длина полёта камеры по Z
    const FOV = 50, TAN = Math.tan(FOV * Math.PI / 360), D0 = 10;   // D0 — дистанция «активного» блока = плоскость фокуса
    const SLOW = 0.7;                               // пока рамы едут по горизонтали, камера почти не продвигается по Z: общий фон остаётся на месте
    const css = n => getComputedStyle(root).getPropertyValue(n).trim();
    const dark = () => root.dataset.theme === 'dark';

    root.classList.add('gl');
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.setSize(innerWidth, innerHeight);
    const cv = renderer.domElement; cv.id = 'gl'; cv.setAttribute('aria-hidden', 'true');
    document.body.prepend(cv);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 200);
    const back = new THREE.Group(); scene.add(back);
    const gold = new THREE.Color(css('--gold'));

    /* ───────── фон героя: резкая и размытая версии (глубина резкости) ───────── */
    const HZ = -14;
    const mkTex = c => { const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
    const heroTex = new THREE.Texture(heroI); heroTex.minFilter = THREE.LinearFilter; heroTex.generateMipmaps = false; heroTex.needsUpdate = true;
    const blurCv = document.createElement('canvas'), bw = 128, bh = Math.round(bw * heroI.naturalHeight / heroI.naturalWidth);
    blurCv.width = bw; blurCv.height = bh;
    { const x = blurCv.getContext('2d'); x.imageSmoothingQuality = 'high'; try { x.filter = 'blur(1.6px)'; } catch (e) { } x.drawImage(heroI, 0, 0, bw, bh); }
    const heroBlurTex = mkTex(blurCv);
    const heroBlurMat = new THREE.MeshBasicMaterial({ map: heroBlurTex, transparent: true, fog: false, depthWrite: false });
    const heroMat = new THREE.MeshBasicMaterial({ map: heroTex, transparent: true, fog: false, depthWrite: false });
    const heroBlur = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heroBlurMat), heroMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heroMat);
    heroBlur.position.z = HZ; heroMesh.position.z = HZ + 0.01; back.add(heroBlur, heroMesh);
    const cover = (tex, pa, ia) => {
      tex.repeat.set(1, 1); tex.offset.set(0, 0);
      if (pa > ia) { tex.repeat.y = ia / pa; tex.offset.y = (1 - tex.repeat.y) * 0.4; } else { tex.repeat.x = pa / ia; tex.offset.x = (1 - tex.repeat.x) / 2; }
    };
    const fitHero = () => {
      const vh = 2 * 14 * TAN * 1.14, vw = vh * innerWidth / innerHeight, ia = heroI.naturalWidth / heroI.naturalHeight;
      heroMesh.scale.set(vw, vh, 1); heroBlur.scale.set(vw, vh, 1); cover(heroTex, vw / vh, ia); cover(heroBlurTex, vw / vh, ia);
    };

    /* ───────── арки-порталы: одна текстура в двух видах — резкая линия и мягкое свечение ───────── */
    const ARCH_W = 9.3, ARCH_H = 12.4, MW = 1.25, MH = 1.12;      // поля вокруг арки под свечение
    const archTex = soft => {
      const TW = 512, TH = Math.round(TW * (ARCH_H * MH) / (ARCH_W * MW)), c = document.createElement('canvas'); c.width = TW; c.height = TH;
      const x = c.getContext('2d'), aw = TW / MW, ah = TH / MH, ax = (TW - aw) / 2, ay = (TH - ah) / 2, r = aw / 2;
      x.strokeStyle = '#fff'; x.lineJoin = 'round';
      const off = soft ? -5000 : 0;
      if (soft) { x.shadowColor = '#fff'; x.shadowBlur = 34; x.shadowOffsetX = 5000; x.lineWidth = 9; } else x.lineWidth = 2.2;
      x.beginPath(); x.moveTo(ax + off, ay + ah); x.lineTo(ax + off, ay + r); x.arc(ax + r + off, ay + r, r, Math.PI, 0); x.lineTo(ax + aw + off, ay + ah); x.stroke();
      return mkTex(c);
    };
    const crispTex = archTex(false), softTex = archTex(true);
    const archGeo = new THREE.PlaneGeometry(1, 1), archs = [];
    const addArch = (w, z, yc, base) => {
      const h = w / (ARCH_W / ARCH_H), mats = [crispTex, softTex].map(t => new THREE.MeshBasicMaterial({ map: t, color: gold, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const g = mats.map(m => { const me = new THREE.Mesh(archGeo, m); me.scale.set(w * MW, h * MH, 1); me.position.set(0, yc, z); me.renderOrder = 1; back.add(me); return me; });
      const o = { g, mats, z, base }; archs.push(o); return o;
    };
    for (let i = 0; i < 7; i++) { addArch(ARCH_W, -(15 + i * 10), -5.4 + ARCH_H / 2, 0.55); addArch(6.5, -(15 + i * 10) - 0.7, -5.0 + 4.3, 0.4); }

    /* ───────── световые пылинки: дрейф, боке по глубине резкости, подсветка при движении камеры ───────── */
    const N = coarse ? 340 : 760, pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34; pos[i * 3 + 1] = (Math.random() - 0.5) * 20; pos[i * 3 + 2] = 8 - Math.random() * 96;
      seed[i] = Math.random(); size[i] = 0.016 + Math.random() * 0.026;                    // мельчайшие пылинки
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); dustGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    function glassTint() { return dark() ? new THREE.Color(0.93, 0.93, 0.94) : new THREE.Color(0.27, 0.27, 0.29); }   // нейтральный жемчужный / графитовый, без жёлтого
    const dustU = { uTime: { value: 0 }, uSpeed: { value: 0 }, uFocus: { value: D0 }, uPx: { value: renderer.getPixelRatio() }, uScale: { value: 1 }, uColor: { value: glassTint() } };
    const dustMat = new THREE.ShaderMaterial({
      uniforms: dustU, transparent: true, depthWrite: false, depthTest: false,
      blending: dark() ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aSeed; attribute float aSize;
        uniform float uTime, uSpeed, uFocus, uPx, uScale;
        varying float vA; varying float vSoft;
        void main(){
          // у каждой пылинки своё направление, скорость и фаза — летят независимо друг от друга
          float dir = aSeed > 0.5 ? 1.0 : -1.0, k = fract(aSeed * 37.31), m = fract(aSeed * 91.7);
          vec3 p = position;
          p.x += sin(uTime * (0.10 + k * 0.22) + aSeed * 40.0) * (0.6 + m * 1.6);
          p.z += cos(uTime * (0.08 + m * 0.18) + aSeed * 23.0) * (0.8 + k * 1.8);
          p.y = mod(p.y + 10.0 + dir * uTime * (0.03 + k * 0.10), 20.0) - 10.0 + cos(uTime * (0.12 + k * 0.2) + aSeed * 20.0) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float coc = clamp(abs(d - uFocus) / 16.0, 0.0, 1.0);          // чуть мягче вне плоскости фокуса
          gl_PointSize = clamp(aSize * (1.0 + coc * 0.9) * uPx * uScale / max(d, 0.5), 1.6 * uPx, 7.0 * uPx);
          gl_Position = projectionMatrix * mv;
          float tw = 0.55 + 0.45 * sin(uTime * (0.5 + m * 1.6) + aSeed * 50.0);
          float nearF = smoothstep(0.7, 3.2, d), farF = 1.0 - smoothstep(30.0, 50.0, d);
          vA = tw * nearF * farF * (1.0 - 0.45 * coc) * (0.55 + uSpeed * 0.9);
          vSoft = coc;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uSpeed; varying float vA; varying float vSoft;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.15, 1.0, r)) * vA;           // мягкая точка, без ободка и блика
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }`
    });
    const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 2; back.add(dust);

    /* ───────── плоскости, привязанные к HTML-блокам (портрет, Фемида) ───────── */
    const roundTop = (c, x, y, w, h, rb) => {
      const r = w / 2; c.beginPath(); c.moveTo(x, y + h - rb); c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, 0);
      c.lineTo(x + w, y + h - rb); c.quadraticCurveTo(x + w, y + h, x + w - rb, y + h); c.lineTo(x + rb, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rb); c.closePath();
    };
    const coverImg = (c, img, x, y, w, h, px, py, zoom) => {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom, dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      c.drawImage(img, x + (w - dw) * px, y + (h - dh) * py, dw, dh);
    };
    const paintPortrait = (c, w, h) => {
      const pad = cl(innerWidth * 0.011, 10, 16);
      roundTop(c, 0.5, 0.5, w - 1, h - 1, 4); c.fillStyle = css('--paper'); c.fill(); c.strokeStyle = css('--rule'); c.lineWidth = 1; c.stroke();
      const iw = w - 2 * pad, ih = h - 2 * pad;
      c.save(); roundTop(c, pad, pad, iw, ih, 2); c.clip(); c.fillStyle = css('--bg2'); c.fillRect(pad, pad, iw, ih);
      coverImg(c, archI, pad, pad, iw, ih, 0, 0, 1.12);
      if (dark()) { c.fillStyle = 'rgba(0,0,0,.1)'; c.fillRect(pad, pad, iw, ih); }
      c.restore();
    };
    const paintFrame = (c, w, h) => {
      const pad = cl(innerWidth * 0.014, 10, 18);
      c.fillStyle = css('--paper'); c.fillRect(0, 0, w, h); c.strokeStyle = css('--strong'); c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
      const iw = w - 2 * pad, ih = h - 2 * pad;
      c.save(); c.beginPath(); c.rect(pad, pad, iw, ih); c.clip(); coverImg(c, bandI, pad, pad, iw, ih, 0.5, 0.5, 1);
      if (dark()) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(pad, pad, iw, ih); }
      c.restore(); c.strokeStyle = css('--rule'); c.strokeRect(pad + 0.5, pad + 0.5, iw - 1, ih - 1);
    };
    const items = [{ el: $('.canvas .matte'), paint: paintPortrait }, { el: $('.band .frame'), paint: paintFrame }].filter(o => o.el).map(o => {
      o.cv = document.createElement('canvas'); o.ctx = o.cv.getContext('2d'); o.tex = mkTex(o.cv);
      o.mat = new THREE.MeshBasicMaterial({ map: o.tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
      o.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), o.mat); o.mesh.renderOrder = 3; o.mesh.visible = false; scene.add(o.mesh);
      o.w = o.h = 0; return o;
    });
    const repaint = o => {
      const r = o.el.getBoundingClientRect(); if (!r.width) return;
      const k = Math.min(Math.min(devicePixelRatio || 1, 2), 2048 / Math.max(r.width, r.height));
      o.cv.width = Math.round(r.width * k); o.cv.height = Math.round(r.height * k);
      o.ctx.setTransform(k, 0, 0, k, 0, 0); o.ctx.clearRect(0, 0, r.width, r.height); o.paint(o.ctx, r.width, r.height);
      o.tex.needsUpdate = true; o.w = r.width; o.h = r.height;
    };
    const repaintAll = () => items.forEach(repaint);

    /* ───────── блок «Áreas»: горизонтальный пролёт вдоль арочных карточек ───────── */
    const areas = $('#areas'), stage = areas && $('.stage', areas), track = stage && $('.rows', stage);
    const cards = track ? [...track.children] : [];
    const H = { travel: 0, top: 0, active: -1, yaw: 0 };
    let SP = 900;                                                  // шаг между рамами вдоль ленты (px)
    let maxY = 1, effMax = 1, dotsEl = null, dotNum = null; const dotBtns = [];

    const effAt = sy => sy - SLOW * cl(sy - H.top, 0, H.travel);
    const zAt = sy => -(effAt(sy) / effMax) * L;
    const kD0 = () => 2 * TAN * D0 / innerHeight;                  // пиксели → мировые единицы на плоскости фокуса

    const buildDots = () => {
      if (!stage || dotsEl) return;
      dotsEl = document.createElement('div'); dotsEl.className = 'dots'; dotsEl.setAttribute('role', 'group'); dotsEl.setAttribute('aria-label', 'Áreas');
      cards.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', (i + 1) + '/' + cards.length); b.addEventListener('click', () => centerCard(i)); dotsEl.appendChild(b); dotBtns.push(b); });
      dotNum = document.createElement('span'); dotNum.textContent = '01 / 0' + cards.length; dotsEl.appendChild(dotNum); stage.appendChild(dotsEl);
    };
    const centerCard = i => {
      if (!cards[i]) return;
      const u = 0.08 + 0.84 * i / Math.max(1, cards.length - 1), top = areas.getBoundingClientRect().top + scrollY;
      window.__lenis.scrollTo(top + u * H.travel, { duration: 1.5 });
    };
    cards.forEach((c, i) => c.addEventListener('click', e => {      // клик по неактивной карточке — подвести к ней камеру
      if (i !== H.active) { e.preventDefault(); e.stopPropagation(); centerCard(i); }
    }, true));
    addEventListener('keydown', e => {                              // ← → листают карточки
      if (!cards.length || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || /input|textarea|select/i.test(e.target.tagName || '') || document.body.classList.contains('menu-open')) return;
      const r = areas.getBoundingClientRect(), vh = innerHeight;
      if (r.top > vh * 0.4 || r.bottom < vh * 0.6) return;
      e.preventDefault(); centerCard(cl(H.active + (e.key === 'ArrowRight' ? 1 : -1), 0, cards.length - 1));
    });

    const measure = () => {
      if (areas && track) {
        areas.style.height = ''; track.style.transform = 'none'; cards.forEach(c => { c.style.transform = 'none'; });
        const sh = stage.offsetHeight;
        H.travel = sh * ((cards.length - 1) * 0.9 + 1.2);           // длина горизонтальной ленты (в px скролла)
        SP = cards[0].offsetWidth * 1.12;
        areas.style.height = (sh + H.travel) + 'px';
        H.top = areas.getBoundingClientRect().top + scrollY;
      }
      maxY = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      effMax = Math.max(1, maxY - SLOW * H.travel);
    };

    /* ───────── Lenis + ScrollTrigger ───────── */
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95, gestureOrientation: 'both' });
    window.__lenis = lenis;
    gsap.registerPlugin(ScrollTrigger);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    const out = { ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 25%', scrub: true } };
    gsap.to('.hero-core', Object.assign({ scale: 1.55, opacity: 0, yPercent: -6 }, out));
    gsap.to('.hero-corners', Object.assign({ opacity: 0 }, out));
    gsap.to('.hero>.vline', Object.assign({ opacity: 0 }, out));

    // вложенный скролл финального блока: сначала он, на краях — страница
    addEventListener('wheel', e => {
      const a = e.target.closest && e.target.closest('#ask');
      if (!a) return;
      if (a.scrollHeight > a.clientHeight + 1) {
        const top = a.scrollTop <= 0, bot = a.scrollTop + a.clientHeight >= a.scrollHeight - 1;
        if ((e.deltaY > 0 && !bot) || (e.deltaY < 0 && !top)) { a.setAttribute('data-lenis-prevent', ''); return; }
      }
      a.removeAttribute('data-lenis-prevent');
    }, { capture: true, passive: true });
    new MutationObserver(() => { document.body.classList.contains('menu-open') ? lenis.stop() : lenis.start(); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* ───────── мышь: лёгкий параллакс фона ───────── */
    let mx = 0, my = 0;
    if (!coarse) addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

    /* ───────── resize / тема ───────── */
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      dustU.uPx.value = renderer.getPixelRatio(); fitHero(); measure(); repaintAll(); ScrollTrigger.refresh();
    };
    let rt = 0, lastW = innerWidth, lastH = innerHeight;
    addEventListener('resize', () => {
      /* iOS/Android: при скролле сворачивается адресная строка → меняется только высота окна на ~60–110px.
         Полная пересборка (setSize, repaintAll, ScrollTrigger.refresh) посреди скролла давала рывки — пропускаем её. */
      if (coarse && innerWidth === lastW && Math.abs(innerHeight - lastH) < Math.max(160, lastH * 0.2)) return;
      lastW = innerWidth; lastH = innerHeight;
      clearTimeout(rt); rt = setTimeout(resize, 120);
    });
    new MutationObserver(() => {
      const g = new THREE.Color(css('--gold')); archs.forEach(a => a.mats.forEach(m => m.color.copy(g))); dustU.uColor.value.copy(glassTint());
      dustMat.blending = dark() ? THREE.AdditiveBlending : THREE.NormalBlending; dustMat.needsUpdate = true; repaintAll();
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    let roRaf = 0;                                                  // изменение высоты страницы (картинки/шрифты) → пересчёт
    if (window.ResizeObserver) new ResizeObserver(() => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => { roRaf = 0; if (Math.abs(document.documentElement.scrollHeight - innerHeight - maxY) > 4) measure(); });
    }).observe(document.body);
    fitHero(); buildDots(); measure(); repaintAll();
    addEventListener('load', () => { measure(); repaintAll(); ScrollTrigger.refresh(); });

    /* ───────── кадр ───────── */
    const ask = $('#ask'), spacer = $('#ask-spacer');
    let camZ = 0, camX = 0, fov = FOV, last = performance.now(), spd = 0, frames = 0, acc = 0, tuned = false;
    gsap.ticker.add(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      const vw = innerWidth, vh = innerHeight, asp = vw / vh, sy = scrollY;
      const aTop = areas ? areas.getBoundingClientRect().top : 0;                   // чтения — до записей
      const rects = items.map(o => o.el.getBoundingClientRect());
      const spTop = spacer ? spacer.getBoundingClientRect().top : 0, askH = ask ? ask.clientHeight : 0;
      // адаптивное качество: на слабых устройствах снижаем разрешение рендера
      if (!tuned && ++frames > 40) {
        acc += dt;
        if (frames > 100) { tuned = true; if (acc / 60 > 0.034 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); renderer.setSize(vw, vh); dustU.uPx.value = 1; } }
      }

      /* — горизонтальная лента: рамы плавно сменяют друг друга по горизонтали на общем фоне сцены — */
      let vis = 0, xPx = 0, after = 0;
      if (areas && H.travel) {
        const top = aTop, n = cards.length;
        const u = cl(-top / H.travel, 0, 1);
        vis = cl((vh * 0.9 - top) / (vh * 0.6), 0, 1) * (1 - cl((-top - H.travel) / (vh * 0.6), 0, 1));
        after = cl((-top - H.travel) / (vh * 0.9), 0, 1);
        const r = cl((u - 0.08) / 0.84, 0, 1) * (n - 1);
        const s = r - 0.12 * Math.sin(r * 2 * Math.PI) / (2 * Math.PI);              // рамы чуть «присаживаются» в центр, без остановок
        xPx = s * SP;
        if (vis > 0) {
          for (let i = 0; i < n; i++) {
            const d = i - s, ad = Math.abs(d), c = cards[i];
            c.style.transform = 'translate3d(' + (d * SP).toFixed(1) + 'px,0,' + (-Math.min(ad, 2.2) * 150).toFixed(1) + 'px) rotateY(' + (-d * 10).toFixed(2) + 'deg)';
            const op = vis.toFixed(2), vs = (ad > 2.6 || vis < 0.01) ? 'hidden' : 'visible', cc = (1 - 0.55 * smooth(0.3, 1, ad)).toFixed(2), pe = ad < 1.3 ? 'auto' : 'none';
            if (c.__op !== op) { c.style.opacity = op; c.__op = op; }                    // пишем в DOM только то, что изменилось
            if (c.__vs !== vs) { c.style.visibility = vs; c.__vs = vs; }
            if (c.__cc !== cc) { c.style.setProperty('--c', cc); c.__cc = cc; }
            if (c.__pe !== pe) { c.style.pointerEvents = pe; c.__pe = pe; }
          }
          const best = cl(Math.round(s), 0, n - 1);
          if (best !== H.active) {
            H.active = best; cards.forEach((c, i) => c.classList.toggle('is-focus', i === best)); dotBtns.forEach((b, i) => b.classList.toggle('on', i === best));
            if (dotNum) dotNum.textContent = '0' + (best + 1) + ' / 0' + n;
          }
        }
      }

      /* — камера: Z по «эффективному» скроллу (в горизонтальной фазе замедляется), X едет вдоль карточек — */
      const targetZ = zAt(sy), targetX = xPx * kD0() * 0.5 * (1 - smooth(0, 1, after));
      const pz = camZ, px = camX;
      camZ += (targetZ - camZ) * 0.14; camX += (targetX - camX) * 0.14;
      const speed = (Math.abs(camZ - pz) + Math.abs(camX - px)) / Math.max(dt, 0.001);
      spd += (cl(speed * 0.05, 0, 1) - spd) * 0.08;
      fov += (FOV + cl(speed * 0.3, 0, 7) - fov) * 0.1;
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      camera.position.set(camX, 0, camZ);
      camera.rotation.set(0, 0, 0);

      back.position.x += (-mx * 1.2 - back.position.x) * 0.04;
      back.position.y += (my * 0.8 - back.position.y) * 0.04;

      // пылинки: время, подсветка от скорости камеры, масштаб пикселей
      dustU.uTime.value = now * 0.001; dustU.uSpeed.value = spd;
      dustU.uScale.value = renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);

      // фон героя: по мере ухода блока от фокуса — мягче и темнее
      const dh = camZ - HZ, dk = dark() ? 0.42 : 0.8, blur = smooth(0.1, 0.85, sy / vh), hf = smooth(0.5, 4.5, dh);
      heroBlur.visible = heroMesh.visible = dh > 0.4;
      heroBlurMat.opacity = hf; heroMat.opacity = hf * (1 - blur);
      const tint = dk * (0.4 + 0.6 * smooth(2, 12, dh)); heroMat.color.setRGB(tint, tint, tint); heroBlurMat.color.setRGB(tint, tint, tint);

      // арки: у плоскости фокуса — резкая линия, дальше/ближе — мягкое свечение (глубина резкости)
      for (const a of archs) {
        const dd = camZ - a.z, coc = cl(Math.abs(dd - D0) / 15, 0, 1);
        const f = smooth(0.8, 3.5, dd) * (1 - smooth(30, 44, dd)) * smooth(0.55 * vh, 1.2 * vh, sy) * (1 - 0.88 * vis);   // на первом экране арок нет; пока идёт лента рам, они скрыты
        const b = a.base;
        a.mats[0].opacity = f * b * Math.pow(1 - coc, 2); a.mats[1].opacity = f * b * 0.9 * smooth(0.05, 0.8, coc);
        a.g[0].visible = a.mats[0].opacity > 0.004; a.g[1].visible = a.mats[1].opacity > 0.004;
      }

      // плоскости блоков: подлёт издалека → покой (всегда в фокусе) → пролёт мимо камеры
      for (let ii = 0; ii < items.length; ii++) {
        const o = items[ii], r = rects[ii];
        if (Math.abs(r.width - o.w) > 1 || Math.abs(r.height - o.h) > 1) repaint(o);
        if (r.bottom < -vh * 0.8 || r.top > vh * 1.5 || !r.width) { o.mesh.visible = false; continue; }
        const e = ease(cl((r.top - vh * 0.5) / (vh * 0.5), 0, 1));
        const l = ease(cl((vh * 0.45 - r.bottom) / (vh * 0.6), 0, 1));
        const d = D0 * (1 + 1.7 * e) * (1 - 0.62 * l);
        const nx = (r.left + r.width / 2) / vw * 2 - 1, ny = 1 - (r.top + r.height / 2) / vh * 2;
        const k = 2 * TAN * D0 / vh;
        o.mesh.visible = true;
        o.mesh.position.set(camX + nx * TAN * asp * D0, ny * TAN * D0, camZ - d);
        o.mesh.scale.set(r.width * k, r.height * k, 1);
        o.mat.opacity = (1 - e * e) * Math.pow(1 - l, 1.3);
      }

      // финальный блок: «открывается» из-под уходящего контента (секции прозрачные)
      if (ask && spacer) {
        const c = cl(spTop - (vh - askH), 0, askH), cp = c > 0 ? 'inset(' + c.toFixed(1) + 'px 0 0 0)' : 'none';
        if (ask.__cp !== cp) { ask.style.clipPath = cp; ask.__cp = cp; }
      }
      renderer.render(scene, camera);
    });
  }
})();
