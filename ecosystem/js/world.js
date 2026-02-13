/**
 * EcoSim World Simulation Engine
 *
 * Provides EcoSim.World -- manages all entities, physics, spatial queries,
 * and the main simulation tick. This is the core engine that drives the
 * evolutionary ecosystem.
 *
 * Dependencies (loaded before this file):
 *   - EcoSim.Config
 *   - EcoSim.NeuralNetwork
 *   - EcoSim.Creature
 *   - EcoSim.Events
 *   - EcoSim.nextId()
 */
(function () {
  'use strict';

  var Config  = EcoSim.Config;
  var Events  = EcoSim.Events;
  var Creature = EcoSim.Creature;

  // Cache frequently-used config values as local vars for performance.
  // These are read hundreds of times per tick inside tight loops.
  var WORLD_WIDTH   = Config.WORLD_WIDTH;
  var WORLD_HEIGHT  = Config.WORLD_HEIGHT;
  var GRID_CELL_SIZE = Config.GRID_CELL_SIZE;

  var INITIAL_CREATURE_COUNT = Config.INITIAL_CREATURE_COUNT;
  var MAX_CREATURES           = Config.MAX_CREATURES;

  var FOOD_SPAWN_RATE     = Config.FOOD_SPAWN_RATE;
  var FOOD_MAX_COUNT      = Config.FOOD_MAX_COUNT;
  var FOOD_ENERGY         = Config.FOOD_ENERGY;
  var FOOD_SIZE           = Config.FOOD_SIZE;
  var FOOD_CLUSTER_CHANCE = Config.FOOD_CLUSTER_CHANCE;
  var FOOD_CLUSTER_RADIUS = Config.FOOD_CLUSTER_RADIUS;

  var VISION_RANGE       = Config.CREATURE_VISION_RANGE;
  var EAT_RANGE          = Config.CREATURE_EAT_RANGE;
  var ATTACK_RANGE       = Config.CREATURE_ATTACK_RANGE;
  var ATTACK_ENERGY_GAIN = Config.CREATURE_ATTACK_ENERGY_GAIN;
  var MAX_SIZE           = Config.CREATURE_MAX_SIZE;
  var MAX_ENERGY         = Config.CREATURE_MAX_ENERGY;

  var PARTICLE_LIMIT = Config.PARTICLE_LIMIT;

  var MUTATION_RATE     = Config.MUTATION_RATE;
  var MUTATION_STRENGTH = Config.MUTATION_STRENGTH;
  var CROSSOVER_RATE    = Config.CROSSOVER_RATE;

  // Pre-computed inverse for normalization (avoid repeated division)
  var INV_VISION_RANGE = 1 / VISION_RANGE;
  var INV_MAX_SIZE     = 1 / MAX_SIZE;
  var INV_MAX_ENERGY   = 1 / MAX_ENERGY;

  // Wall proximity distance threshold
  var WALL_SENSE_DIST = 50;

  // ===============================================================
  // Helper: Euclidean distance squared (avoids sqrt in hot paths)
  // ===============================================================
  function distSq(x1, y1, x2, y2) {
    var dx = x1 - x2;
    var dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  // ===============================================================
  // Helper: clamp a number to [min, max]
  // ===============================================================
  function clamp(val, min, max) {
    return val < min ? min : (val > max ? max : val);
  }

  // ===============================================================
  // Helper: create a food object
  // ===============================================================
  function createFood(x, y, type) {
    var isMeat = type === 'meat';
    return {
      id: EcoSim.nextId(),
      x: x,
      y: y,
      type: isMeat ? 'meat' : 'plant',
      energy: isMeat ? Config.MEAT_ENERGY : FOOD_ENERGY,
      size: isMeat ? FOOD_SIZE + 1.5 : FOOD_SIZE,
      age: 0,
      glow: 0.5 + Math.random() * 0.5
    };
  }

  // ===============================================================
  // World class
  // ===============================================================

  function World() {
    this.creatures = [];
    this.food = [];
    this.particles = [];
    this.dyingCreatures = [];

    this.tick = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.maxGeneration = 0;

    this.spatialGrid = {};
    this.foodGrid = {};

    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;

    this.selectedCreature = null;
    this.paused = false;

    // Fertile zones — areas where food spawns faster
    this.zones = [];
    this._initZones();

    // Bind event listeners
    this._setupEventListeners();
  }

  // ---------------------------------------------------------------
  // _initZones() -- create 2-3 fertile zones at random positions
  // ---------------------------------------------------------------
  World.prototype._initZones = function () {
    var count = 5 + Math.floor(Math.random() * 4); // 5-8 zones
    this.zones = [];
    for (var i = 0; i < count; i++) {
      this.zones.push({
        x: 150 + Math.random() * (this.width - 300),
        y: 150 + Math.random() * (this.height - 300),
        radius: 200 + Math.random() * 150,
        spawnMultiplier: 2 + Math.random() * 2, // 2-4x food spawn boost
        vx: (Math.random() - 0.5) * 0.02,       // very slow drift
        vy: (Math.random() - 0.5) * 0.02
      });
    }
  };

  // ---------------------------------------------------------------
  // Event listeners for particle effects and stat tracking
  // ---------------------------------------------------------------
  World.prototype._setupEventListeners = function () {
    var self = this;

    Events.on('creature:eat', function (data) {
      self.spawnParticle(data.creature.x, data.creature.y, 'eat', '#44ff66');
    });

    Events.on('creature:attack', function (data) {
      self.spawnParticle(data.creature.x, data.creature.y, 'attack', '#ff8822');
    });

    Events.on('creature:reproduce', function (data) {
      self.spawnParticle(data.creature.x, data.creature.y, 'reproduce', '#22ddff');
      self.totalBirths++;
    });

    Events.on('creature:die', function (data) {
      var c = data.creature;
      self.spawnParticle(c.x, c.y, 'die', '#ff3333');
      self.totalDeaths++;
      // Drop meat at death location
      if (Math.random() < Config.MEAT_SPAWN_CHANCE) {
        self.food.push(createFood(c.x, c.y, 'meat'));
      }
      // Add to dying creatures for fade-out animation
      self.dyingCreatures.push({
        x: c.x, y: c.y, size: c.size, angle: c.angle,
        hue: c.bodyGenes.hue, saturation: c.bodyGenes.saturation,
        ticksLeft: 20
      });
    });
  };

  // ---------------------------------------------------------------
  // init() -- reset and populate the world
  // ---------------------------------------------------------------
  World.prototype.init = function () {
    var i;

    // Clear all arrays
    this.creatures = [];
    this.food = [];
    this.particles = [];
    this.dyingCreatures = [];
    this.spatialGrid = {};
    this.foodGrid = {};

    // Reset counters
    this.tick = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.maxGeneration = 0;
    this.selectedCreature = null;
    this._initZones();

    // Spawn initial creatures at random positions
    for (i = 0; i < INITIAL_CREATURE_COUNT; i++) {
      this._spawnRandomCreature();
    }

    // Spawn initial food: half of max count
    var initialFood = Math.floor(FOOD_MAX_COUNT / 2);
    for (i = 0; i < initialFood; i++) {
      var fx = 20 + Math.random() * (this.width - 40);
      var fy = 20 + Math.random() * (this.height - 40);
      this.food.push(createFood(fx, fy));
    }

    return this;
  };

  // ---------------------------------------------------------------
  // _spawnRandomCreature() -- internal helper
  // ---------------------------------------------------------------
  World.prototype._spawnRandomCreature = function () {
    var x = 20 + Math.random() * (this.width - 40);
    var y = 20 + Math.random() * (this.height - 40);
    var creature = new Creature({
      x: x,
      y: y,
      angle: Math.random() * Math.PI * 2
    });
    this.creatures.push(creature);
    return creature;
  };

  // ---------------------------------------------------------------
  // update() -- main simulation tick
  // ---------------------------------------------------------------
  World.prototype.update = function () {
    if (this.paused) return;

    this.tick++;

    // Rebuild spatial index
    this.buildSpatialGrid();

    // Spawn food
    this.spawnFood();

    // Age food items (for glow animation)
    var fi;
    for (fi = 0; fi < this.food.length; fi++) {
      this.food[fi].age++;
    }

    // Process creatures (iterate backwards for safe removal)
    var creatures = this.creatures;
    var i, creature, inputs;

    for (i = creatures.length - 1; i >= 0; i--) {
      creature = creatures[i];

      if (!creature.alive) {
        // Remove dead creature
        if (this.selectedCreature === creature) {
          this.selectedCreature = null;
        }
        creatures.splice(i, 1);
        continue;
      }

      // Build sensory inputs
      inputs = this.buildSensoryInputs(creature);

      // Let the creature's neural network process inputs and update state
      creature.update(inputs);

      // Check eating -- find nearby food
      this._checkEating(creature);

      // Check attacking -- if creature wants to eat and there is a nearby smaller creature
      this._checkAttacking(creature);

      // Check reproduction
      this._checkReproduction(creature);

      // Remove if dead after interactions (die() already emitted event)
      if (!creature.alive) {
        if (this.selectedCreature === creature) {
          this.selectedCreature = null;
        }
        creatures.splice(i, 1);
      }
    }

    // Cap creature population -- kill lowest-energy creatures if over max
    if (creatures.length > MAX_CREATURES) {
      // Sort ascending by energy (lowest first)
      creatures.sort(function (a, b) { return a.energy - b.energy; });
      var excess = creatures.length - MAX_CREATURES;
      for (i = 0; i < excess; i++) {
        creatures[i].die(); // die() emits creature:die event
        if (this.selectedCreature === creatures[i]) {
          this.selectedCreature = null;
        }
      }
      // Remove the dead ones from the front of the array
      creatures.splice(0, excess);
    }

    // Drift fertile zones slowly
    for (i = 0; i < this.zones.length; i++) {
      var z = this.zones[i];
      z.x += z.vx;
      z.y += z.vy;
      // Bounce off edges
      if (z.x < z.radius) { z.x = z.radius; z.vx = Math.abs(z.vx); }
      if (z.x > this.width - z.radius) { z.x = this.width - z.radius; z.vx = -Math.abs(z.vx); }
      if (z.y < z.radius) { z.y = z.radius; z.vy = Math.abs(z.vy); }
      if (z.y > this.height - z.radius) { z.y = this.height - z.radius; z.vy = -Math.abs(z.vy); }
    }

    // Update dying creatures
    for (i = this.dyingCreatures.length - 1; i >= 0; i--) {
      this.dyingCreatures[i].ticksLeft--;
      if (this.dyingCreatures[i].ticksLeft <= 0) {
        this.dyingCreatures.splice(i, 1);
      }
    }

    // Update particles
    this._updateParticles();

    // Enforce minimum population
    if (creatures.length < 15) {
      for (i = 0; i < 25; i++) {
        this._spawnRandomCreature();
      }
    }
  };

  // ---------------------------------------------------------------
  // _checkEating(creature) -- eat nearby food
  // ---------------------------------------------------------------
  World.prototype._checkEating = function (creature) {
    var nearbyFood = this.getNearbyFood(creature.x, creature.y, EAT_RANGE);
    if (nearbyFood.length === 0) return;

    // Eat the closest food item
    var closest = null;
    var closestDist = Infinity;
    var j, f, d;

    for (j = 0; j < nearbyFood.length; j++) {
      f = nearbyFood[j];
      d = distSq(creature.x, creature.y, f.x, f.y);
      if (d < closestDist) {
        closestDist = d;
        closest = f;
      }
    }

    if (closest) {
      creature.eat(closest.energy);
      // Remove food from array
      var idx = this.food.indexOf(closest);
      if (idx !== -1) {
        this.food.splice(idx, 1);
      }
    }
  };

  // ---------------------------------------------------------------
  // _checkAttacking(creature) -- attack nearby smaller creature
  // ---------------------------------------------------------------
  World.prototype._checkAttacking = function (creature) {
    if (!creature.wantsToEat) return;

    // High aggression creatures get larger attack range (+30% at max aggression)
    var aggrBonus = creature.bodyGenes.aggression > 0.7 ? 1 + (creature.bodyGenes.aggression - 0.7) : 1;
    var attackRange = ATTACK_RANGE * aggrBonus;
    var nearby = this.getNearbyCreatures(creature.x, creature.y, attackRange);
    var closest = null;
    var closestDist = Infinity;
    var j, other, d;

    for (j = 0; j < nearby.length; j++) {
      other = nearby[j];
      if (other === creature || !other.alive) continue;
      // Can only attack smaller creatures
      if (other.size >= creature.size) continue;
      d = distSq(creature.x, creature.y, other.x, other.y);
      if (d < closestDist) {
        closestDist = d;
        closest = other;
      }
    }

    if (closest) {
      creature.attack(closest);
    }
  };

  // ---------------------------------------------------------------
  // _checkReproduction(creature) -- reproduce if eligible
  // ---------------------------------------------------------------
  World.prototype._checkReproduction = function (creature) {
    if (!creature.wantsToReproduce || !creature.canReproduce()) return;

    var child = null;

    // Check for sexual reproduction: find a nearby compatible creature
    if (Math.random() < CROSSOVER_RATE) {
      var nearby = this.getNearbyCreatures(creature.x, creature.y, VISION_RANGE);
      var partner = null;
      var j, other;

      for (j = 0; j < nearby.length; j++) {
        other = nearby[j];
        if (other === creature || !other.alive) continue;
        if (other.canReproduce()) {
          partner = other;
          break;
        }
      }

      if (partner) {
        child = creature.reproduce(partner);
      }
    }

    // Fall back to asexual reproduction if no partner found
    if (!child) {
      child = creature.reproduce(null);
    }

    if (child) {
      this.creatures.push(child);
      if (child.generation > this.maxGeneration) {
        this.maxGeneration = child.generation;
      }
    }
  };

  // ---------------------------------------------------------------
  // buildSpatialGrid() -- rebuild the spatial hash for creatures and food
  // ---------------------------------------------------------------
  World.prototype.buildSpatialGrid = function () {
    var grid = {};
    var foodGrid = {};
    var i, creature, f, key;

    // Index creatures
    for (i = 0; i < this.creatures.length; i++) {
      creature = this.creatures[i];
      key = Math.floor(creature.x / GRID_CELL_SIZE) + '_' + Math.floor(creature.y / GRID_CELL_SIZE);
      if (!grid[key]) {
        grid[key] = [];
      }
      grid[key].push(creature);
    }

    // Index food
    for (i = 0; i < this.food.length; i++) {
      f = this.food[i];
      key = Math.floor(f.x / GRID_CELL_SIZE) + '_' + Math.floor(f.y / GRID_CELL_SIZE);
      if (!foodGrid[key]) {
        foodGrid[key] = [];
      }
      foodGrid[key].push(f);
    }

    this.spatialGrid = grid;
    this.foodGrid = foodGrid;
  };

  // ---------------------------------------------------------------
  // getNearbyCreatures(x, y, range) -- spatial query for creatures
  // ---------------------------------------------------------------
  World.prototype.getNearbyCreatures = function (x, y, range) {
    var results = [];
    var rangeSq = range * range;
    var grid = this.spatialGrid;

    var cellRange = Math.ceil(range / GRID_CELL_SIZE);
    var cx = Math.floor(x / GRID_CELL_SIZE);
    var cy = Math.floor(y / GRID_CELL_SIZE);

    var gx, gy, key, cell, i, creature, d;

    for (gx = cx - cellRange; gx <= cx + cellRange; gx++) {
      for (gy = cy - cellRange; gy <= cy + cellRange; gy++) {
        key = gx + '_' + gy;
        cell = grid[key];
        if (!cell) continue;
        for (i = 0; i < cell.length; i++) {
          creature = cell[i];
          d = distSq(x, y, creature.x, creature.y);
          if (d <= rangeSq) {
            results.push(creature);
          }
        }
      }
    }

    return results;
  };

  // ---------------------------------------------------------------
  // getNearbyFood(x, y, range) -- spatial query for food
  // ---------------------------------------------------------------
  World.prototype.getNearbyFood = function (x, y, range) {
    var results = [];
    var rangeSq = range * range;
    var grid = this.foodGrid;

    var cellRange = Math.ceil(range / GRID_CELL_SIZE);
    var cx = Math.floor(x / GRID_CELL_SIZE);
    var cy = Math.floor(y / GRID_CELL_SIZE);

    var gx, gy, key, cell, i, f, d;

    for (gx = cx - cellRange; gx <= cx + cellRange; gx++) {
      for (gy = cy - cellRange; gy <= cy + cellRange; gy++) {
        key = gx + '_' + gy;
        cell = grid[key];
        if (!cell) continue;
        for (i = 0; i < cell.length; i++) {
          f = cell[i];
          d = distSq(x, y, f.x, f.y);
          if (d <= rangeSq) {
            results.push(f);
          }
        }
      }
    }

    return results;
  };

  // ---------------------------------------------------------------
  // buildSensoryInputs(creature) -- 12-element input vector
  // ---------------------------------------------------------------
  World.prototype.buildSensoryInputs = function (creature) {
    var cx = creature.x;
    var cy = creature.y;

    // Find nearest food within vision range
    var nearbyFood = this.getNearbyFood(cx, cy, VISION_RANGE);
    var nearestFood = null;
    var nearestFoodDist = Infinity;
    var i, f, d;

    for (i = 0; i < nearbyFood.length; i++) {
      f = nearbyFood[i];
      d = distSq(cx, cy, f.x, f.y);
      if (d < nearestFoodDist) {
        nearestFoodDist = d;
        nearestFood = f;
      }
    }

    // Find nearest other creature within vision range
    var nearbyCreatures = this.getNearbyCreatures(cx, cy, VISION_RANGE);
    var nearestCreature = null;
    var nearestCreatureDist = Infinity;
    var other;

    for (i = 0; i < nearbyCreatures.length; i++) {
      other = nearbyCreatures[i];
      if (other === creature) continue;
      d = distSq(cx, cy, other.x, other.y);
      if (d < nearestCreatureDist) {
        nearestCreatureDist = d;
        nearestCreature = other;
      }
    }

    // Build the 17-element input array
    var inputs = new Array(17);

    // Inputs 0-2: nearest food direction and distance
    if (nearestFood) {
      var foodDx = nearestFood.x - cx;
      var foodDy = nearestFood.y - cy;
      var foodDist = Math.sqrt(nearestFoodDist);
      if (foodDist > 0) {
        var invFoodDist = 1 / foodDist;
        inputs[0] = foodDx * invFoodDist; // normalized dx
        inputs[1] = foodDy * invFoodDist; // normalized dy
      } else {
        inputs[0] = 0;
        inputs[1] = 0;
      }
      // Distance: 1 = touching, 0 = at vision limit
      inputs[2] = 1 - (foodDist * INV_VISION_RANGE);
    } else {
      inputs[0] = 0;
      inputs[1] = 0;
      inputs[2] = 0;
    }

    // Inputs 3-6: nearest creature direction, distance, relative size
    if (nearestCreature) {
      var crDx = nearestCreature.x - cx;
      var crDy = nearestCreature.y - cy;
      var crDist = Math.sqrt(nearestCreatureDist);
      if (crDist > 0) {
        var invCrDist = 1 / crDist;
        inputs[3] = crDx * invCrDist; // normalized dx
        inputs[4] = crDy * invCrDist; // normalized dy
      } else {
        inputs[3] = 0;
        inputs[4] = 0;
      }
      // Distance: 1 = touching, 0 = at vision limit
      inputs[5] = 1 - (crDist * INV_VISION_RANGE);
      // Relative size: (their size - our size) / MAX_SIZE, clamped [-1, 1]
      inputs[6] = clamp((nearestCreature.size - creature.size) * INV_MAX_SIZE, -1, 1);
    } else {
      inputs[3] = 0;
      inputs[4] = 0;
      inputs[5] = 0;
      inputs[6] = 0;
    }

    // Input 7: own energy normalized
    inputs[7] = clamp(creature.energy * INV_MAX_ENERGY, 0, 1);

    // Inputs 8-9: wall proximity X (left, right)
    // 1.0 = within ~0px of wall, 0.0 = 50px or more away
    inputs[8] = Math.max(0, 1 - cx / WALL_SENSE_DIST);
    inputs[9] = Math.max(0, 1 - (this.width - cx) / WALL_SENSE_DIST);

    // Inputs 10-11: wall proximity Y (top, bottom)
    inputs[10] = Math.max(0, 1 - cy / WALL_SENSE_DIST);
    inputs[11] = Math.max(0, 1 - (this.height - cy) / WALL_SENSE_DIST);

    // Inputs 12-15: previous tick's neural outputs (recurrent memory, first 4)
    var prevOut = creature.brain.lastOutputs;
    inputs[12] = prevOut[0];
    inputs[13] = prevOut[1];
    inputs[14] = prevOut[2];
    inputs[15] = prevOut[3];

    // Input 16: nearest creature's signal (-1 to 1)
    inputs[16] = nearestCreature ? (nearestCreature.signal || 0) : 0;

    return inputs;
  };

  // ---------------------------------------------------------------
  // spawnFood() -- probabilistic food spawning each tick
  // ---------------------------------------------------------------
  World.prototype.getDayNightPhase = function () {
    // Returns 0-1 where 0.5 = peak day, 0 and 1 = midnight
    var cycle = Config.DAY_CYCLE_LENGTH;
    return (Math.sin(this.tick / cycle * Math.PI * 2) + 1) * 0.5;
  };

  World.prototype.spawnFood = function () {
    if (this.food.length >= FOOD_MAX_COUNT) return;
    // Modulate spawn rate by day/night cycle
    var dayPhase = this.getDayNightPhase();
    var spawnRate = Config.FOOD_SPAWN_RATE * (1 - Config.DAY_FOOD_MULTIPLIER + Config.DAY_FOOD_MULTIPLIER * 2 * dayPhase);
    if (Math.random() >= spawnRate) return;

    var x, y;

    // Zone-biased spawning: 40% chance to spawn inside a fertile zone
    if (this.zones.length > 0 && Math.random() < 0.4) {
      var zone = this.zones[Math.floor(Math.random() * this.zones.length)];
      var zAngle = Math.random() * Math.PI * 2;
      var zDist = Math.random() * zone.radius;
      x = zone.x + Math.cos(zAngle) * zDist;
      y = zone.y + Math.sin(zAngle) * zDist;
      x = clamp(x, 20, this.width - 20);
      y = clamp(y, 20, this.height - 20);
      this.food.push(createFood(x, y));
      return;
    }

    // Cluster chance: spawn near existing food
    if (this.food.length > 0 && Math.random() < FOOD_CLUSTER_CHANCE) {
      var anchor = this.food[Math.floor(Math.random() * this.food.length)];
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.random() * FOOD_CLUSTER_RADIUS;
      x = anchor.x + Math.cos(angle) * dist;
      y = anchor.y + Math.sin(angle) * dist;
      // Clamp to world bounds with margin
      x = clamp(x, 20, this.width - 20);
      y = clamp(y, 20, this.height - 20);
    } else {
      // Random position with margin
      x = 20 + Math.random() * (this.width - 40);
      y = 20 + Math.random() * (this.height - 40);
    }

    this.food.push(createFood(x, y));
  };

  // ---------------------------------------------------------------
  // addFood(x, y) -- add food at a specific position (user interaction)
  // ---------------------------------------------------------------
  World.prototype.addFood = function (x, y) {
    var f = createFood(
      clamp(x, 0, this.width),
      clamp(y, 0, this.height)
    );
    this.food.push(f);
    Events.emit('food:add', { food: f });
    return f;
  };

  // ---------------------------------------------------------------
  // addCreature(x, y) -- add a random creature at specific position
  // ---------------------------------------------------------------
  World.prototype.addCreature = function (x, y) {
    var creature = new Creature({
      x: clamp(x, 0, this.width),
      y: clamp(y, 0, this.height),
      angle: Math.random() * Math.PI * 2
    });
    this.creatures.push(creature);
    return creature;
  };

  // ---------------------------------------------------------------
  // spawnParticle(x, y, type, color) -- visual effect particles
  // ---------------------------------------------------------------
  World.prototype.spawnParticle = function (x, y, type, color) {
    var particles = this.particles;
    var i, count, angle, speed, p;

    switch (type) {
      case 'eat':
        // Small green sparkles: 3-5 particles, short life, outward velocity
        count = 3 + Math.floor(Math.random() * 3);
        for (i = 0; i < count; i++) {
          angle = Math.random() * Math.PI * 2;
          speed = 0.5 + Math.random() * 1.5;
          p = {
            x: x,
            y: y,
            type: 'eat',
            color: color,
            age: 0,
            maxAge: 15 + Math.floor(Math.random() * 10),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 1.5 + Math.random() * 1.5
          };
          particles.push(p);
        }
        break;

      case 'reproduce':
        // Expanding ring: 1 particle
        p = {
          x: x,
          y: y,
          type: 'ring',
          color: color,
          age: 0,
          maxAge: 25,
          vx: 0,
          vy: 0,
          size: 3
        };
        particles.push(p);
        break;

      case 'die':
        // Red fade particles: 5-8, slow drift
        count = 5 + Math.floor(Math.random() * 4);
        for (i = 0; i < count; i++) {
          angle = Math.random() * Math.PI * 2;
          speed = 0.2 + Math.random() * 0.6;
          p = {
            x: x,
            y: y,
            type: 'die',
            color: color,
            age: 0,
            maxAge: 30 + Math.floor(Math.random() * 15),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 2
          };
          particles.push(p);
        }
        break;

      case 'attack':
        // Orange flash: 2-3 particles
        count = 2 + Math.floor(Math.random() * 2);
        for (i = 0; i < count; i++) {
          angle = Math.random() * Math.PI * 2;
          speed = 1 + Math.random() * 2;
          p = {
            x: x,
            y: y,
            type: 'attack',
            color: color,
            age: 0,
            maxAge: 10 + Math.floor(Math.random() * 8),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 1.5
          };
          particles.push(p);
        }
        break;
    }

    // Cap particle count -- remove oldest particles if over limit
    if (particles.length > PARTICLE_LIMIT) {
      particles.splice(0, particles.length - PARTICLE_LIMIT);
    }
  };

  // ---------------------------------------------------------------
  // _updateParticles() -- age and remove expired particles
  // ---------------------------------------------------------------
  World.prototype._updateParticles = function () {
    var particles = this.particles;
    var i, p;

    for (i = particles.length - 1; i >= 0; i--) {
      p = particles[i];
      p.age++;
      p.x += p.vx;
      p.y += p.vy;

      // Slow down velocity over time (drag)
      p.vx *= 0.95;
      p.vy *= 0.95;

      // Remove expired particles
      if (p.age >= p.maxAge) {
        particles.splice(i, 1);
      }
    }
  };

  // ---------------------------------------------------------------
  // selectCreature(x, y) -- find creature nearest to click position
  // ---------------------------------------------------------------
  World.prototype.selectCreature = function (x, y) {
    var creatures = this.creatures;
    var best = null;
    var bestDist = 20 * 20; // max 20px selection radius (squared)
    var i, creature, d;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      d = distSq(x, y, creature.x, creature.y);
      if (d < bestDist) {
        bestDist = d;
        best = creature;
      }
    }

    this.selectedCreature = best;
    return best;
  };

  // ---------------------------------------------------------------
  // getStats() -- return current simulation statistics
  // ---------------------------------------------------------------
  World.prototype.getStats = function () {
    var creatures = this.creatures;
    var len = creatures.length;

    var totalEnergy = 0;
    var totalAge = 0;
    var totalSize = 0;
    var totalSpeed = 0;
    var oldest = null;
    var mostFit = null;
    var speciesMap = {};
    var i, c;

    for (i = 0; i < len; i++) {
      c = creatures[i];
      totalEnergy += c.energy;
      totalAge += c.age;
      totalSize += c.size;
      totalSpeed += c.speed;

      if (!oldest || c.age > oldest.age) {
        oldest = c;
      }

      // "Most fit" = creature with the most children (tracked via generation as proxy)
      // If creature tracks children count, use that; otherwise use generation
      var fitness = c.children !== undefined ? c.children : c.generation;
      if (!mostFit || fitness > (mostFit.children !== undefined ? mostFit.children : mostFit.generation)) {
        mostFit = c;
      }

      // Species distribution
      var sid = c.speciesId;
      if (sid !== undefined && sid !== null) {
        speciesMap[sid] = (speciesMap[sid] || 0) + 1;
      }
    }

    var speciesCount = 0;
    var key;
    for (key in speciesMap) {
      if (speciesMap.hasOwnProperty(key)) {
        speciesCount++;
      }
    }

    var invLen = len > 0 ? 1 / len : 0;

    return {
      tick: this.tick,
      population: len,
      foodCount: this.food.length,
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      maxGeneration: this.maxGeneration,
      avgEnergy: totalEnergy * invLen,
      avgAge: totalAge * invLen,
      avgSize: totalSize * invLen,
      avgSpeed: totalSpeed * invLen,
      oldestCreature: oldest,
      mostFitCreature: mostFit,
      speciesCount: speciesCount,
      speciesDistribution: speciesMap
    };
  };

  // ---------------------------------------------------------------
  // getCreatureById(id) -- find a creature by ID
  // ---------------------------------------------------------------
  World.prototype.getCreatureById = function (id) {
    var creatures = this.creatures;
    for (var i = 0; i < creatures.length; i++) {
      if (creatures[i].id === id) return creatures[i];
    }
    return null;
  };

  // ---------------------------------------------------------------
  // getPopulationGeneAverages() -- compute mean of each body gene
  // ---------------------------------------------------------------
  World.prototype.getPopulationGeneAverages = function () {
    var creatures = this.creatures;
    var len = creatures.length;
    if (len === 0) return null;

    var sums = { size: 0, maxSpeed: 0, turnSpeed: 0, hue: 0, saturation: 0, aggression: 0, efficiency: 0, luminosity: 0 };
    var i, g;

    for (i = 0; i < len; i++) {
      g = creatures[i].bodyGenes;
      sums.size += g.size;
      sums.maxSpeed += g.maxSpeed;
      sums.turnSpeed += g.turnSpeed;
      sums.saturation += g.saturation;
      sums.aggression += g.aggression;
      sums.efficiency += g.efficiency;
      sums.luminosity += (g.luminosity !== undefined ? g.luminosity : 0.7);
    }

    // Hue needs circular mean (convert to radians, average sin/cos, convert back)
    var sinSum = 0, cosSum = 0;
    for (i = 0; i < len; i++) {
      var hRad = creatures[i].bodyGenes.hue * Math.PI / 180;
      sinSum += Math.sin(hRad);
      cosSum += Math.cos(hRad);
    }
    var avgHue = Math.atan2(sinSum / len, cosSum / len) * 180 / Math.PI;
    if (avgHue < 0) avgHue += 360;

    var inv = 1 / len;
    return {
      size: sums.size * inv,
      maxSpeed: sums.maxSpeed * inv,
      turnSpeed: sums.turnSpeed * inv,
      hue: avgHue,
      saturation: sums.saturation * inv,
      aggression: sums.aggression * inv,
      efficiency: sums.efficiency * inv,
      luminosity: sums.luminosity * inv
    };
  };

  // ---------------------------------------------------------------
  // reset() -- reset the world
  // ---------------------------------------------------------------
  World.prototype.reset = function () {
    return this.init();
  };

  // ---------------------------------------------------------------
  // Attach to EcoSim namespace
  // ---------------------------------------------------------------
  EcoSim.World = World;

})();
