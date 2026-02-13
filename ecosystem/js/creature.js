/**
 * EcoSim Creature System
 *
 * Provides EcoSim.Creature — the living entities in the evolutionary
 * ecosystem simulator. Each creature has a neural network brain,
 * body genes that define physical traits, and behavioral state
 * driven by brain outputs every tick.
 *
 * Dependencies (loaded before this file):
 *   - EcoSim.Config
 *   - EcoSim.NeuralNetwork
 *   - EcoSim.nextId()
 *   - EcoSim.Events
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;
  var NeuralNetwork = EcoSim.NeuralNetwork;
  var Events = EcoSim.Events;

  // -------------------------------------------------------------------
  // Local references for hot-path math
  // -------------------------------------------------------------------
  var cos = Math.cos;
  var sin = Math.sin;
  var atan2 = Math.atan2;
  var sqrt = Math.sqrt;
  var random = Math.random;
  var floor = Math.floor;
  var round = Math.round;
  var abs = Math.abs;
  var max = Math.max;
  var min = Math.min;
  var PI = Math.PI;

  // -------------------------------------------------------------------
  // Body gene ranges
  // -------------------------------------------------------------------
  var GENE_RANGES = {
    size:       { min: Config.CREATURE_MIN_SIZE, max: Config.CREATURE_MAX_SIZE },
    maxSpeed:   { min: 1, max: Config.CREATURE_MAX_SPEED },
    turnSpeed:  { min: 0.05, max: 0.2 },
    hue:        { min: 0, max: 360 },
    saturation: { min: 40, max: 100 },
    aggression: { min: 0, max: 1 },
    efficiency: { min: 0.5, max: 1.5 }
  };

  // -------------------------------------------------------------------
  // Utility: gaussian-ish random noise (same approach as neural.js)
  // -------------------------------------------------------------------
  function gaussianIsh(strength) {
    return ((random() + random() + random()) / 3 * 2 - 1) * strength * 3;
  }

  // -------------------------------------------------------------------
  // Utility: clamp a value between min and max
  // -------------------------------------------------------------------
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // -------------------------------------------------------------------
  // Utility: random float in [lo, hi)
  // -------------------------------------------------------------------
  function randRange(lo, hi) {
    return lo + random() * (hi - lo);
  }

  // -------------------------------------------------------------------
  // Generate random body genes, each within its valid range
  // -------------------------------------------------------------------
  function randomBodyGenes() {
    var genes = {};
    var keys = Object.keys(GENE_RANGES);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var range = GENE_RANGES[key];
      genes[key] = randRange(range.min, range.max);
    }
    return genes;
  }

  // -------------------------------------------------------------------
  // Compute species ID from body genes.
  // Quantize hue to nearest 30 degrees, size to nearest 3.
  // -------------------------------------------------------------------
  function computeSpeciesId(bodyGenes) {
    var quantizedHue = round(bodyGenes.hue / 30) * 30;
    // Wrap hue: 360 becomes 0
    if (quantizedHue >= 360) quantizedHue = 0;
    var quantizedSize = round(bodyGenes.size / 3) * 3;
    return quantizedHue + '_' + quantizedSize;
  }

  // ===================================================================
  // Creature class
  // ===================================================================

  /**
   * @param {Object} [options] - Configuration for the new creature.
   * @param {number} [options.x]          - X position (default: random)
   * @param {number} [options.y]          - Y position (default: random)
   * @param {Object} [options.genome]     - Neural network genome (default: null = random brain)
   * @param {Object} [options.bodyGenes]  - Body trait genes (default: random)
   * @param {number} [options.generation] - Generation number (default: 0)
   * @param {number} [options.parentId]   - Parent's ID (default: null)
   */
  function Creature(options) {
    options = options || {};

    // Identity
    this.id = EcoSim.nextId();
    this.generation = options.generation !== undefined ? options.generation : 0;
    this.parentId = options.parentId !== undefined ? options.parentId : null;

    // Body genes
    this.bodyGenes = options.bodyGenes ? copyBodyGenes(options.bodyGenes) : randomBodyGenes();

    // Derived size (convenience)
    this.size = this.bodyGenes.size;

    // Species classification
    this.speciesId = computeSpeciesId(this.bodyGenes);

    // Position
    this.x = options.x !== undefined ? options.x : randRange(this.size, Config.WORLD_WIDTH - this.size);
    this.y = options.y !== undefined ? options.y : randRange(this.size, Config.WORLD_HEIGHT - this.size);

    // Movement state
    this.angle = random() * PI * 2;
    this.speed = 0;

    // Energy
    this.energy = Config.CREATURE_INITIAL_ENERGY;

    // Age & lifecycle
    this.age = 0;
    this.alive = true;
    this.reproductionCooldown = 0;

    // Brain
    this.brain = new NeuralNetwork(options.genome || null);

    // Statistics
    this.kills = 0;
    this.foodEaten = 0;
    this.children = 0;

    // Rendering / UI state
    this.trailPositions = [];
    this.lastAction = 'idle';

    // Behavioral flags (set each tick by brain outputs)
    this.wantsToEat = false;
    this.wantsToReproduce = false;
    this.signal = 0; // broadcast signal (-1 to 1), sensed by nearby creatures
  }

  // -------------------------------------------------------------------
  // Deep-copy body genes object
  // -------------------------------------------------------------------
  function copyBodyGenes(genes) {
    return {
      size:       genes.size,
      maxSpeed:   genes.maxSpeed,
      turnSpeed:  genes.turnSpeed,
      hue:        genes.hue,
      saturation: genes.saturation,
      aggression: genes.aggression,
      efficiency: genes.efficiency
    };
  }

  // -------------------------------------------------------------------
  // update(inputs)
  //
  // Called every simulation tick with 12 sensory input floats.
  // Runs the brain, interprets outputs, moves, drains energy.
  // -------------------------------------------------------------------
  Creature.prototype.update = function (inputs) {
    if (!this.alive) return;

    // Reset last action — will be set again if creature eats/attacks/reproduces this tick
    this.lastAction = 'idle';

    // 1. Feed inputs through brain
    var outputs = this.brain.forward(inputs);

    // 2. Interpret outputs
    //    output[0]: turn amount
    this.angle += outputs[0] * this.bodyGenes.turnSpeed;

    //    output[1]: speed — map from [-1, 1] to [0, maxSpeed]
    //    Low aggression (<0.3) creatures get up to 15% speed bonus (prey adaptation)
    var speedBonus = this.bodyGenes.aggression < 0.3 ? 1 + (0.3 - this.bodyGenes.aggression) * 0.5 : 1;
    this.speed = ((outputs[1] + 1) / 2) * this.bodyGenes.maxSpeed * speedBonus;

    //    output[2]: eat/attack desire
    this.wantsToEat = outputs[2] > 0;

    //    output[3]: reproduce desire
    this.wantsToReproduce = outputs[3] > 0;

    //    output[4]: signal broadcast (-1 to 1)
    this.signal = outputs[4];

    // 3. Move
    this.x += cos(this.angle) * this.speed;
    this.y += sin(this.angle) * this.speed;

    // 4. Bounce off walls — reverse the relevant angle component and clamp
    var bounced = false;
    if (this.x < this.size) {
      this.x = this.size;
      this.angle = PI - this.angle;
      bounced = true;
    } else if (this.x > Config.WORLD_WIDTH - this.size) {
      this.x = Config.WORLD_WIDTH - this.size;
      this.angle = PI - this.angle;
      bounced = true;
    }

    if (this.y < this.size) {
      this.y = this.size;
      this.angle = -this.angle;
      bounced = true;
    } else if (this.y > Config.WORLD_HEIGHT - this.size) {
      this.y = Config.WORLD_HEIGHT - this.size;
      this.angle = -this.angle;
      bounced = true;
    }

    // Normalize angle to [0, 2*PI) after potential bouncing
    if (bounced) {
      this.angle = ((this.angle % (PI * 2)) + PI * 2) % (PI * 2);
    }

    // 5. Drain energy
    var energyCost = (
      Config.CREATURE_ENERGY_DRAIN +
      this.speed * Config.CREATURE_MOVE_ENERGY_COST +
      this.size * Config.CREATURE_SIZE_ENERGY_COST
    ) / this.bodyGenes.efficiency;
    this.energy -= energyCost;

    // 6. Update trail
    this.trailPositions.push({ x: this.x, y: this.y });
    if (this.trailPositions.length > Config.TRAIL_LENGTH) {
      this.trailPositions.shift();
    }

    // 7. Increment age
    this.age++;

    // 8. Decrement reproduction cooldown
    if (this.reproductionCooldown > 0) {
      this.reproductionCooldown--;
    }

    // 9. Check for death
    if (this.energy <= 0) {
      this.energy = 0;
      this.die();
    }

    // Update last action to 'moving' if nothing special happened and creature is moving
    if (this.alive && this.lastAction === 'idle' && this.speed > 0.1) {
      this.lastAction = 'moving';
    }
  };

  // -------------------------------------------------------------------
  // eat(foodEnergy)
  // -------------------------------------------------------------------
  Creature.prototype.eat = function (foodEnergy) {
    this.energy = min(this.energy + foodEnergy, Config.CREATURE_MAX_ENERGY);
    this.foodEaten++;
    this.lastAction = 'eating';
    Events.emit('creature:eat', { creature: this });
  };

  // -------------------------------------------------------------------
  // attack(other)
  // -------------------------------------------------------------------
  Creature.prototype.attack = function (other) {
    // Transfer energy
    this.energy += Config.CREATURE_ATTACK_ENERGY_GAIN;
    other.energy -= Config.CREATURE_ATTACK_ENERGY_GAIN;

    // Cap own energy
    this.energy = min(this.energy, Config.CREATURE_MAX_ENERGY);

    // Check if target dies
    if (other.energy <= 0) {
      other.energy = 0;
      other.die();
      this.kills++;
    }

    this.lastAction = 'attacking';
    Events.emit('creature:attack', { creature: this, target: other });
  };

  // -------------------------------------------------------------------
  // canReproduce()
  // -------------------------------------------------------------------
  Creature.prototype.canReproduce = function () {
    return (
      this.alive &&
      this.energy > Config.CREATURE_REPRODUCTION_THRESHOLD &&
      this.age > Config.CREATURE_MIN_REPRODUCTION_AGE &&
      this.reproductionCooldown <= 0
    );
  };

  // -------------------------------------------------------------------
  // reproduce(partner)
  //
  // partner is optional (null/undefined = asexual reproduction).
  // Returns the newly created offspring Creature.
  // -------------------------------------------------------------------
  Creature.prototype.reproduce = function (partner) {
    // Determine offspring position: offset from parent
    var offsetAngle = random() * PI * 2;
    var offsetDist = this.size * 2;
    var childX = this.x + cos(offsetAngle) * offsetDist;
    var childY = this.y + sin(offsetAngle) * offsetDist;

    // Clamp to world bounds
    childX = clamp(childX, Config.CREATURE_MIN_SIZE, Config.WORLD_WIDTH - Config.CREATURE_MIN_SIZE);
    childY = clamp(childY, Config.CREATURE_MIN_SIZE, Config.WORLD_HEIGHT - Config.CREATURE_MIN_SIZE);

    // Create offspring brain
    var childBrain;
    if (partner) {
      // Sexual reproduction: crossover then mutate
      childBrain = NeuralNetwork.crossover(this.brain, partner.brain);
      childBrain.mutate(Config.MUTATION_RATE, Config.MUTATION_STRENGTH);
    } else {
      // Asexual reproduction: copy genome then mutate
      childBrain = new NeuralNetwork(this.brain.getGenome());
      childBrain.mutate(Config.MUTATION_RATE, Config.MUTATION_STRENGTH);
    }

    // Create offspring body genes
    var childGenes;
    if (partner) {
      childGenes = mixBodyGenes(this.bodyGenes, partner.bodyGenes);
    } else {
      childGenes = copyBodyGenes(this.bodyGenes);
    }
    childGenes = Creature.mutateBodyGenes(childGenes, Config.MUTATION_RATE, Config.MUTATION_STRENGTH);

    // Compute offspring generation
    var childGeneration = max(this.generation, partner ? partner.generation : 0) + 1;

    // Create the offspring creature
    var offspring = new Creature({
      x: childX,
      y: childY,
      genome: childBrain.getGenome(),
      bodyGenes: childGenes,
      generation: childGeneration,
      parentId: this.id
    });

    // Deduct reproduction cost
    this.energy -= Config.CREATURE_REPRODUCTION_COST;
    if (partner) {
      partner.energy -= Config.CREATURE_REPRODUCTION_COST;
    }

    // Update parent state
    this.reproductionCooldown = Config.CREATURE_REPRODUCTION_COOLDOWN;
    this.children++;
    this.lastAction = 'reproducing';

    // If partner exists, update their cooldown and children count too
    if (partner) {
      partner.reproductionCooldown = Config.CREATURE_REPRODUCTION_COOLDOWN;
      partner.children++;
    }

    Events.emit('creature:reproduce', { creature: this, offspring: offspring });

    return offspring;
  };

  // -------------------------------------------------------------------
  // Mix body genes from two parents (per-gene random pick or average)
  // -------------------------------------------------------------------
  function mixBodyGenes(genes1, genes2) {
    var result = {};
    var keys = Object.keys(GENE_RANGES);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      // 50% chance to pick from either parent, or blend
      if (random() < 0.5) {
        result[key] = genes1[key];
      } else {
        result[key] = genes2[key];
      }
    }
    return result;
  }

  // -------------------------------------------------------------------
  // die()
  // -------------------------------------------------------------------
  Creature.prototype.die = function () {
    if (!this.alive) return; // prevent double-death
    this.alive = false;
    this.lastAction = 'dead';
    Events.emit('creature:die', { creature: this });
  };

  // -------------------------------------------------------------------
  // getColor(alpha)
  //
  // Returns an HSLA color string. Lightness is based on energy level:
  // 30% at low energy, 70% at high energy.
  // -------------------------------------------------------------------
  Creature.prototype.getColor = function (alpha) {
    var energyRatio = clamp(this.energy / Config.CREATURE_MAX_ENERGY, 0, 1);
    var lightness = 30 + energyRatio * 40; // 30% to 70%
    var a = alpha !== undefined ? alpha : 1;
    return 'hsla(' +
      round(this.bodyGenes.hue) + ', ' +
      round(this.bodyGenes.saturation) + '%, ' +
      round(lightness) + '%, ' +
      a + ')';
  };

  // -------------------------------------------------------------------
  // distanceTo(other)
  //
  // Returns euclidean distance to another entity with x, y properties.
  // -------------------------------------------------------------------
  Creature.prototype.distanceTo = function (other) {
    var dx = this.x - other.x;
    var dy = this.y - other.y;
    return sqrt(dx * dx + dy * dy);
  };

  // -------------------------------------------------------------------
  // angleTo(other)
  //
  // Returns angle from this creature to another entity.
  // -------------------------------------------------------------------
  Creature.prototype.angleTo = function (other) {
    return atan2(other.y - this.y, other.x - this.x);
  };

  // -------------------------------------------------------------------
  // getInfo()
  //
  // Returns a plain object with all creature stats for the UI inspector.
  // -------------------------------------------------------------------
  Creature.prototype.getInfo = function () {
    return {
      id: this.id,
      x: round(this.x * 10) / 10,
      y: round(this.y * 10) / 10,
      angle: round(this.angle * 100) / 100,
      speed: round(this.speed * 100) / 100,
      size: round(this.size * 10) / 10,
      energy: round(this.energy * 10) / 10,
      maxEnergy: Config.CREATURE_MAX_ENERGY,
      age: this.age,
      generation: this.generation,
      parentId: this.parentId,
      alive: this.alive,
      speciesId: this.speciesId,
      kills: this.kills,
      foodEaten: this.foodEaten,
      children: this.children,
      lastAction: this.lastAction,
      bodyGenes: copyBodyGenes(this.bodyGenes),
      brainComplexity: this.brain.getComplexity ? this.brain.getComplexity() : 0,
      reproductionCooldown: this.reproductionCooldown
    };
  };

  // -------------------------------------------------------------------
  // static mutateBodyGenes(genes, rate, strength)
  //
  // Returns a new bodyGenes object with each gene potentially mutated.
  // Each gene: if random < rate, add gaussian-ish noise scaled by
  // strength. Clamps to valid range. Hue wraps around (0-360).
  // -------------------------------------------------------------------
  Creature.mutateBodyGenes = function (genes, rate, strength) {
    rate = rate !== undefined ? rate : Config.MUTATION_RATE;
    strength = strength !== undefined ? strength : Config.MUTATION_STRENGTH;

    var result = copyBodyGenes(genes);
    var keys = Object.keys(GENE_RANGES);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (random() < rate) {
        var range = GENE_RANGES[key];
        var span = range.max - range.min;
        var noise = gaussianIsh(strength) * span;

        result[key] += noise;

        if (key === 'hue') {
          // Hue wraps around
          result[key] = ((result[key] % 360) + 360) % 360;
        } else {
          // All other genes clamp to valid range
          result[key] = clamp(result[key], range.min, range.max);
        }
      }
    }

    return result;
  };

  // -------------------------------------------------------------------
  // Attach to EcoSim namespace
  // -------------------------------------------------------------------
  EcoSim.Creature = Creature;

})();
