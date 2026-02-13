/**
 * EcoSim Canvas Renderer
 *
 * Provides EcoSim.Renderer -- handles all visual rendering on the main
 * world canvas (creatures, food, particles, trails, selection) plus
 * neural network brain visualization on a secondary canvas.
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;

  var BG_COLOR    = Config.BG_COLOR;
  var GRID_COLOR  = Config.GRID_COLOR;
  var REPRODUCTION_THRESHOLD = Config.CREATURE_REPRODUCTION_THRESHOLD;
  var VISION_RANGE = Config.CREATURE_VISION_RANGE;

  var NN_INPUT_SIZE   = Config.NN_INPUT_SIZE;
  var NN_HIDDEN1_SIZE = Config.NN_HIDDEN1_SIZE;
  var NN_HIDDEN2_SIZE = Config.NN_HIDDEN2_SIZE;
  var NN_OUTPUT_SIZE  = Config.NN_OUTPUT_SIZE;

  var cos   = Math.cos;
  var sin   = Math.sin;
  var abs   = Math.abs;
  var round = Math.round;
  var min   = Math.min;
  var max   = Math.max;
  var PI    = Math.PI;
  var TAU   = PI * 2;

  var INPUT_LABELS = [
    'food_dx', 'food_dy', 'food_d',
    'cr_dx', 'cr_dy', 'cr_d', 'cr_sz',
    'energy',
    'wall_l', 'wall_r', 'wall_u', 'wall_d'
  ];
  var OUTPUT_LABELS = ['turn', 'speed', 'eat', 'repro'];

  function Renderer(worldCanvas, brainCanvas) {
    this.worldCanvas = worldCanvas;
    this.brainCanvas = brainCanvas;

    this.ctx = worldCanvas.getContext('2d');
    this.brainCtx = brainCanvas.getContext('2d');

    this.showTrails = true;
    this.showVision = false;

    this._dashOffset = 0;
    this._dpr = window.devicePixelRatio || 1;

    this.brainCanvas.width = 300 * this._dpr;
    this.brainCanvas.height = 180 * this._dpr;
    this.brainCanvas.style.width = '300px';
    this.brainCanvas.style.height = '180px';
    this.brainCtx.scale(this._dpr, this._dpr);

    this.resize();
  }

  Renderer.prototype.resize = function () {
    var parent = this.worldCanvas.parentElement;
    if (!parent) return;

    var dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;

    var width = parent.clientWidth;
    var height = parent.clientHeight;

    this.worldCanvas.width = width * dpr;
    this.worldCanvas.height = height * dpr;
    this.worldCanvas.style.width = width + 'px';
    this.worldCanvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer.prototype.render = function (world) {
    var ctx = this.ctx;
    var canvas = this.worldCanvas;
    var dpr = this._dpr;

    var logicalWidth = canvas.width / dpr;
    var logicalHeight = canvas.height / dpr;

    var scaleX = logicalWidth / world.width;
    var scaleY = logicalHeight / world.height;
    var scale = min(scaleX, scaleY);

    var offsetX = (logicalWidth - world.width * scale) * 0.5;
    var offsetY = (logicalHeight - world.height * scale) * 0.5;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    this.drawGrid(ctx, world.width, world.height);
    this.drawFood(ctx, world.food);

    if (this.showTrails) {
      this.drawCreatureTrails(ctx, world.creatures);
    }

    this.drawCreatures(ctx, world.creatures, world.tick);
    this.drawParticles(ctx, world.particles);

    if (world.selectedCreature && world.selectedCreature.alive) {
      this.drawSelection(ctx, world.selectedCreature, world.tick);
    }

    if (this.showVision && world.selectedCreature && world.selectedCreature.alive) {
      this.drawVisionRange(ctx, world.selectedCreature);
    }

    ctx.restore();
  };

  Renderer.prototype.drawGrid = function (ctx, width, height) {
    ctx.beginPath();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    var x, y;
    for (x = 0; x <= width; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (y = 0; y <= height; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  };

  Renderer.prototype.drawFood = function (ctx, food) {
    var i, f, pulse, glowRadius, grad;

    for (i = 0; i < food.length; i++) {
      f = food[i];
      pulse = 0.7 + 0.3 * sin(f.age * 0.05);
      glowRadius = (f.size + 6) * pulse;

      grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowRadius);
      grad.addColorStop(0, 'rgba(124, 255, 107, ' + (0.35 * f.glow * pulse) + ')');
      grad.addColorStop(0.5, 'rgba(124, 255, 107, ' + (0.12 * f.glow * pulse) + ')');
      grad.addColorStop(1, 'rgba(124, 255, 107, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, glowRadius, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#7cff6b';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype.drawCreatureTrails = function (ctx, creatures) {
    var i, creature, trail, j, alpha, t;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      trail = creature.trailPositions;
      if (!trail || trail.length < 2) continue;

      var color = creature.bodyGenes.hue;
      var sat = creature.bodyGenes.saturation;

      for (j = 1; j < trail.length; j++) {
        alpha = (j / trail.length) * 0.3;
        t = (j / trail.length) * creature.size * 0.5;

        ctx.beginPath();
        ctx.strokeStyle = 'hsla(' + round(color) + ', ' + round(sat) + '%, 50%, ' + alpha + ')';
        ctx.lineWidth = max(0.5, t);
        ctx.moveTo(trail[j - 1].x, trail[j - 1].y);
        ctx.lineTo(trail[j].x, trail[j].y);
        ctx.stroke();
      }
    }
  };

  Renderer.prototype.drawCreatures = function (ctx, creatures, tick) {
    var i, creature, cx, cy, r, angle, grad;
    var eyeOffset = 0.4;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      if (!creature.alive) continue;

      cx = creature.x;
      cy = creature.y;
      r = creature.size;
      angle = creature.angle;

      var bodyColor = creature.getColor(1.0);

      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, creature.getColor(0.9));
      grad.addColorStop(0.4, bodyColor);
      grad.addColorStop(1, creature.getColor(0.7));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // Direction bump
      var dirX = cos(angle);
      var dirY = sin(angle);
      var bumpDist = r * 0.85;
      var bumpR = r * 0.35;

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(cx + dirX * bumpDist, cy + dirY * bumpDist, bumpR, 0, TAU);
      ctx.fill();

      // Eyes
      var eyeR = max(1, r * 0.18);
      var eyeDist = r * 0.55;
      var eyeLX = cx + cos(angle - eyeOffset) * eyeDist;
      var eyeLY = cy + sin(angle - eyeOffset) * eyeDist;
      var eyeRX = cx + cos(angle + eyeOffset) * eyeDist;
      var eyeRY = cy + sin(angle + eyeOffset) * eyeDist;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(eyeLX, eyeLY, eyeR, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeRX, eyeRY, eyeR, 0, TAU);
      ctx.fill();

      // Pupils
      var pupilR = max(0.5, eyeR * 0.5);
      var pupilDist = r * 0.65;

      ctx.fillStyle = '#0a0e17';
      ctx.beginPath();
      ctx.arc(cx + cos(angle - eyeOffset) * pupilDist, cy + sin(angle - eyeOffset) * pupilDist, pupilR, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + cos(angle + eyeOffset) * pupilDist, cy + sin(angle + eyeOffset) * pupilDist, pupilR, 0, TAU);
      ctx.fill();

      // Reproduction glow
      if (creature.energy > REPRODUCTION_THRESHOLD) {
        var reproGlowAlpha = 0.15 + 0.1 * sin(tick * 0.1);
        ctx.strokeStyle = 'rgba(100, 255, 220, ' + reproGlowAlpha + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3 + sin(tick * 0.08) * 1.5, 0, TAU);
        ctx.stroke();
      }

      // Action flash rings
      if (creature.lastAction === 'attacking') {
        ctx.strokeStyle = 'rgba(255, 60, 30, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, TAU);
        ctx.stroke();
      } else if (creature.lastAction === 'eating') {
        ctx.strokeStyle = 'rgba(100, 255, 100, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, TAU);
        ctx.stroke();
      }
    }
  };

  Renderer.prototype.drawParticles = function (ctx, particles) {
    var i, p, progress, alpha, radius;

    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      progress = p.age / p.maxAge;
      alpha = 1 - progress;
      if (alpha <= 0) continue;

      switch (p.type) {
        case 'eat':
          radius = p.size * (1 + progress * 2);
          ctx.fillStyle = 'rgba(100, 255, 100, ' + (alpha * 0.7) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.fill();
          break;

        case 'attack':
          radius = p.size * (1 + progress * 3);
          ctx.fillStyle = 'rgba(255, 136, 34, ' + (alpha * 0.6) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.fill();
          break;

        case 'ring':
          radius = 3 + progress * 25;
          ctx.strokeStyle = 'rgba(34, 221, 255, ' + (alpha * 0.6) + ')';
          ctx.lineWidth = max(0.5, 2 * (1 - progress));
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.stroke();
          break;

        case 'die':
          radius = p.size * (1 - progress * 0.5);
          if (radius <= 0) continue;
          ctx.fillStyle = 'rgba(255, 50, 50, ' + (alpha * 0.5) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.fill();
          break;
      }
    }
  };

  Renderer.prototype.drawSelection = function (ctx, creature, tick) {
    var cx = creature.x;
    var cy = creature.y;
    var r = creature.size + 8;

    this._dashOffset += 0.3;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = this._dashOffset;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    var label = 'Gen ' + creature.generation + ' | E:' + round(creature.energy);
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(label, cx, cy - r - 4);
  };

  Renderer.prototype.drawVisionRange = function (ctx, creature) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(creature.x, creature.y, VISION_RANGE, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.beginPath();
    ctx.arc(creature.x, creature.y, VISION_RANGE, 0, TAU);
    ctx.fill();
  };

  Renderer.prototype.renderBrain = function (world) {
    var ctx = this.brainCtx;
    var cw = 300;
    var ch = 180;

    ctx.clearRect(0, 0, cw, ch);

    var creature = world.selectedCreature;
    if (!creature || !creature.alive || !creature.brain) return;

    var brain = creature.brain;

    var layers = [
      { size: NN_INPUT_SIZE,   activations: brain.lastInputs },
      { size: NN_HIDDEN1_SIZE, activations: brain.lastHidden1 },
      { size: NN_HIDDEN2_SIZE, activations: brain.lastHidden2 },
      { size: NN_OUTPUT_SIZE,  activations: brain.lastOutputs }
    ];

    var weights = [brain.weights1, brain.weights2, brain.weights3];
    var nextSizes = [NN_HIDDEN1_SIZE, NN_HIDDEN2_SIZE, NN_OUTPUT_SIZE];
    var prevSizes = [NN_INPUT_SIZE, NN_HIDDEN1_SIZE, NN_HIDDEN2_SIZE];

    var marginX = 42;
    var marginY = 12;
    var usableWidth = cw - marginX * 2;
    var usableHeight = ch - marginY * 2;
    var colSpacing = usableWidth / (layers.length - 1);

    var nodePositions = [];
    var li, ni, layerX, nodeSpacing;
    var nodeRadius = 4;

    for (li = 0; li < layers.length; li++) {
      var layerNodes = [];
      layerX = marginX + li * colSpacing;
      nodeSpacing = usableHeight / (layers[li].size + 1);

      for (ni = 0; ni < layers[li].size; ni++) {
        layerNodes.push({ x: layerX, y: marginY + nodeSpacing * (ni + 1) });
      }
      nodePositions.push(layerNodes);
    }

    // Draw connections
    var wi, si, di, srcNode, dstNode, weight, absW, alpha, lineWidth;

    for (wi = 0; wi < weights.length; wi++) {
      var w = weights[wi];
      var srcSize = prevSizes[wi];
      var dstSize = nextSizes[wi];

      for (si = 0; si < srcSize; si++) {
        for (di = 0; di < dstSize; di++) {
          weight = w[si * dstSize + di];
          absW = abs(weight);
          if (absW < 0.05) continue;

          srcNode = nodePositions[wi][si];
          dstNode = nodePositions[wi + 1][di];

          alpha = min(0.7, absW * 0.5);
          lineWidth = min(2, absW * 1.2);

          ctx.strokeStyle = weight > 0
            ? 'rgba(34, 221, 255, ' + alpha + ')'
            : 'rgba(255, 170, 50, ' + alpha + ')';
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.moveTo(srcNode.x, srcNode.y);
          ctx.lineTo(dstNode.x, dstNode.y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    var activation, nodeColor;

    for (li = 0; li < layers.length; li++) {
      var layer = layers[li];
      for (ni = 0; ni < layer.size; ni++) {
        var pos = nodePositions[li][ni];
        activation = layer.activations ? layer.activations[ni] : 0;

        if (activation > 0.01) {
          nodeColor = 'rgba(34, 221, 255, ' + (0.3 + min(1, activation) * 0.7) + ')';
        } else if (activation < -0.01) {
          nodeColor = 'rgba(255, 170, 50, ' + (0.3 + min(1, -activation) * 0.7) + ')';
        } else {
          nodeColor = 'rgba(80, 80, 100, 0.6)';
        }

        ctx.fillStyle = nodeColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, TAU);
        ctx.stroke();
      }
    }

    // Labels
    ctx.font = '6px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (ni = 0; ni < NN_INPUT_SIZE; ni++) {
      var iPos = nodePositions[0][ni];
      ctx.fillText(INPUT_LABELS[ni], iPos.x - nodeRadius - 3, iPos.y);
    }

    ctx.textAlign = 'left';
    for (ni = 0; ni < NN_OUTPUT_SIZE; ni++) {
      var oPos = nodePositions[3][ni];
      ctx.fillText(OUTPUT_LABELS[ni], oPos.x + nodeRadius + 3, oPos.y);
    }
  };

  EcoSim.Renderer = Renderer;

})();
