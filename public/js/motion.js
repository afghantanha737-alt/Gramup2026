/* Gramup shared motion layer for standalone pages. */
(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('click', event => {
    const target = event.target?.closest?.('button, a, [role="button"]');
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    target.querySelectorAll(':scope > .ripple').forEach(item => item.remove());
    target.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 650);
  }, { passive: true });
  if (reduced) return;
  document.querySelectorAll('.hero, .landingHero, .proofHero, .content, .item, .card, .notice').forEach((element, index) => {
    element.style.setProperty('--motion-index', String(Math.min(index, 12)));
    element.classList.add('motionReveal');
  });
})();
