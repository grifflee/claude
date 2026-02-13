/**
 * EcoSim — Creature Sound System (WebAudio)
 *
 * Creates an ambient soundscape driven by creature activity.
 * Uses WebAudio API oscillators — no audio files needed.
 *
 * All sounds are very quiet (master gain 0.08) to create a
 * subtle, atmospheric backdrop rather than in-your-face SFX.
 *
 * Dependencies: EcoSim.Config, EcoSim.Events
 * Load after: config.js
 * Load before: main.js
 */
(function () {
    'use strict';

    var Config = EcoSim.Config;
    var Events = EcoSim.Events;

    var Sound = {};

    // ---- State ----
    var audioCtx = null;
    var masterGain = null;
    var enabled = false;
    var initialized = false;

    // Ambient drone nodes
    var ambientOsc1 = null;
    var ambientOsc2 = null;
    var ambientGain = null;
    var ambientLfoOsc = null;
    var ambientLfoGain = null;

    // ---- Gain levels ----
    var MASTER_VOLUME = 0.08;
    var AMBIENT_GAIN = 0.03;
    var EAT_GAIN = 0.04;
    var ATTACK_GAIN = 0.06;
    var REPRODUCE_GAIN = 0.08;
    var DEATH_GAIN = 0.05;

    // ---- Throttling ----
    // Only allow one sound of each type per THROTTLE_MS milliseconds
    var THROTTLE_MS = 100;
    var lastPlayTime = {
        eat: 0,
        attack: 0,
        reproduce: 0,
        die: 0
    };

    // Current population for ambient modulation
    var currentPopulation = 0;

    // ================================================================
    // Initialization
    // ================================================================

    /**
     * Initialize the sound system.
     * Creates AudioContext lazily — actual audio starts on first toggle.
     * Registers event listeners for creature activity.
     */
    Sound.init = function () {
        if (initialized) return;
        initialized = true;

        // Register event listeners (will be no-ops until enabled)
        Events.on('creature:eat', onCreatureEat);
        Events.on('creature:attack', onCreatureAttack);
        Events.on('creature:reproduce', onCreatureReproduce);
        Events.on('creature:die', onCreatureDie);
    };

    /**
     * Create the AudioContext and set up the audio graph.
     * Must be called from a user gesture (click/keypress) to
     * satisfy browser autoplay policy.
     */
    function createAudioContext() {
        if (audioCtx) return;

        try {
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                console.warn('EcoSim Sound: WebAudio not supported in this browser.');
                return;
            }
            audioCtx = new AudioContextClass();

            // Master gain — everything routes through this
            masterGain = audioCtx.createGain();
            masterGain.gain.value = MASTER_VOLUME;
            masterGain.connect(audioCtx.destination);

            setupAmbientDrone();
        } catch (e) {
            console.warn('EcoSim Sound: Failed to create AudioContext:', e);
            audioCtx = null;
        }
    }

    // ================================================================
    // Ambient Drone
    // ================================================================

    /**
     * Set up a quiet, slowly modulating ambient drone.
     * Two detuned sine oscillators create a gentle beating effect.
     * An LFO modulates the gain for a breathing quality.
     */
    function setupAmbientDrone() {
        if (!audioCtx) return;

        // Gain node for ambient sounds
        ambientGain = audioCtx.createGain();
        ambientGain.gain.value = AMBIENT_GAIN;
        ambientGain.connect(masterGain);

        // Primary drone oscillator — very low frequency
        ambientOsc1 = audioCtx.createOscillator();
        ambientOsc1.type = 'sine';
        ambientOsc1.frequency.value = 55; // A1, deep bass
        ambientOsc1.connect(ambientGain);
        ambientOsc1.start();

        // Secondary oscillator — slightly detuned for beating
        ambientOsc2 = audioCtx.createOscillator();
        ambientOsc2.type = 'sine';
        ambientOsc2.frequency.value = 55.3; // slight detune for ~0.3Hz beat
        ambientOsc2.connect(ambientGain);
        ambientOsc2.start();

        // LFO to slowly modulate ambient gain (breathing effect)
        ambientLfoOsc = audioCtx.createOscillator();
        ambientLfoOsc.type = 'sine';
        ambientLfoOsc.frequency.value = 0.08; // very slow modulation ~12s cycle
        ambientLfoOsc.start();

        ambientLfoGain = audioCtx.createGain();
        ambientLfoGain.gain.value = AMBIENT_GAIN * 0.4; // modulation depth

        ambientLfoOsc.connect(ambientLfoGain);
        ambientLfoGain.connect(ambientGain.gain);
    }

    /**
     * Update the ambient drone based on current population.
     * More creatures = slightly higher pitch and richer harmonics.
     * Call this periodically (e.g., every few frames from main loop).
     */
    Sound.updateAmbient = function (population) {
        if (!audioCtx || !enabled) return;

        currentPopulation = population || 0;

        // Map population (0-350) to frequency offset (0-30 Hz)
        var maxPop = Config.MAX_CREATURES || 350;
        var popRatio = Math.min(currentPopulation / maxPop, 1);

        // Base 55Hz, up to ~85Hz with full population
        var baseFreq = 55 + popRatio * 30;

        // Smooth transition over 2 seconds
        var now = audioCtx.currentTime;
        if (ambientOsc1) {
            ambientOsc1.frequency.linearRampToValueAtTime(baseFreq, now + 2);
        }
        if (ambientOsc2) {
            ambientOsc2.frequency.linearRampToValueAtTime(baseFreq + 0.3 + popRatio * 1.5, now + 2);
        }

        // More population = slightly louder drone (still very quiet)
        if (ambientGain) {
            var targetGain = AMBIENT_GAIN * (0.6 + popRatio * 0.4);
            ambientGain.gain.linearRampToValueAtTime(targetGain, now + 2);
        }
    };

    // ================================================================
    // Toggle / Enable / Disable
    // ================================================================

    /**
     * Toggle sound on/off.
     * Creates AudioContext on first enable (needs user gesture).
     */
    Sound.toggle = function () {
        if (!enabled) {
            Sound.enable();
        } else {
            Sound.disable();
        }
        return enabled;
    };

    Sound.enable = function () {
        createAudioContext();
        if (!audioCtx) return;

        // Resume context if suspended (browser autoplay policy)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        enabled = true;
        masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, audioCtx.currentTime + 0.3);
    };

    Sound.disable = function () {
        enabled = false;
        if (audioCtx && masterGain) {
            // Fade out gently
            masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        }
    };

    Sound.isEnabled = function () {
        return enabled;
    };

    // ================================================================
    // Sound Generators — one-shot oscillators
    // ================================================================

    /**
     * Play a short sine "blip" when a creature eats.
     * High pitch, very soft, quick decay.
     */
    function playEatSound() {
        if (!audioCtx) return;

        var now = audioCtx.currentTime;
        var duration = 0.08;

        // Gain envelope
        var gain = audioCtx.createGain();
        gain.gain.setValueAtTime(EAT_GAIN, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        gain.connect(masterGain);

        // High-pitched sine blip
        var osc = audioCtx.createOscillator();
        osc.type = 'sine';
        // Randomize pitch slightly for variety (800-1200 Hz)
        osc.frequency.value = 800 + Math.random() * 400;
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + duration + 0.01);
    }

    /**
     * Play a brief harsh buzz when a creature attacks.
     * Sawtooth wave, mid pitch, very short.
     */
    function playAttackSound() {
        if (!audioCtx) return;

        var now = audioCtx.currentTime;
        var duration = 0.06;

        var gain = audioCtx.createGain();
        gain.gain.setValueAtTime(ATTACK_GAIN, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        gain.connect(masterGain);

        var osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        // Mid-range buzz (200-350 Hz), randomized slightly
        osc.frequency.value = 200 + Math.random() * 150;
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + duration + 0.01);
    }

    /**
     * Play a gentle chime when a creature reproduces.
     * Two sine tones in harmony (perfect fifth), medium duration.
     */
    function playReproduceSound() {
        if (!audioCtx) return;

        var now = audioCtx.currentTime;
        var duration = 0.25;

        var gain = audioCtx.createGain();
        gain.gain.setValueAtTime(REPRODUCE_GAIN, now);
        gain.gain.setValueAtTime(REPRODUCE_GAIN, now + duration * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        gain.connect(masterGain);

        // Root note (randomized for variety: C5-G5 range)
        var rootFreq = 523 + Math.random() * 260;

        var osc1 = audioCtx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = rootFreq;
        osc1.connect(gain);
        osc1.start(now);
        osc1.stop(now + duration + 0.01);

        // Perfect fifth above root
        var osc2 = audioCtx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = rootFreq * 1.5;
        osc2.connect(gain);
        osc2.start(now);
        osc2.stop(now + duration + 0.01);
    }

    /**
     * Play a low descending tone when a creature dies.
     * Sine wave with pitch dropping over time.
     */
    function playDeathSound() {
        if (!audioCtx) return;

        var now = audioCtx.currentTime;
        var duration = 0.3;

        var gain = audioCtx.createGain();
        gain.gain.setValueAtTime(DEATH_GAIN, now);
        gain.gain.setValueAtTime(DEATH_GAIN * 0.8, now + duration * 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        gain.connect(masterGain);

        var osc = audioCtx.createOscillator();
        osc.type = 'sine';
        // Start at mid-low pitch, descend
        var startFreq = 220 + Math.random() * 60;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(startFreq * 0.4, now + duration);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + duration + 0.01);
    }

    // ================================================================
    // Event Handlers (with throttling)
    // ================================================================

    function canPlay(type) {
        var now = performance.now();
        if (now - lastPlayTime[type] < THROTTLE_MS) return false;
        lastPlayTime[type] = now;
        return true;
    }

    function onCreatureEat() {
        if (!enabled) return;
        if (!canPlay('eat')) return;
        playEatSound();
    }

    function onCreatureAttack() {
        if (!enabled) return;
        if (!canPlay('attack')) return;
        playAttackSound();
    }

    function onCreatureReproduce() {
        if (!enabled) return;
        if (!canPlay('reproduce')) return;
        playReproduceSound();
    }

    function onCreatureDie() {
        if (!enabled) return;
        if (!canPlay('die')) return;
        playDeathSound();
    }

    // ================================================================
    // Master Volume Control
    // ================================================================

    /**
     * Set master volume (0.0 to 1.0).
     * The value is multiplied by the internal MASTER_VOLUME cap.
     */
    Sound.setVolume = function (level) {
        level = Math.max(0, Math.min(1, level));
        MASTER_VOLUME = level * 0.15; // max 0.15 even at full
        if (audioCtx && masterGain && enabled) {
            masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, audioCtx.currentTime + 0.1);
        }
    };

    /**
     * Clean up all audio nodes. Call on reset or page unload.
     */
    Sound.destroy = function () {
        enabled = false;
        if (ambientOsc1) { try { ambientOsc1.stop(); } catch (e) {} }
        if (ambientOsc2) { try { ambientOsc2.stop(); } catch (e) {} }
        if (ambientLfoOsc) { try { ambientLfoOsc.stop(); } catch (e) {} }
        ambientOsc1 = null;
        ambientOsc2 = null;
        ambientLfoOsc = null;
        ambientLfoGain = null;
        ambientGain = null;
        if (audioCtx) {
            try { audioCtx.close(); } catch (e) {}
            audioCtx = null;
        }
        masterGain = null;
        initialized = false;
    };

    // ================================================================
    // Attach to namespace
    // ================================================================

    EcoSim.Sound = Sound;

})();
