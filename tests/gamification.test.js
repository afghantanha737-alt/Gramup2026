'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    this.destination = {};
    this.resumeCalls = 0;
    this.oscillators = [];
  }

  resume() {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  createOscillator() {
    const oscillator = {
      type: '',
      frequency: { setValueAtTime(value, time) { oscillator.frequencyValue = { value, time }; } },
      connect(target) { oscillator.connectedTo = target; },
      start(time) { oscillator.startedAt = time; },
      stop(time) { oscillator.stoppedAt = time; }
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    const gain = {
      gain: {
        values: [],
        setValueAtTime(value, time) { this.values.push({ kind: 'set', value, time }); },
        exponentialRampToValueAtTime(value, time) { this.values.push({ kind: 'ramp', value, time }); }
      },
      connect(target) { this.connectedTo = target; }
    };
    return gain;
  }
}

const haptics = [];
global.window = {
  AudioContext: FakeAudioContext,
  Telegram: {
    WebApp: {
      HapticFeedback: {
        selectionChanged() { haptics.push('selection'); },
        notificationOccurred(type) { haptics.push(type); }
      }
    }
  }
};

require('../public/js/gamification.js');
const gamification = global.window.GramupGamification;
assert(gamification, 'gamification helper should attach to window');
const context = gamification.prepareAudio();
assert(context instanceof FakeAudioContext);
assert.strictEqual(context.resumeCalls, 1, 'audio should be resumed from the user gesture');

gamification.playTickSound();
assert.strictEqual(context.oscillators.length, 1, 'one tick should schedule one oscillator');
assert.strictEqual(context.oscillators[0].type, 'triangle');
assert.strictEqual(context.oscillators[0].frequencyValue.value, 400);

gamification.playWinSound();
assert.strictEqual(context.oscillators.length, 5, 'win chord should schedule four additional notes');
assert.deepStrictEqual(context.oscillators.slice(1).map(note => note.frequencyValue.value), [523.25, 659.25, 783.99, 1046.5]);

gamification.triggerHaptic('tick');
gamification.triggerHaptic('win');
gamification.triggerHaptic();
assert.deepStrictEqual(haptics, ['selection', 'success', 'selection']);

const source = fs.readFileSync(require.resolve('../public/js/gamification.js'), 'utf8');
const noAudioWindow = {};
vm.runInNewContext(source, { window: noAudioWindow });
assert.doesNotThrow(() => noAudioWindow.GramupGamification.playTickSound());
assert.doesNotThrow(() => noAudioWindow.GramupGamification.playWinSound());
noAudioWindow.GramupGamification.triggerHaptic('win');

delete global.window;
console.log('PASS — spin audio initializes lazily, schedules tick/win tones, and degrades safely without audio or Telegram haptics');
