/**
 * EcoSim Neural Network Engine
 *
 * Provides EcoSim.NeuralNetwork — a simple feedforward neural network
 * that serves as creature "brains" in the evolutionary ecosystem simulator.
 *
 * Architecture:
 *   Input (12) -> Hidden1 (10, tanh) -> Hidden2 (8, tanh) -> Output (4, tanh)
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;

  var INPUT_SIZE = Config.NN_INPUT_SIZE;    // 12
  var HIDDEN1_SIZE = Config.NN_HIDDEN1_SIZE; // 10
  var HIDDEN2_SIZE = Config.NN_HIDDEN2_SIZE; // 8
  var OUTPUT_SIZE = Config.NN_OUTPUT_SIZE;   // 4

  // Pre-computed sizes for weight matrices (flat, row-major)
  var W1_LEN = INPUT_SIZE * HIDDEN1_SIZE;   // 120
  var W2_LEN = HIDDEN1_SIZE * HIDDEN2_SIZE; // 80
  var W3_LEN = HIDDEN2_SIZE * OUTPUT_SIZE;  // 32

  // ---------------------------------------------------------------
  // Fast tanh — just delegates to the native implementation which
  // modern engines already optimize with SIMD / intrinsics.
  // ---------------------------------------------------------------
  var tanh = Math.tanh;

  // ---------------------------------------------------------------
  // Utility: create a Float32Array filled with uniform random in [-1, 1]
  // ---------------------------------------------------------------
  function randomWeights(length) {
    var arr = new Float32Array(length);
    for (var i = 0; i < length; i++) {
      arr[i] = Math.random() * 2 - 1;
    }
    return arr;
  }

  // ---------------------------------------------------------------
  // Utility: create a zero-filled Float32Array
  // ---------------------------------------------------------------
  function zeroBiases(length) {
    return new Float32Array(length); // already zero-filled
  }

  // ---------------------------------------------------------------
  // Utility: deep-copy a Float32Array
  // ---------------------------------------------------------------
  function copyF32(src) {
    return new Float32Array(src);
  }

  // ---------------------------------------------------------------
  // Utility: clamp value to [-2, 2]
  // ---------------------------------------------------------------
  function clamp(v) {
    return v < -2 ? -2 : (v > 2 ? 2 : v);
  }

  // ---------------------------------------------------------------
  // Rough gaussian-ish random: sum of 3 uniform randoms centered
  // at 0, scaled by strength. Range approx [-1.5*strength, 1.5*strength]
  // with a bell-curve-like distribution.
  // ---------------------------------------------------------------
  function gaussianIsh(strength) {
    return ((Math.random() + Math.random() + Math.random()) / 3 * 2 - 1) * strength * 3;
    // Explanation:
    //   (r1+r2+r3) is in [0,3]. Divide by 3 -> [0,1]. *2-1 -> [-1,1].
    //   Multiply by strength*3 so that the standard-deviation-equivalent
    //   magnitude is roughly `strength`. The factor 3 compensates for the
    //   division by 3.
  }

  // ===============================================================
  // NeuralNetwork class
  // ===============================================================

  /**
   * @param {Object} [genome] - Optional genome object with typed arrays.
   */
  function NeuralNetwork(genome) {
    if (genome) {
      // Deep-copy from provided genome
      this.weights1 = copyF32(genome.weights1);
      this.biases1  = copyF32(genome.biases1);
      this.weights2 = copyF32(genome.weights2);
      this.biases2  = copyF32(genome.biases2);
      this.weights3 = copyF32(genome.weights3);
      this.biases3  = copyF32(genome.biases3);
    } else {
      // Random initialization
      this.weights1 = randomWeights(W1_LEN);
      this.biases1  = zeroBiases(HIDDEN1_SIZE);
      this.weights2 = randomWeights(W2_LEN);
      this.biases2  = zeroBiases(HIDDEN2_SIZE);
      this.weights3 = randomWeights(W3_LEN);
      this.biases3  = zeroBiases(OUTPUT_SIZE);
    }

    // Pre-allocate arrays for intermediate activations (avoids GC in hot path)
    this.lastInputs  = new Float32Array(INPUT_SIZE);
    this.lastHidden1 = new Float32Array(HIDDEN1_SIZE);
    this.lastHidden2 = new Float32Array(HIDDEN2_SIZE);
    this.lastOutputs  = new Float32Array(OUTPUT_SIZE);
  }

  // ---------------------------------------------------------------
  // forward(inputs)
  //
  // Hot path — called 60 fps * hundreds of creatures.
  // All inner loops are kept tight; no allocations; typed arrays.
  // ---------------------------------------------------------------
  NeuralNetwork.prototype.forward = function (inputs) {
    var i, j, sum, offset;

    var w1 = this.weights1;
    var b1 = this.biases1;
    var w2 = this.weights2;
    var b2 = this.biases2;
    var w3 = this.weights3;
    var b3 = this.biases3;

    var lastInputs  = this.lastInputs;
    var lastHidden1 = this.lastHidden1;
    var lastHidden2 = this.lastHidden2;
    var lastOutputs = this.lastOutputs;

    // Store inputs
    for (i = 0; i < INPUT_SIZE; i++) {
      lastInputs[i] = inputs[i];
    }

    // --- Layer 1: Input -> Hidden1 ---
    // weights1 is row-major 12x10: row i has 10 elements for input neuron i
    // hidden1[j] = tanh( sum_i(input[i] * weights1[i * HIDDEN1_SIZE + j]) + bias1[j] )
    for (j = 0; j < HIDDEN1_SIZE; j++) {
      sum = b1[j];
      for (i = 0; i < INPUT_SIZE; i++) {
        sum += inputs[i] * w1[i * HIDDEN1_SIZE + j];
      }
      lastHidden1[j] = tanh(sum);
    }

    // --- Layer 2: Hidden1 -> Hidden2 ---
    for (j = 0; j < HIDDEN2_SIZE; j++) {
      sum = b2[j];
      for (i = 0; i < HIDDEN1_SIZE; i++) {
        sum += lastHidden1[i] * w2[i * HIDDEN2_SIZE + j];
      }
      lastHidden2[j] = tanh(sum);
    }

    // --- Layer 3: Hidden2 -> Output ---
    for (j = 0; j < OUTPUT_SIZE; j++) {
      sum = b3[j];
      for (i = 0; i < HIDDEN2_SIZE; i++) {
        sum += lastHidden2[i] * w3[i * OUTPUT_SIZE + j];
      }
      lastOutputs[j] = tanh(sum);
    }

    // Return a plain Array for consumer convenience (lightweight copy)
    return [lastOutputs[0], lastOutputs[1], lastOutputs[2], lastOutputs[3]];
  };

  // ---------------------------------------------------------------
  // getGenome() — deep copy of all weight/bias arrays
  // ---------------------------------------------------------------
  NeuralNetwork.prototype.getGenome = function () {
    return {
      weights1: copyF32(this.weights1),
      biases1:  copyF32(this.biases1),
      weights2: copyF32(this.weights2),
      biases2:  copyF32(this.biases2),
      weights3: copyF32(this.weights3),
      biases3:  copyF32(this.biases3)
    };
  };

  // ---------------------------------------------------------------
  // mutate(rate, strength)
  //
  // Mutates weights and biases in-place using a rough gaussian
  // perturbation. Clamps weights to [-2, 2].
  // ---------------------------------------------------------------
  NeuralNetwork.prototype.mutate = function (rate, strength) {
    rate     = rate     !== undefined ? rate     : 0.15;
    strength = strength !== undefined ? strength : 0.25;

    var arrays = [
      this.weights1, this.biases1,
      this.weights2, this.biases2,
      this.weights3, this.biases3
    ];

    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a];
      var len = arr.length;
      for (var i = 0; i < len; i++) {
        if (Math.random() < rate) {
          arr[i] = clamp(arr[i] + gaussianIsh(strength));
        }
      }
    }
  };

  // ---------------------------------------------------------------
  // static crossover(parent1, parent2)
  //
  // Single-point crossover for weight arrays; per-element random
  // selection for bias arrays. Returns a new NeuralNetwork.
  // ---------------------------------------------------------------
  NeuralNetwork.crossover = function (parent1, parent2) {
    var genome = {};

    // Weight arrays: single-point crossover
    var weightKeys = ['weights1', 'weights2', 'weights3'];
    for (var w = 0; w < weightKeys.length; w++) {
      var key = weightKeys[w];
      var p1 = parent1[key];
      var p2 = parent2[key];
      var len = p1.length;
      var child = new Float32Array(len);
      var crossPoint = Math.floor(Math.random() * len);
      var i;
      for (i = 0; i < crossPoint; i++) {
        child[i] = p1[i];
      }
      for (i = crossPoint; i < len; i++) {
        child[i] = p2[i];
      }
      genome[key] = child;
    }

    // Bias arrays: per-element random pick from either parent
    var biasKeys = ['biases1', 'biases2', 'biases3'];
    for (var b = 0; b < biasKeys.length; b++) {
      var bkey = biasKeys[b];
      var bp1 = parent1[bkey];
      var bp2 = parent2[bkey];
      var blen = bp1.length;
      var bchild = new Float32Array(blen);
      for (var bi = 0; bi < blen; bi++) {
        bchild[bi] = Math.random() < 0.5 ? bp1[bi] : bp2[bi];
      }
      genome[bkey] = bchild;
    }

    return new NeuralNetwork(genome);
  };

  // ---------------------------------------------------------------
  // static fromGenome(genome) — construct from genome (deep copies)
  // ---------------------------------------------------------------
  NeuralNetwork.fromGenome = function (genome) {
    return new NeuralNetwork(genome);
  };

  // ---------------------------------------------------------------
  // totalWeightCount() — total number of trainable parameters
  // ---------------------------------------------------------------
  NeuralNetwork.prototype.totalWeightCount = function () {
    return this.weights1.length + this.biases1.length +
           this.weights2.length + this.biases2.length +
           this.weights3.length + this.biases3.length;
  };

  // ---------------------------------------------------------------
  // getComplexity() — average absolute weight value across all
  // weights and biases. Higher = more "decisive" network.
  // ---------------------------------------------------------------
  NeuralNetwork.prototype.getComplexity = function () {
    var total = 0;
    var count = 0;

    var arrays = [
      this.weights1, this.biases1,
      this.weights2, this.biases2,
      this.weights3, this.biases3
    ];

    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a];
      var len = arr.length;
      for (var i = 0; i < len; i++) {
        total += Math.abs(arr[i]);
      }
      count += len;
    }

    return count > 0 ? total / count : 0;
  };

  // ---------------------------------------------------------------
  // Expose tanh as a static method for external use / testing
  // ---------------------------------------------------------------
  NeuralNetwork.tanh = tanh;

  // ---------------------------------------------------------------
  // Attach to EcoSim namespace
  // ---------------------------------------------------------------
  EcoSim.NeuralNetwork = NeuralNetwork;

})();
