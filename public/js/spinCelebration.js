(function attachGramupSpinCelebration(root) {
  'use strict';

  const COLORS = ['#38bdf8', '#39e5cf', '#fbbf24', '#a78bfa', '#f472b6', '#e2f7ff'];

  function prizeIconMarkup(prizeId, amount) {
    if (prizeId === 'hashrate_boost_10_1h') {
      return '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 23c13-13 35-13 48 0L44 35c-7-7-17-7-24 0L8 23Z"/><path d="m25 39 26 24M17 47l-8 8"/></svg>';
    }
    if (prizeId === 'gram_005') {
      return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="25" stroke="currentColor" stroke-width="4"/><path d="M24 20h19v8H31v8h12v8H31v8h-8V24a4 4 0 0 1 4-4Z" fill="currentColor"/></svg>';
    }
    if (prizeId === 'try_again' || Number(amount) <= 0) {
      return '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M52 22V9L41 20M12 31a21 21 0 0 1 36-13l4 4M12 42v13l11-11m29-1a21 21 0 0 1-36 13l-4-4"/></svg>';
    }
    return '<img src="/img/gramup-logo-cube-transparent.png" alt="" aria-hidden="true">';
  }

  function fireConfetti() {
    if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = root.document.createElement('canvas');
    canvas.className = 'spinCelebrationCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d');
    if (!context) return;

    const resize = () => {
      const ratio = Math.min(Number(root.devicePixelRatio) || 1, 2);
      canvas.width = Math.max(1, Math.floor(root.innerWidth * ratio));
      canvas.height = Math.max(1, Math.floor(root.innerHeight * ratio));
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    root.document.body.appendChild(canvas);
    root.addEventListener('resize', resize, { passive: true });

    const width = () => root.innerWidth;
    const height = () => root.innerHeight;
    const particles = Array.from({ length: 96 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 5.8;
      return {
        x: width() / 2,
        y: height() * 0.38,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.6,
        gravity: 0.045 + Math.random() * 0.045,
        width: 4 + Math.random() * 5,
        height: 3 + Math.random() * 5,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.22,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      };
    });
    const startedAt = Date.now();
    const requestFrame = typeof root.requestAnimationFrame === 'function'
      ? root.requestAnimationFrame.bind(root)
      : callback => root.setTimeout(() => callback(Date.now()), 16);

    const draw = () => {
      const elapsed = Date.now() - startedAt;
      context.clearRect(0, 0, width(), height());
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.gravity;
        particle.angle += particle.spin;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.angle);
        context.fillStyle = particle.color;
        context.globalAlpha = Math.max(0, 1 - elapsed / 2300);
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        context.restore();
      }
      if (elapsed < 2300 && canvas.isConnected) requestFrame(draw);
      else {
        root.removeEventListener('resize', resize);
        canvas.remove();
      }
    };
    requestFrame(draw);
  }

  function shareResult(options) {
    const url = String(options.appUrl || `${root.location?.origin || ''}${root.location?.pathname || '/'}`);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(String(options.shareText || ''))}`;
    const telegram = root.Telegram?.WebApp;
    try {
      if (typeof telegram?.openTelegramLink === 'function') {
        telegram.openTelegramLink(shareUrl);
        return;
      }
    } catch {
      // Fall through to the browser link if Telegram's WebApp bridge is unavailable.
    }
    root.open?.(shareUrl, '_blank', 'noopener,noreferrer');
  }

  function show(options = {}) {
    const doc = root.document;
    doc.querySelector('[data-spin-win-modal]')?.remove();
    if (Number(options.amount) > 0) fireConfetti();

    const overlay = doc.createElement('div');
    overlay.className = 'spinWinModalOverlay';
    overlay.dataset.spinWinModal = 'true';
    overlay.setAttribute('role', 'presentation');

    const dialog = doc.createElement('section');
    dialog.className = 'spinWinDialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'spinWinTitle');
    dialog.setAttribute('aria-describedby', 'spinWinDescription');
    dialog.setAttribute('tabindex', '-1');

    const icon = doc.createElement('div');
    icon.className = 'spinWinIcon';
    icon.innerHTML = prizeIconMarkup(String(options.prizeId || ''), Number(options.amount) || 0);

    const title = doc.createElement('h2');
    title.id = 'spinWinTitle';
    title.textContent = String(options.title || 'You won!');

    const prize = doc.createElement('strong');
    prize.className = 'spinWinPrize';
    prize.textContent = String(options.prizeLabel || 'Spinner reward');

    const description = doc.createElement('p');
    description.id = 'spinWinDescription';
    description.className = 'spinWinDescription';
    description.textContent = String(options.subtitle || 'Your reward has been added to your balance.');

    const actions = doc.createElement('div');
    actions.className = 'spinWinActions';

    const claim = doc.createElement('button');
    claim.type = 'button';
    claim.className = 'spinWinClaim';
    claim.textContent = String(options.claimLabel || 'Claim prize');
    claim.addEventListener('click', () => {
      overlay.remove();
      const nextAction = doc.querySelector('#spinButton:not(:disabled), [data-paid-spin]:not(:disabled)');
      try { nextAction?.focus({ preventScroll: true }); } catch { nextAction?.focus(); }
    });

    const share = doc.createElement('button');
    share.type = 'button';
    share.className = 'spinWinShare';
    share.textContent = String(options.shareLabel || 'Share result');
    share.addEventListener('click', () => shareResult(options));

    actions.append(claim, share);
    dialog.append(icon, title, prize, description, actions);
    overlay.appendChild(dialog);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        overlay.remove();
      }
    });
    doc.body.appendChild(overlay);
    try { claim.focus({ preventScroll: true }); } catch { claim.focus(); }
    return overlay;
  }

  root.GramupSpinCelebration = Object.freeze({ show, shareResult });
})(window);
