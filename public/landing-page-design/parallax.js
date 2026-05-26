// Lightweight parallax + scroll reveal
(function(){
  const els = Array.from(document.querySelectorAll('[data-parallax]'));
  // Store each element's offsetTop (relative to viewport center anchor) once
  let metrics = [];
  function recompute(){
    metrics = els.map(el => {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      return {
        el,
        anchor: top + r.height / 2,
        speed: parseFloat(el.dataset.speed || '0.1'),
        tilt: parseFloat(el.dataset.tilt || '0'),
      };
    });
  }
  recompute();
  window.addEventListener('resize', recompute);
  window.addEventListener('load', recompute);

  let ticking = false;
  function onScroll(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const vh = window.innerHeight;
      const centerY = window.scrollY + vh / 2;
      metrics.forEach(m => {
        const delta = (centerY - m.anchor); // px from screen center
        const ty = -delta * m.speed;
        if (m.tilt) {
          m.el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) rotate(${m.tilt}deg)`;
        } else {
          m.el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0)`;
        }
      });
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Nav scrolled state
  const nav = document.querySelector('.nav');
  window.addEventListener('scroll', () => {
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
  }, { passive: true });

  // Apply data-tilt rotation as a CSS var fallback for elements that aren't parallaxed
  document.querySelectorAll('[data-tilt]').forEach(el => {
    if (!el.dataset.parallax && !el.hasAttribute('data-parallax')) {
      el.style.setProperty('--tilt', el.dataset.tilt + 'deg');
    }
  });

  // Reveal on intersect
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-in'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.section__hd, .bento__card, .obj-card, .price-card, .floating-file, .connect__source')
    .forEach(el => { el.classList.add('reveal'); io.observe(el); });
})();
