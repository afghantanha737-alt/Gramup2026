(function attachGramupGamification(root) {
  'use strict';

  let audioContext = null;

  function getAudioContext() {
    const AudioContextConstructor = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextConstructor) return null;
    if (audioContext) return audioContext;
    try {
      audioContext = new AudioContextConstructor();
      return audioContext;
    } catch {
      return null;
    }
  }

  function prepareAudio() {
    const context = getAudioContext();
    if (context?.state === 'suspended' && typeof context.resume === 'function') {
      try {
        const resumeResult = context.resume();
        if (resumeResult && typeof resumeResult.catch === 'function') resumeResult.catch(() => {});
      } catch {
        // Audio may be unavailable or blocked; haptic feedback remains independent.
      }
    }
    return context;
  }

  function playTickSound() {
    const context = prepareAudio();
    if (!context) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(400, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.05);
    } catch {
      // Keep audio failures from interrupting the spin or its API request.
    }
  }

  function playWinSound() {
    const context = prepareAudio();
    if (!context) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      try {
        const startAt = context.currentTime + index * 0.1;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.15, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.3);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.3);
      } catch {
        // A single unsupported note should not suppress remaining notes.
      }
    });
  }

  function triggerHaptic(type = 'selection') {
    const feedback = root.Telegram?.WebApp?.HapticFeedback;
    if (!feedback) return;
    try {
      if (type === 'tick' || type === 'selection') {
        feedback.selectionChanged?.();
      } else if (type === 'win') {
        feedback.notificationOccurred?.('success');
      }
    } catch {
      // Telegram haptics are optional and may be unavailable on some clients.
    }
  }

  root.GramupGamification = Object.freeze({
    prepareAudio,
    playTickSound,
    playWinSound,
    triggerHaptic
  });
})(window);
