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
  var GRID_COLS = Math.ceil(WORLD_WIDTH / GRID_CELL_SIZE);
  var GRID_ROWS = Math.ceil(WORLD_HEIGHT / GRID_CELL_SIZE);
  var GRID_TOTAL = GRID_COLS * GRID_ROWS;

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

    this.spatialGrid = new Array(GRID_TOTAL);
    this.foodGrid = new Array(GRID_TOTAL);
    this._foodGridDirty = true;

    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;

    this.selectedCreature = null;
    this.paused = false;

    // Island system (must init before zones, which need island bounds)
    this.islands = [];
    this._lastMigrationTick = 0;
    this._migrationEffects = [];
    this._initIslands();

    // Fertile zones — areas where food spawns faster
    this.zones = [];
    this._initZones();

    // World events system
    this._initEvents();

    // Bind event listeners
    this._setupEventListeners();
  }

  // ---------------------------------------------------------------
  // _initZones() -- create 2-3 fertile zones at random positions
  // ---------------------------------------------------------------
  World.prototype._initZones = function () {
    var count = 5 + Math.floor(Math.random() * 4); // 5-8 zones
    this.zones = [];

    if (this.islands.length > 0) {
      // Distribute zones across islands proportionally
      var perIsland = Math.floor(count / this.islands.length);
      var extra = count - perIsland * this.islands.length;
      for (var ii = 0; ii < this.islands.length; ii++) {
        var isl = this.islands[ii];
        var b = isl.bounds;
        var zCount = perIsland + (ii < extra ? 1 : 0);
        for (var zi = 0; zi < zCount; zi++) {
          var rad = 200 + Math.random() * 150;
          this.zones.push({
            x: (b.x1 + rad) + Math.random() * (b.x2 - b.x1 - rad * 2),
            y: (b.y1 + rad) + Math.random() * (b.y2 - b.y1 - rad * 2),
            radius: rad,
            spawnMultiplier: 2 + Math.random() * 2,
            vx: (Math.random() - 0.5) * 0.02,
            vy: (Math.random() - 0.5) * 0.02,
            islandId: isl.id
          });
        }
      }
    } else {
      for (var i = 0; i < count; i++) {
        this.zones.push({
          x: 150 + Math.random() * (this.width - 300),
          y: 150 + Math.random() * (this.height - 300),
          radius: 200 + Math.random() * 150,
          spawnMultiplier: 2 + Math.random() * 2,
          vx: (Math.random() - 0.5) * 0.02,
          vy: (Math.random() - 0.5) * 0.02
        });
      }
    }
  };

  // ---------------------------------------------------------------
  // _initEvents() -- set up world events scheduling
  // ---------------------------------------------------------------
  World.prototype._initEvents = function () {
    this.nextEventTick = 800 + Math.floor(Math.random() * 1500);
    this.activeEvents = [];
    this.mutationStormTicks = 0;
  };

  // ---------------------------------------------------------------
  // _initIslands() -- create island regions based on ISLAND_COUNT
  // ---------------------------------------------------------------
  World.prototype._initIslands = function () {
    var count = Config.ISLAND_COUNT;
    var gap = Config.ISLAND_GAP;
    this.islands = [];

    if (count <= 1) return; // single island = no-op, full world

    if (count === 2) {
      // Vertical split — two islands side by side
      var halfW = (this.width - gap) / 2;
      this.islands.push({
        id: 'west',
        bounds: { x1: 0, y1: 0, x2: halfW, y2: this.height }
      });
      this.islands.push({
        id: 'east',
        bounds: { x1: halfW + gap, y1: 0, x2: this.width, y2: this.height }
      });
    } else if (count >= 4) {
      // 2x2 grid
      var qW = (this.width - gap) / 2;
      var qH = (this.height - gap) / 2;
      this.islands.push({
        id: 'northwest',
        bounds: { x1: 0, y1: 0, x2: qW, y2: qH }
      });
      this.islands.push({
        id: 'northeast',
        bounds: { x1: qW + gap, y1: 0, x2: this.width, y2: qH }
      });
      this.islands.push({
        id: 'southwest',
        bounds: { x1: 0, y1: qH + gap, x2: qW, y2: this.height }
      });
      this.islands.push({
        id: 'southeast',
        bounds: { x1: qW + gap, y1: qH + gap, x2: this.width, y2: this.height }
      });
    }
  };

  // ---------------------------------------------------------------
  // _getIslandAt(x, y) -- returns island object for a position
  // ---------------------------------------------------------------
  World.prototype._getIslandAt = function (x, y) {
    var islands = this.islands;
    for (var i = 0; i < islands.length; i++) {
      var b = islands[i].bounds;
      if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) {
        return islands[i];
      }
    }
    // Fallback: return nearest island (for gap positions)
    var best = null;
    var bestDist = Infinity;
    for (var j = 0; j < islands.length; j++) {
      var ib = islands[j].bounds;
      var cx = clamp(x, ib.x1, ib.x2);
      var cy = clamp(y, ib.y1, ib.y2);
      var d = distSq(x, y, cx, cy);
      if (d < bestDist) {
        bestDist = d;
        best = islands[j];
      }
    }
    return best;
  };

  // ---------------------------------------------------------------
  // _getIslandById(id) -- returns island object by id
  // ---------------------------------------------------------------
  World.prototype._getIslandById = function (id) {
    var islands = this.islands;
    for (var i = 0; i < islands.length; i++) {
      if (islands[i].id === id) return islands[i];
    }
    return null;
  };

  // ---------------------------------------------------------------
  // _randomPointInIsland(island) -- random position within island
  // ---------------------------------------------------------------
  World.prototype._randomPointInIsland = function (island) {
    var b = island.bounds;
    var margin = 20;
    return {
      x: (b.x1 + margin) + Math.random() * (b.x2 - b.x1 - margin * 2),
      y: (b.y1 + margin) + Math.random() * (b.y2 - b.y1 - margin * 2)
    };
  };

  // ---------------------------------------------------------------
  // _clampToIsland(creature) -- enforce island boundaries
  // ---------------------------------------------------------------
  World.prototype._clampToIsland = function (creature) {
    var island = this._getIslandById(creature.islandId);
    if (!island) return;
    var b = island.bounds;
    var s = creature.size;
    var bounced = false;

    if (creature.x < b.x1 + s) {
      creature.x = b.x1 + s;
      creature.angle = Math.PI - creature.angle;
      bounced = true;
    } else if (creature.x > b.x2 - s) {
      creature.x = b.x2 - s;
      creature.angle = Math.PI - creature.angle;
      bounced = true;
    }

    if (creature.y < b.y1 + s) {
      creature.y = b.y1 + s;
      creature.angle = -creature.angle;
      bounced = true;
    } else if (creature.y > b.y2 - s) {
      creature.y = b.y2 - s;
      creature.angle = -creature.angle;
      bounced = true;
    }

    if (bounced) {
      creature.angle = ((creature.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    }
  };

  // ---------------------------------------------------------------
  // _checkMigration() -- rare cross-island migration events
  // ---------------------------------------------------------------
  World.prototype._checkMigration = function () {
    if (this.islands.length < 2) return;
    if (this.tick - this._lastMigrationTick < Config.MIGRATION_MIN_INTERVAL) return;
    if (Math.random() >= Config.MIGRATION_CHANCE) return;

    var creatures = this.creatures;
    if (creatures.length === 0) return;

    // Pick random living creature
    var candidate = creatures[Math.floor(Math.random() * creatures.length)];
    if (!candidate.alive) return;

    var fromIslandId = candidate.islandId;

    // Pick a different island
    var otherIslands = [];
    for (var i = 0; i < this.islands.length; i++) {
      if (this.islands[i].id !== fromIslandId) {
        otherIslands.push(this.islands[i]);
      }
    }
    if (otherIslands.length === 0) return;

    var targetIsland = otherIslands[Math.floor(Math.random() * otherIslands.length)];
    var oldX = candidate.x;
    var oldY = candidate.y;

    // Teleport creature to target island
    var newPos = this._randomPointInIsland(targetIsland);
    candidate.x = newPos.x;
    candidate.y = newPos.y;
    candidate.islandId = targetIsland.id;

    this._lastMigrationTick = this.tick;

    // Store migration effect for renderer
    this._migrationEffects.push({
      fromX: oldX, fromY: oldY,
      toX: newPos.x, toY: newPos.y,
      hue: candidate.bodyGenes.hue,
      ticksLeft: 40, maxTicks: 40
    });

    Events.emit('creature:migrate', {
      creature: candidate,
      fromIsland: fromIslandId,
      toIsland: targetIsland.id
    });
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
        self._foodGridDirty = true;
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
    this.spatialGrid = new Array(GRID_TOTAL);
    this.foodGrid = new Array(GRID_TOTAL);
    this._foodGridDirty = true;

    // Reset counters
    this.tick = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.maxGeneration = 0;
    this.selectedCreature = null;
    this._lastMigrationTick = 0;
    this._migrationEffects = [];
    this._initIslands();
    this._initZones();
    this._initEvents();

    // Spawn initial creatures distributed across islands
    if (this.islands.length > 0) {
      var perIsland = Math.floor(INITIAL_CREATURE_COUNT / this.islands.length);
      for (var ii = 0; ii < this.islands.length; ii++) {
        for (i = 0; i < perIsland; i++) {
          this._spawnRandomCreature(this.islands[ii].id);
        }
      }
    } else {
      for (i = 0; i < INITIAL_CREATURE_COUNT; i++) {
        this._spawnRandomCreature();
      }
    }

    // Spawn initial food: half of max count, distributed across islands
    var initialFood = Math.floor(FOOD_MAX_COUNT / 2);
    for (i = 0; i < initialFood; i++) {
      var fx, fy;
      if (this.islands.length > 0) {
        var randIsland = this.islands[Math.floor(Math.random() * this.islands.length)];
        var fPt = this._randomPointInIsland(randIsland);
        fx = fPt.x;
        fy = fPt.y;
      } else {
        fx = 20 + Math.random() * (this.width - 40);
        fy = 20 + Math.random() * (this.height - 40);
      }
      this.food.push(createFood(fx, fy));
    }
    this._foodGridDirty = true;

    return this;
  };

  // ---------------------------------------------------------------
  // _spawnRandomCreature() -- internal helper
  // ---------------------------------------------------------------
  World.prototype._spawnRandomCreature = function (islandId) {
    var x, y, assignedIsland;

    if (this.islands.length > 0) {
      if (islandId) {
        assignedIsland = this._getIslandById(islandId);
      }
      if (!assignedIsland) {
        assignedIsland = this.islands[Math.floor(Math.random() * this.islands.length)];
      }
      var pt = this._randomPointInIsland(assignedIsland);
      x = pt.x;
      y = pt.y;
    } else {
      x = 20 + Math.random() * (this.width - 40);
      y = 20 + Math.random() * (this.height - 40);
    }

    var creature = new Creature({
      x: x,
      y: y,
      angle: Math.random() * Math.PI * 2,
      islandId: assignedIsland ? assignedIsland.id : null
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

    // Apply mutation storm boost (temporarily modify Config, restored after creature loop)
    var savedMutRate, savedMutStr;
    if (this.mutationStormTicks > 0) {
      savedMutRate = Config.MUTATION_RATE;
      savedMutStr = Config.MUTATION_STRENGTH;
      Config.MUTATION_RATE = Math.min(0.8, savedMutRate * Config.EVENT_MUTATION_STORM_MULTIPLIER);
      Config.MUTATION_STRENGTH = Math.min(0.6, savedMutStr * 1.5);
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

      // Enforce island boundaries (tighter than world edges)
      if (creature.islandId && this.islands.length > 0) {
        this._clampToIsland(creature);
      }

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

    // Restore mutation rate after creature processing
    if (savedMutRate !== undefined) {
      Config.MUTATION_RATE = savedMutRate;
      Config.MUTATION_STRENGTH = savedMutStr;
    }

    // World events — check, trigger, and apply ongoing effects
    this._checkWorldEvents();
    this._applyActiveEvents();

    // Drift fertile zones slowly
    for (i = 0; i < this.zones.length; i++) {
      var z = this.zones[i];
      z.x += z.vx;
      z.y += z.vy;
      // Bounce off island bounds (or world edges if no island)
      var zBoundsLeft = 0, zBoundsRight = this.width, zBoundsTop = 0, zBoundsBottom = this.height;
      if (z.islandId && this.islands.length > 0) {
        var zIsl = this._getIslandById(z.islandId);
        if (zIsl) {
          zBoundsLeft = zIsl.bounds.x1;
          zBoundsRight = zIsl.bounds.x2;
          zBoundsTop = zIsl.bounds.y1;
          zBoundsBottom = zIsl.bounds.y2;
        }
      }
      if (z.x < zBoundsLeft + z.radius) { z.x = zBoundsLeft + z.radius; z.vx = Math.abs(z.vx); }
      if (z.x > zBoundsRight - z.radius) { z.x = zBoundsRight - z.radius; z.vx = -Math.abs(z.vx); }
      if (z.y < zBoundsTop + z.radius) { z.y = zBoundsTop + z.radius; z.vy = Math.abs(z.vy); }
      if (z.y > zBoundsBottom - z.radius) { z.y = zBoundsBottom - z.radius; z.vy = -Math.abs(z.vy); }
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

    // Check for island migration events
    this._checkMigration();

    // Update migration visual effects
    for (i = this._migrationEffects.length - 1; i >= 0; i--) {
      this._migrationEffects[i].ticksLeft--;
      if (this._migrationEffects[i].ticksLeft <= 0) {
        this._migrationEffects.splice(i, 1);
      }
    }

    // Enforce minimum population — per-island if islands exist
    if (this.islands.length > 0) {
      for (i = 0; i < this.islands.length; i++) {
        var isl = this.islands[i];
        var islCount = 0;
        for (var ci = 0; ci < creatures.length; ci++) {
          if (creatures[ci].islandId === isl.id) islCount++;
        }
        if (islCount < 15) {
          for (var si = 0; si < 25; si++) {
            this._spawnRandomCreature(isl.id);
          }
        }
      }
    } else if (creatures.length < 30) {
      for (i = 0; i < 50; i++) {
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
        this._foodGridDirty = true;
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
      // Offspring inherits parent's island
      if (creature.islandId) {
        child.islandId = creature.islandId;
      }
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
    var grid = this.spatialGrid;
    var i, creature, col, row, idx;

    // Clear creature grid
    for (i = 0; i < GRID_TOTAL; i++) {
      grid[i] = null;
    }

    // Index creatures
    for (i = 0; i < this.creatures.length; i++) {
      creature = this.creatures[i];
      col = (creature.x / GRID_CELL_SIZE) | 0;
      row = (creature.y / GRID_CELL_SIZE) | 0;
      // Clamp to grid bounds
      if (col < 0) col = 0;
      if (col >= GRID_COLS) col = GRID_COLS - 1;
      if (row < 0) row = 0;
      if (row >= GRID_ROWS) row = GRID_ROWS - 1;
      idx = col * GRID_ROWS + row;
      if (!grid[idx]) {
        grid[idx] = [creature];
      } else {
        grid[idx].push(creature);
      }
    }

    // Only rebuild food grid when dirty
    if (this._foodGridDirty) {
      var foodGrid = this.foodGrid;
      var f;
      for (i = 0; i < GRID_TOTAL; i++) {
        foodGrid[i] = null;
      }
      for (i = 0; i < this.food.length; i++) {
        f = this.food[i];
        col = (f.x / GRID_CELL_SIZE) | 0;
        row = (f.y / GRID_CELL_SIZE) | 0;
        if (col < 0) col = 0;
        if (col >= GRID_COLS) col = GRID_COLS - 1;
        if (row < 0) row = 0;
        if (row >= GRID_ROWS) row = GRID_ROWS - 1;
        idx = col * GRID_ROWS + row;
        if (!foodGrid[idx]) {
          foodGrid[idx] = [f];
        } else {
          foodGrid[idx].push(f);
        }
      }
      this._foodGridDirty = false;
    }
  };

  // ---------------------------------------------------------------
  // getNearbyCreatures(x, y, range) -- spatial query for creatures
  // ---------------------------------------------------------------
  World.prototype.getNearbyCreatures = function (x, y, range) {
    var results = [];
    var rangeSq = range * range;
    var grid = this.spatialGrid;

    var cellRange = Math.ceil(range / GRID_CELL_SIZE);
    var cx = (x / GRID_CELL_SIZE) | 0;
    var cy = (y / GRID_CELL_SIZE) | 0;

    var gx, gy, idx, cell, i, creature, d;
    var minGx = cx - cellRange;
    var maxGx = cx + cellRange;
    var minGy = cy - cellRange;
    var maxGy = cy + cellRange;
    if (minGx < 0) minGx = 0;
    if (maxGx >= GRID_COLS) maxGx = GRID_COLS - 1;
    if (minGy < 0) minGy = 0;
    if (maxGy >= GRID_ROWS) maxGy = GRID_ROWS - 1;

    for (gx = minGx; gx <= maxGx; gx++) {
      for (gy = minGy; gy <= maxGy; gy++) {
        cell = grid[gx * GRID_ROWS + gy];
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
    var cx = (x / GRID_CELL_SIZE) | 0;
    var cy = (y / GRID_CELL_SIZE) | 0;

    var gx, gy, cell, i, f, d;
    var minGx = cx - cellRange;
    var maxGx = cx + cellRange;
    var minGy = cy - cellRange;
    var maxGy = cy + cellRange;
    if (minGx < 0) minGx = 0;
    if (maxGx >= GRID_COLS) maxGx = GRID_COLS - 1;
    if (minGy < 0) minGy = 0;
    if (maxGy >= GRID_ROWS) maxGy = GRID_ROWS - 1;

    for (gx = minGx; gx <= maxGx; gx++) {
      for (gy = minGy; gy <= maxGy; gy++) {
        cell = grid[gx * GRID_ROWS + gy];
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
    // Use island bounds if creature has an island assignment
    var wallLeft = 0, wallRight = this.width, wallTop = 0, wallBottom = this.height;
    if (creature.islandId && this.islands.length > 0) {
      var cIsland = this._getIslandById(creature.islandId);
      if (cIsland) {
        wallLeft = cIsland.bounds.x1;
        wallRight = cIsland.bounds.x2;
        wallTop = cIsland.bounds.y1;
        wallBottom = cIsland.bounds.y2;
      }
    }
    inputs[8] = Math.max(0, 1 - (cx - wallLeft) / WALL_SENSE_DIST);
    inputs[9] = Math.max(0, 1 - (wallRight - cx) / WALL_SENSE_DIST);

    // Inputs 10-11: wall proximity Y (top, bottom)
    inputs[10] = Math.max(0, 1 - (cy - wallTop) / WALL_SENSE_DIST);
    inputs[11] = Math.max(0, 1 - (wallBottom - cy) / WALL_SENSE_DIST);

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
    var hasIslands = this.islands.length > 0;

    // Helper: clamp food position to an island's bounds
    var self = this;
    function clampToIslandBounds(px, py, island) {
      var b = island.bounds;
      return {
        x: clamp(px, b.x1 + 20, b.x2 - 20),
        y: clamp(py, b.y1 + 20, b.y2 - 20)
      };
    }

    // Zone-biased spawning: 40% chance to spawn inside a fertile zone
    if (this.zones.length > 0 && Math.random() < 0.4) {
      var zone = this.zones[Math.floor(Math.random() * this.zones.length)];
      var zAngle = Math.random() * Math.PI * 2;
      var zDist = Math.random() * zone.radius;
      x = zone.x + Math.cos(zAngle) * zDist;
      y = zone.y + Math.sin(zAngle) * zDist;
      if (hasIslands) {
        var zIsland = self._getIslandAt(zone.x, zone.y);
        if (zIsland) {
          var zClamped = clampToIslandBounds(x, y, zIsland);
          x = zClamped.x;
          y = zClamped.y;
        }
      } else {
        x = clamp(x, 20, this.width - 20);
        y = clamp(y, 20, this.height - 20);
      }
      this.food.push(createFood(x, y));
      this._foodGridDirty = true;
      return;
    }

    // Cluster chance: spawn near existing food
    if (this.food.length > 0 && Math.random() < FOOD_CLUSTER_CHANCE) {
      var anchor = this.food[Math.floor(Math.random() * this.food.length)];
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.random() * FOOD_CLUSTER_RADIUS;
      x = anchor.x + Math.cos(angle) * dist;
      y = anchor.y + Math.sin(angle) * dist;
      if (hasIslands) {
        var aIsland = self._getIslandAt(anchor.x, anchor.y);
        if (aIsland) {
          var aClamped = clampToIslandBounds(x, y, aIsland);
          x = aClamped.x;
          y = aClamped.y;
        }
      } else {
        x = clamp(x, 20, this.width - 20);
        y = clamp(y, 20, this.height - 20);
      }
    } else {
      // Random position — within a random island if islands exist
      if (hasIslands) {
        var randIsland = this.islands[Math.floor(Math.random() * this.islands.length)];
        var pt = this._randomPointInIsland(randIsland);
        x = pt.x;
        y = pt.y;
      } else {
        x = 20 + Math.random() * (this.width - 40);
        y = 20 + Math.random() * (this.height - 40);
      }
    }

    this.food.push(createFood(x, y));
    this._foodGridDirty = true;
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
    this._foodGridDirty = true;
    Events.emit('food:add', { food: f });
    return f;
  };

  // ---------------------------------------------------------------
  // addCreature(x, y) -- add a random creature at specific position
  // ---------------------------------------------------------------
  World.prototype.addCreature = function (x, y) {
    var cx = clamp(x, 0, this.width);
    var cy = clamp(y, 0, this.height);
    var island = this.islands.length > 0 ? this._getIslandAt(cx, cy) : null;
    var creature = new Creature({
      x: cx,
      y: cy,
      angle: Math.random() * Math.PI * 2,
      islandId: island ? island.id : null
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
  // _checkWorldEvents() -- schedule and trigger random world events
  // ---------------------------------------------------------------
  World.prototype._checkWorldEvents = function () {
    // Tick down active events
    var i;
    for (i = this.activeEvents.length - 1; i >= 0; i--) {
      this.activeEvents[i].ticksLeft--;
      if (this.activeEvents[i].ticksLeft <= 0) {
        this.activeEvents.splice(i, 1);
      }
    }

    // Tick down mutation storm
    if (this.mutationStormTicks > 0) {
      this.mutationStormTicks--;
    }

    // Check if it's time for a new event
    if (this.tick < this.nextEventTick) return;

    // Schedule next event
    this.nextEventTick = this.tick + Config.EVENT_MIN_INTERVAL +
      Math.floor(Math.random() * (Config.EVENT_MAX_INTERVAL - Config.EVENT_MIN_INTERVAL));

    // Pick random event type
    var types = ['bloom', 'plague', 'meteor', 'mutationStorm'];
    var type = types[Math.floor(Math.random() * types.length)];
    this._triggerWorldEvent(type);
  };

  // ---------------------------------------------------------------
  // _triggerWorldEvent(type) -- execute a world event
  // ---------------------------------------------------------------
  World.prototype._triggerWorldEvent = function (type) {
    var x, y;
    var eventIsland = null;
    if (this.islands.length > 0) {
      eventIsland = this.islands[Math.floor(Math.random() * this.islands.length)];
      var eb = eventIsland.bounds;
      x = (eb.x1 + 200) + Math.random() * (eb.x2 - eb.x1 - 400);
      y = (eb.y1 + 200) + Math.random() * (eb.y2 - eb.y1 - 400);
    } else {
      x = 200 + Math.random() * (this.width - 400);
      y = 200 + Math.random() * (this.height - 400);
    }
    var i, a, d, fx, fy;

    switch (type) {
      case 'bloom':
        var bloomRadius = Config.EVENT_BLOOM_RADIUS;
        var bloomCount = Config.EVENT_BLOOM_FOOD_COUNT;
        var bloomMinX = 20, bloomMaxX = this.width - 20;
        var bloomMinY = 20, bloomMaxY = this.height - 20;
        if (eventIsland) {
          bloomMinX = eventIsland.bounds.x1 + 20;
          bloomMaxX = eventIsland.bounds.x2 - 20;
          bloomMinY = eventIsland.bounds.y1 + 20;
          bloomMaxY = eventIsland.bounds.y2 - 20;
        }
        for (i = 0; i < bloomCount; i++) {
          a = Math.random() * Math.PI * 2;
          d = Math.random() * bloomRadius;
          fx = clamp(x + Math.cos(a) * d, bloomMinX, bloomMaxX);
          fy = clamp(y + Math.sin(a) * d, bloomMinY, bloomMaxY);
          this.food.push(createFood(fx, fy));
        }
        this._foodGridDirty = true;
        this.activeEvents.push({
          type: 'bloom', x: x, y: y, radius: bloomRadius,
          ticksLeft: 120, maxTicks: 120
        });
        Events.emit('world:event', { type: 'bloom', label: 'Food Bloom' });
        break;

      case 'plague':
        var plagueRadius = Config.EVENT_PLAGUE_RADIUS;
        this.activeEvents.push({
          type: 'plague', x: x, y: y, radius: plagueRadius,
          ticksLeft: Config.EVENT_PLAGUE_DURATION, maxTicks: Config.EVENT_PLAGUE_DURATION
        });
        Events.emit('world:event', { type: 'plague', label: 'Plague' });
        break;

      case 'meteor':
        var meteorRadius = Config.EVENT_METEOR_KILL_RADIUS;
        var meteorRadiusSq = meteorRadius * meteorRadius;
        // Kill creatures in blast radius
        for (i = this.creatures.length - 1; i >= 0; i--) {
          var c = this.creatures[i];
          if (!c.alive) continue;
          var dx = c.x - x, dy = c.y - y;
          if (dx * dx + dy * dy < meteorRadiusSq) {
            c.die();
          }
        }
        // Create a fertile crater zone at impact
        this.zones.push({
          x: x, y: y,
          radius: Config.EVENT_METEOR_ZONE_RADIUS,
          spawnMultiplier: 3 + Math.random() * 2,
          vx: 0, vy: 0,
          islandId: eventIsland ? eventIsland.id : undefined
        });
        this.activeEvents.push({
          type: 'meteor', x: x, y: y, radius: meteorRadius,
          ticksLeft: 90, maxTicks: 90
        });
        Events.emit('world:event', { type: 'meteor', label: 'Meteor Impact' });
        break;

      case 'mutationStorm':
        this.mutationStormTicks = Config.EVENT_MUTATION_STORM_DURATION;
        this.activeEvents.push({
          type: 'mutationStorm', x: this.width / 2, y: this.height / 2,
          radius: Math.max(this.width, this.height),
          ticksLeft: Config.EVENT_MUTATION_STORM_DURATION,
          maxTicks: Config.EVENT_MUTATION_STORM_DURATION
        });
        Events.emit('world:event', { type: 'mutationStorm', label: 'Mutation Storm' });
        break;
    }
  };

  // ---------------------------------------------------------------
  // _applyActiveEvents() -- apply ongoing effects of active events
  // ---------------------------------------------------------------
  World.prototype._applyActiveEvents = function () {
    var events = this.activeEvents;
    var creatures = this.creatures;
    var i, j, evt, c;

    for (i = 0; i < events.length; i++) {
      evt = events[i];
      if (evt.type === 'plague') {
        var nearby = this.getNearbyCreatures(evt.x, evt.y, evt.radius);
        for (j = 0; j < nearby.length; j++) {
          c = nearby[j];
          if (!c.alive) continue;
          var resistance = c.bodyGenes.efficiency;
          var damage = Config.EVENT_PLAGUE_DAMAGE * (1.5 - resistance);
          if (damage > 0) {
            c.energy -= damage;
          }
        }
      }
    }
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
