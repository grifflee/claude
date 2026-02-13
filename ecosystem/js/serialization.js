/**
 * EcoSim Save/Load Serialization
 *
 * Provides EcoSim.Serialization -- multi-universe save system with auto-save.
 * Saves to actual JSON files on disk via the local server API.
 * Falls back to localStorage if server is unavailable (file:// protocol).
 *
 * Dependencies: config.js, neural.js, creature.js, world.js
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;
  var Creature = EcoSim.Creature;

  var API_BASE = '/api/universes';
  var AUTOSAVE_INTERVAL = 3000; // ticks between auto-saves
  var STORAGE_PREFIX = 'ecosim_u_';
  var STORAGE_INDEX_KEY = 'ecosim_universes';

  var Serialization = {};

  // Current universe tracking
  Serialization.currentUniverse = null;
  Serialization.lastAutoSaveTick = 0;
  Serialization.useServer = false;   // detected at init
  Serialization._universeCache = []; // cached index for UI

  // ---------------------------------------------------------------
  // Detect if server API is available
  // ---------------------------------------------------------------
  Serialization.init = function () {
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('GET', API_BASE, false); // synchronous
      xhr.send();
      if (xhr.status === 200) {
        Serialization.useServer = true;
        Serialization._universeCache = JSON.parse(xhr.responseText);
        console.log('%c📁 EcoSim: File-based saving enabled (server detected)', 'color: #7cff6b');
      }
    } catch (e) {
      Serialization.useServer = false;
      console.log('%c💾 EcoSim: Using localStorage (no server)', 'color: #ffaa33');
    }
  };

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function f32ToArray(f32) {
    var arr = new Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      arr[i] = Math.round(f32[i] * 10000) / 10000;
    }
    return arr;
  }

  function arrayToF32(arr) {
    return new Float32Array(arr);
  }

  function serializeGenome(brain) {
    var genome = brain.getGenome();
    return {
      w1: f32ToArray(genome.weights1),
      b1: f32ToArray(genome.biases1),
      w2: f32ToArray(genome.weights2),
      b2: f32ToArray(genome.biases2),
      w3: f32ToArray(genome.weights3),
      b3: f32ToArray(genome.biases3)
    };
  }

  // Pad a Float32Array with small random values if shorter than target
  function padF32(arr, targetLen) {
    if (arr.length >= targetLen) return arr;
    var result = new Float32Array(targetLen);
    result.set(arr);
    for (var i = arr.length; i < targetLen; i++) {
      result[i] = (Math.random() - 0.5) * 0.2;
    }
    return result;
  }

  function deserializeGenome(data) {
    var w1 = arrayToF32(data.w1);
    var b1 = arrayToF32(data.b1);
    var w2 = arrayToF32(data.w2);
    var b2 = arrayToF32(data.b2);
    var w3 = arrayToF32(data.w3);
    var b3 = arrayToF32(data.b3);

    // Backwards compat: pad for expanded NN (16→17 inputs, 4→5 outputs)
    var expW1 = Config.NN_INPUT_SIZE * Config.NN_HIDDEN1_SIZE;
    var expW3 = Config.NN_HIDDEN2_SIZE * Config.NN_OUTPUT_SIZE;
    var expB3 = Config.NN_OUTPUT_SIZE;
    w1 = padF32(w1, expW1);
    w3 = padF32(w3, expW3);
    b3 = padF32(b3, expB3);

    return {
      weights1: w1, biases1: b1,
      weights2: w2, biases2: b2,
      weights3: w3, biases3: b3
    };
  }

  function serializeCreature(c) {
    return {
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
      angle: Math.round(c.angle * 1000) / 1000,
      energy: Math.round(c.energy * 10) / 10,
      age: c.age,
      generation: c.generation,
      parentId: c.parentId,
      bodyGenes: {
        size: c.bodyGenes.size,
        maxSpeed: c.bodyGenes.maxSpeed,
        turnSpeed: c.bodyGenes.turnSpeed,
        hue: c.bodyGenes.hue,
        saturation: c.bodyGenes.saturation,
        aggression: c.bodyGenes.aggression,
        efficiency: c.bodyGenes.efficiency,
        luminosity: c.bodyGenes.luminosity !== undefined ? c.bodyGenes.luminosity : 0.7
      },
      brain: serializeGenome(c.brain),
      kills: c.kills,
      foodEaten: c.foodEaten,
      children: c.children,
      childIds: c.childIds || [],
      reproductionCooldown: c.reproductionCooldown,
      signal: c.signal || 0
    };
  }

  function deserializeCreature(data) {
    var c = new Creature({
      x: data.x,
      y: data.y,
      bodyGenes: data.bodyGenes,
      genome: deserializeGenome(data.brain),
      generation: data.generation,
      parentId: data.parentId
    });
    c.angle = data.angle;
    c.energy = data.energy;
    c.age = data.age;
    c.kills = data.kills;
    c.foodEaten = data.foodEaten;
    c.children = data.children;
    c.childIds = data.childIds || [];
    c.reproductionCooldown = data.reproductionCooldown;
    c.signal = data.signal || 0;
    return c;
  }

  // ---------------------------------------------------------------
  // Core serialize/deserialize
  // ---------------------------------------------------------------
  Serialization.serialize = function (world) {
    var state = {
      version: 3,
      tick: world.tick,
      totalBirths: world.totalBirths,
      totalDeaths: world.totalDeaths,
      maxGeneration: world.maxGeneration,
      nextId: EcoSim._nextId,
      creatures: [],
      food: [],
      zones: []
    };

    var i;
    for (i = 0; i < world.creatures.length; i++) {
      state.creatures.push(serializeCreature(world.creatures[i]));
    }

    for (i = 0; i < world.food.length; i++) {
      var f = world.food[i];
      state.food.push({
        x: Math.round(f.x * 10) / 10,
        y: Math.round(f.y * 10) / 10,
        type: f.type || 'plant',
        energy: f.energy,
        age: f.age
      });
    }

    for (i = 0; i < world.zones.length; i++) {
      var z = world.zones[i];
      state.zones.push({
        x: z.x, y: z.y, radius: z.radius,
        spawnMultiplier: z.spawnMultiplier,
        vx: z.vx, vy: z.vy
      });
    }

    return JSON.stringify(state);
  };

  Serialization.deserialize = function (world, jsonString) {
    var state = JSON.parse(jsonString);

    world.creatures = [];
    world.food = [];
    world.particles = [];
    world.dyingCreatures = [];
    world.spatialGrid = {};
    world.foodGrid = {};

    world.tick = state.tick;
    world.totalBirths = state.totalBirths;
    world.totalDeaths = state.totalDeaths;
    world.maxGeneration = state.maxGeneration;
    world.selectedCreature = null;
    EcoSim._nextId = state.nextId || world.tick * 10;

    var i;
    for (i = 0; i < state.creatures.length; i++) {
      world.creatures.push(deserializeCreature(state.creatures[i]));
    }

    for (i = 0; i < state.food.length; i++) {
      var fd = state.food[i];
      world.food.push({
        id: EcoSim.nextId(),
        x: fd.x,
        y: fd.y,
        type: fd.type || 'plant',
        energy: fd.energy,
        size: fd.type === 'meat' ? Config.FOOD_SIZE + 1.5 : Config.FOOD_SIZE,
        age: fd.age,
        glow: 0.5 + Math.random() * 0.5
      });
    }

    if (state.zones && state.zones.length > 0) {
      world.zones = [];
      for (i = 0; i < state.zones.length; i++) {
        world.zones.push(state.zones[i]);
      }
    }

    return true;
  };

  // ---------------------------------------------------------------
  // Server-based universe operations
  // ---------------------------------------------------------------
  function serverSave(name, json) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + '/' + encodeURIComponent(name), false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(json);
    return xhr.status === 200;
  }

  function serverLoad(name) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_BASE + '/' + encodeURIComponent(name), false);
    xhr.send();
    if (xhr.status === 200) return xhr.responseText;
    return null;
  }

  function serverDelete(name) {
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', API_BASE + '/' + encodeURIComponent(name), false);
    xhr.send();
    return xhr.status === 200;
  }

  function serverList() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_BASE, false);
    xhr.send();
    if (xhr.status === 200) return JSON.parse(xhr.responseText);
    return [];
  }

  // ---------------------------------------------------------------
  // localStorage fallback operations
  // ---------------------------------------------------------------
  function localSave(name, json) {
    try {
      localStorage.setItem(STORAGE_PREFIX + name, json);
      var index = localGetIndex();
      var found = false;
      for (var i = 0; i < index.length; i++) {
        if (index[i].name === name) {
          found = true;
          index[i].savedAt = Date.now();
          break;
        }
      }
      if (!found) {
        index.push({ name: name, savedAt: Date.now() });
      }
      localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
      return true;
    } catch (e) {
      return false;
    }
  }

  function localLoad(name) {
    return localStorage.getItem(STORAGE_PREFIX + name);
  }

  function localDelete(name) {
    localStorage.removeItem(STORAGE_PREFIX + name);
    var index = localGetIndex().filter(function (u) { return u.name !== name; });
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
  }

  function localGetIndex() {
    try {
      var raw = localStorage.getItem(STORAGE_INDEX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  // ---------------------------------------------------------------
  // Unified universe operations (server or localStorage)
  // ---------------------------------------------------------------
  Serialization.getUniverseIndex = function () {
    if (Serialization.useServer) {
      Serialization._universeCache = serverList();
      return Serialization._universeCache;
    }
    return localGetIndex();
  };

  Serialization.saveUniverse = function (world, name) {
    var json = Serialization.serialize(world);
    var ok;

    if (Serialization.useServer) {
      ok = serverSave(name, json);
    } else {
      ok = localSave(name, json);
    }

    if (ok) {
      Serialization.currentUniverse = name;
      Serialization.lastAutoSaveTick = world.tick;
    }
    return ok;
  };

  Serialization.loadUniverse = function (world, name) {
    var json;

    if (Serialization.useServer) {
      json = serverLoad(name);
    } else {
      json = localLoad(name);
    }

    if (!json) return false;

    var result = Serialization.deserialize(world, json);
    if (result) {
      Serialization.currentUniverse = name;
      Serialization.lastAutoSaveTick = world.tick;
    }
    return result;
  };

  Serialization.deleteUniverse = function (name) {
    if (Serialization.useServer) {
      serverDelete(name);
    } else {
      localDelete(name);
    }
    if (Serialization.currentUniverse === name) {
      Serialization.currentUniverse = null;
    }
  };

  // ---------------------------------------------------------------
  // Generate a unique universe name
  // ---------------------------------------------------------------
  Serialization.generateName = function () {
    var adjectives = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega', 'Nova', 'Nebula', 'Solar', 'Lunar', 'Stellar', 'Cosmic', 'Primal', 'Ancient', 'Crystal', 'Shadow', 'Golden', 'Silver', 'Emerald', 'Crimson', 'Azure'];
    var nouns = ['Eden', 'Gaia', 'Terra', 'Reef', 'Tundra', 'Jungle', 'Oasis', 'Abyss', 'Haven', 'Nexus', 'Forge', 'Ark', 'Vault', 'Spire', 'Drift', 'Basin', 'Grove', 'Marsh', 'Peak', 'Depths'];
    var adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    var noun = nouns[Math.floor(Math.random() * nouns.length)];
    return adj + ' ' + noun;
  };

  // ---------------------------------------------------------------
  // Auto-save check
  // ---------------------------------------------------------------
  Serialization.checkAutoSave = function (world) {
    if (!Serialization.currentUniverse) return false;
    if (world.tick - Serialization.lastAutoSaveTick < AUTOSAVE_INTERVAL) return false;

    Serialization.saveUniverse(world, Serialization.currentUniverse);
    return true;
  };

  // ---------------------------------------------------------------
  // Download / Import
  // ---------------------------------------------------------------
  Serialization.downloadSave = function (world) {
    var json = Serialization.serialize(world);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var name = Serialization.currentUniverse || 'ecosim';
    a.download = name.replace(/\s+/g, '_') + '_gen' + world.maxGeneration + '_t' + world.tick + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  Serialization.loadFromFile = function (world, file, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        Serialization.deserialize(world, e.target.result);
        var name = file.name.replace(/\.json$/i, '').replace(/_/g, ' ');
        Serialization.currentUniverse = name;
        Serialization.saveUniverse(world, name);
        if (callback) callback(null, name);
      } catch (err) {
        if (callback) callback(err);
      }
    };
    reader.readAsText(file);
  };

  // Run init on load
  Serialization.init();

  EcoSim.Serialization = Serialization;

})();
