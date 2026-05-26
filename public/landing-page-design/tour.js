// ════════════════════════════════════════════════════════════
// SheetCanvas tour — parallax + progress + dark-theme toggle
// ════════════════════════════════════════════════════════════
(function(){
  // ── theme ─────────────────────────────────────────────────
  const root = document.documentElement;
  const themeBtn = document.querySelector('.theme-toggle');
  const STORAGE_KEY = 'sheetcanvas-theme';
  function applyTheme(t){
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    if (themeBtn){
      themeBtn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }
  const stored = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch(_){ return null; } })();
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  if (themeBtn){
    themeBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch(_){}
    });
  }
  // follow system if user has not explicitly chosen
  if (window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', e => {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch(_){}
      if (!saved) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  // ── parallax ──────────────────────────────────────────────
  const els = Array.from(document.querySelectorAll('[data-parallax]'));
  let metrics = [];
  function recompute(){
    metrics = els.map(el => {
      const r = el.getBoundingClientRect();
      return {
        el,
        anchor: r.top + window.scrollY + r.height / 2,
        speed: parseFloat(el.dataset.speed || '0.1'),
        tilt: parseFloat(el.dataset.tilt || '0'),
      };
    });
  }
  recompute();
  window.addEventListener('resize', recompute);
  window.addEventListener('load', recompute);

  // ── progress rail tracking ────────────────────────────────
  const railList = document.querySelector('.progress-rail__list');
  const railNum = document.getElementById('prog-now');
  const railLabel = document.getElementById('prog-label');
  const railEl = document.querySelector('.progress-rail');
  const nav = document.querySelector('.nav');
  const sections = Array.from(document.querySelectorAll('.step, .cta'));

  // click-to-scroll on rail dots
  if (railList) {
    railList.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const idx = parseInt(li.dataset.step, 10);
        const target = idx === 0 ? document.body : document.querySelector(`#step-${String(idx).padStart(2, '0')}`);
        if (target) window.scrollTo({ top: target === document.body ? 0 : target.offsetTop - 20, behavior: 'smooth' });
      });
    });
  }

  // ── scroll handler ─────────────────────────────────────────
  let ticking = false;
  let activeStep = -1;
  function onScroll(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const sy = window.scrollY;
      const vh = window.innerHeight;
      const centerY = sy + vh / 2;

      // parallax
      metrics.forEach(m => {
        const delta = centerY - m.anchor;
        const ty = -delta * m.speed;
        if (m.tilt) {
          m.el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) rotate(${m.tilt}deg)`;
        } else {
          m.el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0)`;
        }
      });

      // active step (whichever section's center is closest to viewport center)
      let bestI = 0;
      let bestDist = Infinity;
      sections.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const sCenter = r.top + r.height / 2;
        const d = Math.abs(sCenter - vh / 2);
        if (d < bestDist) { bestDist = d; bestI = i; }
      });

      if (bestI !== activeStep) {
        activeStep = bestI;
        // update rail dots (0..9 — last "cta" maps to 9 stays as is)
        if (railList) {
          railList.querySelectorAll('li').forEach((li, idx) => {
            li.classList.toggle('is-active', idx === bestI);
          });
        }
        // update num + label
        if (railNum) railNum.textContent = String(Math.min(bestI, 9)).padStart(2, '0');
        if (railLabel) {
          const labels = ['intro', 'why', 'import', 'command', 'sort & filter', 'charts', 'pivots', 'notes', 'connect', 'pricing', 'download'];
          railLabel.textContent = labels[bestI] || '';
        }
      }

      // dark theme detection
      const active = sections[bestI];
      const isDark = active && (active.classList.contains('step--dark') || active.classList.contains('cta'));
      nav?.classList.toggle('is-on-dark', isDark);
      railEl?.classList.toggle('is-on-dark', isDark);
      nav?.classList.toggle('is-scrolled', sy > 8);

      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── reveal on intersect ───────────────────────────────────
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-in'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.step__text, .visual-frame, .price-card').forEach(el => {
    el.classList.add('reveal'); io.observe(el);
  });
})();
