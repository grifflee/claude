// ============================================================
// EcoSim - Evolutionary Ecosystem Simulator
// Shared Configuration & Interface Contracts
// ============================================================

window.EcoSim = window.EcoSim || {};

EcoSim.Config = {
  // ---- World ----
  WORLD_WIDTH: 1600,
  WORLD_HEIGHT: 900,
  GRID_CELL_SIZE: 50,          // spatial partitioning cell size

  // ---- Creatures ----
  INITIAL_CREATURE_COUNT: 60,
  MAX_CREATURES: 350,
  CREATURE_MIN_SIZE: 4,
  CREATURE_MAX_SIZE: 14,
  CREATURE_MAX_SPEED: 3.5,
  CREATURE_TURN_SPEED: 0.15,
  CREATURE_INITIAL_ENERGY: 100,
  CREATURE_MAX_ENERGY: 250,
  CREATURE_ENERGY_DRAIN: 0.08,       // base energy cost per tick
  CREATURE_MOVE_ENERGY_COST: 0.015,  // per speed unit per tick
  CREATURE_SIZE_ENERGY_COST: 0.004,  // per size unit per tick
  CREATURE_REPRODUCTION_THRESHOLD: 160,
  CREATURE_REPRODUCTION_COST: 70,
  CREATURE_MIN_REPRODUCTION_AGE: 200,
  CREATURE_REPRODUCTION_COOLDOWN: 100,
  CREATURE_ATTACK_ENERGY_GAIN: 50,
  CREATURE_ATTACK_RANGE: 20,
  CREATURE_VISION_RANGE: 120,
  CREATURE_EAT_RANGE: 10,

  // ---- Neural Network ----
  // Inputs (12):
  //   0-1: nearest food dx, dy (normalized)
  //   2:   nearest food distance (normalized 0-1)
  //   3-4: nearest creature dx, dy (normalized)
  //   5:   nearest creature distance (normalized 0-1)
  //   6:   nearest creature relative size (-1 to 1)
  //   7:   own energy level (normalized 0-1)
  //   8-9: wall proximity left/right (0-1, 1=touching)
  //   10-11: wall proximity up/down (0-1, 1=touching)
  NN_INPUT_SIZE: 12,
  NN_HIDDEN1_SIZE: 10,
  NN_HIDDEN2_SIZE: 8,
  // Outputs (4):
  //   0: turn amount (-1 left to 1 right)
  //   1: speed (0 to 1)
  //   2: desire to eat/attack (>0.5 = try)
  //   3: desire to reproduce (>0.5 = try if eligible)
  NN_OUTPUT_SIZE: 4,

  // ---- Food ----
  FOOD_SPAWN_RATE: 0.6,       // avg food spawned per tick
  FOOD_MAX_COUNT: 250,
  FOOD_ENERGY: 35,
  FOOD_SIZE: 3,
  FOOD_CLUSTER_CHANCE: 0.3,    // chance food spawns near existing food
  FOOD_CLUSTER_RADIUS: 60,

  // ---- Genetics ----
  MUTATION_RATE: 0.15,          // chance each gene mutates
  MUTATION_STRENGTH: 0.25,      // max magnitude of mutation
  CROSSOVER_RATE: 0.05,         // chance of sexual reproduction when near compatible

  // ---- Rendering ----
  BG_COLOR: '#0a0e17',
  GRID_COLOR: 'rgba(255,255,255,0.03)',
  TRAIL_LENGTH: 8,
  PARTICLE_LIMIT: 200,

  // ---- Simulation ----
  TARGET_FPS: 60,
  TICKS_PER_FRAME: 1,          // adjustable speed
};

// Unique ID generator
EcoSim._nextId = 1;
EcoSim.nextId = function() { return EcoSim._nextId++; };

// Simple event bus for decoupled communication
EcoSim.Events = {
  _listeners: {},
  on: function(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },
  emit: function(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(function(fn) { fn(data); });
    }
  },
  off: function(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(function(f) { return f !== fn; });
    }
  }
};
