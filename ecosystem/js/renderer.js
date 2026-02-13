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
    'wall_l', 'wall_r', 'wall_u', 'wall_d',
    'mem_0', 'mem_1', 'mem_2', 'mem_3',
    'cr_sig'
  ];
  var OUTPUT_LABELS = ['turn', 'speed', 'eat', 'repro', 'signal'];

  function Renderer(worldCanvas, brainCanvas) {
    this.worldCanvas = worldCanvas;
    this.brainCanvas = brainCanvas;
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

    this.ctx = worldCanvas.getContext('2d');
    this.brainCtx = brainCanvas.getContext('2d');

    this.showTrails = true;
    this.showVision = false;
    this.showFamily = false;

    // Camera system — start zoomed in so creatures are visible in the large world
    this.camera = {
      x: Config.WORLD_WIDTH / 2,
      y: Config.WORLD_HEIGHT / 2,
      zoom: 2.5
    };
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    this._dashOffset = 0;

    // Ambient background particles — 3 types for bioluminescent variety
    this._ambientParticles = [];
    var i;
    // Type 0: Spores (majority) — small glowing dots
    for (i = 0; i < 105; i++) {
      var hueChoice = [190, 200, 210, 260, 170][Math.floor(Math.random() * 5)];
      this._ambientParticles.push({
        x: Math.random() * Config.WORLD_WIDTH,
        y: Math.random() * Config.WORLD_HEIGHT,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        alpha: 0.02 + Math.random() * 0.04,
        size: 1 + Math.random() * 2,
        type: 0,
        hue: hueChoice
      });
    }
    // Type 1: Drifters — larger, elongated, very faint, slow
    for (i = 0; i < 10; i++) {
      this._ambientParticles.push({
        x: Math.random() * Config.WORLD_WIDTH,
        y: Math.random() * Config.WORLD_HEIGHT,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        alpha: 0.01 + Math.random() * 0.015,
        size: 3 + Math.random() * 4,
        type: 1,
        hue: 200 + Math.random() * 40,
        angle: Math.random() * PI * 2
      });
    }
    // Type 2: Sparks — very tiny, bright, fast, rare
    for (i = 0; i < 5; i++) {
      this._ambientParticles.push({
        x: Math.random() * Config.WORLD_WIDTH,
        y: Math.random() * Config.WORLD_HEIGHT,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        alpha: 0.15 + Math.random() * 0.15,
        size: 0.5 + Math.random() * 0.8,
        type: 2,
        hue: 180 + Math.random() * 60
      });
    }

    // Background depth blobs — faint organic noise circles
    this._depthBlobs = [];
    for (i = 0; i < 30; i++) {
      this._depthBlobs.push({
        x: Math.random() * Config.WORLD_WIDTH,
        y: Math.random() * Config.WORLD_HEIGHT,
        radius: 200 + Math.random() * 400,
        hue: 180 + Math.random() * 80,
        alpha: 0.008 + Math.random() * 0.012,
        vx: (Math.random() - 0.5) * 0.05,
        vy: (Math.random() - 0.5) * 0.05
      });
    }
    this._dpr = window.devicePixelRatio || 1;

    this.brainCanvas.width = 300 * this._dpr;
    this.brainCanvas.height = 180 * this._dpr;
    this.brainCanvas.style.width = '300px';
    this.brainCanvas.style.height = '180px';
    this.brainCtx.scale(this._dpr, this._dpr);

    // Weight heatmap canvas
    this.heatmapCanvas = document.getElementById('heatmap-canvas');
    if (this.heatmapCanvas) {
      this.heatmapCtx = this.heatmapCanvas.getContext('2d');
      this.heatmapCanvas.width = 300 * this._dpr;
      this.heatmapCanvas.height = 60 * this._dpr;
      this.heatmapCanvas.style.width = '300px';
      this.heatmapCanvas.style.height = '60px';
      this.heatmapCtx.scale(this._dpr, this._dpr);
    }

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

    // Camera-aware transform
    var camera = this.camera;
    var baseScaleX = logicalWidth / world.width;
    var baseScaleY = logicalHeight / world.height;
    var baseScale = min(baseScaleX, baseScaleY);
    var finalScale = baseScale * camera.zoom;

    var offsetX = logicalWidth * 0.5 - camera.x * finalScale;
    var offsetY = logicalHeight * 0.5 - camera.y * finalScale;

    // Store for screenToWorld calculations
    this._scale = finalScale;
    this._offsetX = offsetX;
    this._offsetY = offsetY;

    // Deep-sea gradient background with day/night modulation
    var dayPhase = world.getDayNightPhase ? world.getDayNightPhase() : 0.5;
    var bgBase = 6 + Math.round(dayPhase * 6);
    var bgGrad = ctx.createRadialGradient(
      logicalWidth * 0.5, logicalHeight * 0.5, 0,
      logicalWidth * 0.5, logicalHeight * 0.5, Math.max(logicalWidth, logicalHeight) * 0.7
    );
    bgGrad.addColorStop(0, 'rgb(' + (bgBase + 4) + ',' + (bgBase + 8) + ',' + (bgBase + 18) + ')');
    bgGrad.addColorStop(1, 'rgb(' + bgBase + ',' + (bgBase + 2) + ',' + (bgBase + 8) + ')');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(finalScale, finalScale);

    // Compute view bounds once per frame for viewport culling
    // Only cull when zoomed in (at zoom <= 1.0, everything is visible)
    var bounds = camera.zoom > 1.0 ? this.getViewBounds() : null;

    this.drawGrid(ctx, world.width, world.height, bounds);
    this.drawWorldBorder(ctx, world.width, world.height);
    this.drawZones(ctx, world.zones);
    this.drawAmbientParticles(ctx, world.width, world.height);
    this.drawFood(ctx, world.food, bounds);

    // World events — draw before creatures so they appear as environmental effects
    if (world.activeEvents && world.activeEvents.length > 0) {
      this.drawWorldEvents(ctx, world.activeEvents, world.tick);
    }

    this.drawDyingCreatures(ctx, world.dyingCreatures);

    if (this.showTrails) {
      this.drawCreatureTrails(ctx, world.creatures, bounds);
    }

    this.drawCreatures(ctx, world.creatures, world.tick, bounds);
    this.drawParticles(ctx, world.particles, bounds);

    if (world.selectedCreature && world.selectedCreature.alive) {
      this.drawSelection(ctx, world.selectedCreature, world.tick);
    }

    if (this.showVision && world.selectedCreature && world.selectedCreature.alive) {
      this.drawVisionRange(ctx, world.selectedCreature);
    }

    if (this.showFamily && world.selectedCreature && world.selectedCreature.alive) {
      this.drawFamilyConnections(ctx, world, world.selectedCreature);
    }

    ctx.restore();

    this.renderMinimap(world);
  };

  Renderer.prototype.renderMinimap = function (world) {
    var ctx = this.minimapCtx;
    if (!ctx) return;

    var mw = 160;
    var mh = 90;
    var sx = mw / world.width;
    var sy = mh / world.height;

    ctx.clearRect(0, 0, mw, mh);
    ctx.fillStyle = 'rgba(10, 14, 23, 0.9)';
    ctx.fillRect(0, 0, mw, mh);

    // Draw zones as faint circles
    var i, z;
    for (i = 0; i < world.zones.length; i++) {
      z = world.zones[i];
      ctx.fillStyle = 'rgba(80, 200, 80, 0.15)';
      ctx.beginPath();
      ctx.arc(z.x * sx, z.y * sy, z.radius * sx, 0, TAU);
      ctx.fill();
    }

    // Draw food as tiny green/red dots
    var f;
    for (i = 0; i < world.food.length; i++) {
      f = world.food[i];
      ctx.fillStyle = f.type === 'meat' ? 'rgba(255, 80, 60, 0.5)' : 'rgba(124, 255, 107, 0.4)';
      ctx.fillRect(f.x * sx, f.y * sy, 1, 1);
    }

    // Draw creatures as colored dots
    var c;
    for (i = 0; i < world.creatures.length; i++) {
      c = world.creatures[i];
      ctx.fillStyle = 'hsla(' + round(c.bodyGenes.hue) + ', 70%, 60%, 0.8)';
      ctx.beginPath();
      ctx.arc(c.x * sx, c.y * sy, max(1, c.size * sx * 0.5), 0, TAU);
      ctx.fill();
    }

    // Draw selected creature marker
    if (world.selectedCreature && world.selectedCreature.alive) {
      var sc = world.selectedCreature;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sc.x * sx, sc.y * sy, 4, 0, TAU);
      ctx.stroke();
    }

    // Draw camera viewport rectangle (only when zoomed in)
    var camera = this.camera;
    if (camera.zoom > 1.05) {
      var canvas = this.worldCanvas;
      var dpr = this._dpr;
      var lw = canvas.width / dpr;
      var lh = canvas.height / dpr;
      var vpW = lw / this._scale;
      var vpH = lh / this._scale;
      var vpX = (camera.x - vpW * 0.5) * sx;
      var vpY = (camera.y - vpH * 0.5) * sy;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vpX, vpY, vpW * sx, vpH * sy);
    }
  };

  Renderer.prototype.drawGrid = function (ctx, width, height, bounds) {
    // Organic dot grid — faint dots at intersections instead of lines
    var step = 50;
    var x, y;
    var x0, x1, y0, y1;

    if (bounds) {
      x0 = max(0, Math.floor(bounds.left / step) * step);
      x1 = min(width, Math.ceil(bounds.right / step) * step);
      y0 = max(0, Math.floor(bounds.top / step) * step);
      y1 = min(height, Math.ceil(bounds.bottom / step) * step);
    } else {
      x0 = 0; x1 = width;
      y0 = 0; y1 = height;
    }

    ctx.fillStyle = 'rgba(100, 180, 255, 0.05)';
    for (x = x0; x <= x1; x += step) {
      for (y = y0; y <= y1; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, TAU);
        ctx.fill();
      }
    }
  };

  Renderer.prototype.drawWorldBorder = function (ctx, width, height) {
    // Organic membrane edge — wobbly glowing border
    var tick = this._borderTick || 0;
    this._borderTick = tick + 1;
    var pulseAlpha = 0.15 + 0.1 * sin(tick * 0.03);
    var segments = 60;
    var i, t, wx, wy;

    // Inner glow gradient along edges
    var edgeGrad;
    var glowSize = 40;

    // Top edge glow
    edgeGrad = ctx.createLinearGradient(0, 0, 0, glowSize);
    edgeGrad.addColorStop(0, 'rgba(0, 229, 200, ' + (pulseAlpha * 0.3) + ')');
    edgeGrad.addColorStop(1, 'rgba(0, 229, 200, 0)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, width, glowSize);

    // Bottom edge glow
    edgeGrad = ctx.createLinearGradient(0, height, 0, height - glowSize);
    edgeGrad.addColorStop(0, 'rgba(0, 229, 200, ' + (pulseAlpha * 0.3) + ')');
    edgeGrad.addColorStop(1, 'rgba(0, 229, 200, 0)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, height - glowSize, width, glowSize);

    // Left edge glow
    edgeGrad = ctx.createLinearGradient(0, 0, glowSize, 0);
    edgeGrad.addColorStop(0, 'rgba(0, 229, 200, ' + (pulseAlpha * 0.3) + ')');
    edgeGrad.addColorStop(1, 'rgba(0, 229, 200, 0)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, glowSize, height);

    // Right edge glow
    edgeGrad = ctx.createLinearGradient(width, 0, width - glowSize, 0);
    edgeGrad.addColorStop(0, 'rgba(0, 229, 200, ' + (pulseAlpha * 0.3) + ')');
    edgeGrad.addColorStop(1, 'rgba(0, 229, 200, 0)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(width - glowSize, 0, glowSize, height);

    // Wobbly membrane outline
    ctx.strokeStyle = 'rgba(0, 229, 200, ' + pulseAlpha + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Top edge
    ctx.moveTo(0, 0);
    for (i = 1; i <= segments; i++) {
      t = i / segments;
      wx = t * width;
      wy = sin(t * 12 + tick * 0.04) * 2;
      ctx.lineTo(wx, wy);
    }
    // Right edge
    for (i = 1; i <= segments; i++) {
      t = i / segments;
      wx = width + sin(t * 12 + tick * 0.04 + 1) * 2;
      wy = t * height;
      ctx.lineTo(wx, wy);
    }
    // Bottom edge
    for (i = segments; i >= 0; i--) {
      t = i / segments;
      wx = t * width;
      wy = height + sin(t * 12 + tick * 0.04 + 2) * 2;
      ctx.lineTo(wx, wy);
    }
    // Left edge
    for (i = segments; i >= 0; i--) {
      t = i / segments;
      wx = sin(t * 12 + tick * 0.04 + 3) * 2;
      wy = t * height;
      ctx.lineTo(wx, wy);
    }
    ctx.closePath();
    ctx.stroke();
  };

  Renderer.prototype.drawZones = function (ctx, zones) {
    if (!zones) return;
    var i, z, grad, tick;
    tick = this._borderTick || 0;

    // Zone color palette: teal, cyan, soft violet
    var zoneColors = [
      { r: 0, g: 229, b: 200 },   // teal
      { r: 0, g: 200, b: 255 },   // cyan
      { r: 140, g: 100, b: 255 }  // violet
    ];

    for (i = 0; i < zones.length; i++) {
      z = zones[i];
      var zc = zoneColors[i % zoneColors.length];
      var pulse = 0.8 + 0.2 * sin(tick * 0.02 + i * 2);

      // Multi-stop nebula gradient
      grad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
      grad.addColorStop(0, 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',' + (0.08 * pulse) + ')');
      grad.addColorStop(0.3, 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',' + (0.05 * pulse) + ')');
      grad.addColorStop(0.7, 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',' + (0.02 * pulse) + ')');
      grad.addColorStop(1, 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.fill();

      // Orbiting spore particles within zone
      var j, sporeAngle, sporeDist, sx, sy;
      for (j = 0; j < 4; j++) {
        sporeAngle = tick * 0.008 * (j % 2 === 0 ? 1 : -1) + j * PI * 0.5 + i;
        sporeDist = z.radius * (0.3 + 0.3 * sin(tick * 0.01 + j));
        sx = z.x + cos(sporeAngle) * sporeDist;
        sy = z.y + sin(sporeAngle) * sporeDist;
        ctx.fillStyle = 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',' + (0.2 * pulse) + ')';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, TAU);
        ctx.fill();
      }

      // Subtle pulsing border
      ctx.strokeStyle = 'rgba(' + zc.r + ',' + zc.g + ',' + zc.b + ',' + (0.06 * pulse) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.stroke();
    }
  };

  Renderer.prototype.drawAmbientParticles = function (ctx, worldW, worldH) {
    var particles = this._ambientParticles;
    var blobs = this._depthBlobs;
    var i, p, b;
    var tick = this._borderTick || 0;

    // Draw depth blobs (faint organic noise)
    for (i = 0; i < blobs.length; i++) {
      b = blobs[i];
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -b.radius) b.x += worldW + b.radius * 2;
      if (b.x > worldW + b.radius) b.x -= worldW + b.radius * 2;
      if (b.y < -b.radius) b.y += worldH + b.radius * 2;
      if (b.y > worldH + b.radius) b.y -= worldH + b.radius * 2;

      var bGrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
      bGrad.addColorStop(0, 'hsla(' + round(b.hue) + ', 60%, 30%, ' + b.alpha + ')');
      bGrad.addColorStop(1, 'hsla(' + round(b.hue) + ', 60%, 30%, 0)');
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, TAU);
      ctx.fill();
    }

    // Draw particles by type
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x += worldW;
      if (p.x > worldW) p.x -= worldW;
      if (p.y < 0) p.y += worldH;
      if (p.y > worldH) p.y -= worldH;

      if (p.type === 0) {
        // Spores — small dots with glow halo
        var sporeGlow = p.alpha * (0.8 + 0.2 * sin(tick * 0.05 + i));
        ctx.fillStyle = 'hsla(' + round(p.hue) + ', 70%, 65%, ' + sporeGlow + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        // Tiny glow halo
        ctx.fillStyle = 'hsla(' + round(p.hue) + ', 70%, 65%, ' + (sporeGlow * 0.3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.5, 0, TAU);
        ctx.fill();
      } else if (p.type === 1) {
        // Drifters — elongated faint ovals
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(2.2, 1);
        ctx.fillStyle = 'hsla(' + round(p.hue) + ', 50%, 50%, ' + p.alpha + ')';
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        // Sparks — very small, bright
        var sparkPulse = p.alpha * (0.7 + 0.3 * sin(tick * 0.15 + i * 3));
        ctx.fillStyle = 'hsla(' + round(p.hue) + ', 80%, 80%, ' + sparkPulse + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
  };

  Renderer.prototype.drawFood = function (ctx, food, bounds) {
    var i, f, pulse, glowRadius, grad, isMeat;
    var spawnFade, j, tAngle, tLen, tx, ty;
    var tick = this._borderTick || 0;

    for (i = 0; i < food.length; i++) {
      f = food[i];
      if (bounds && (f.x < bounds.left || f.x > bounds.right ||
          f.y < bounds.top || f.y > bounds.bottom)) continue;
      isMeat = f.type === 'meat';
      pulse = 0.7 + 0.3 * sin(f.age * 0.05 + i);
      spawnFade = min(1, f.age / 10);
      glowRadius = (f.size + 6) * pulse;

      if (isMeat) {
        // Organic red matter — irregular overlapping circles
        grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowRadius);
        grad.addColorStop(0, 'rgba(255, 80, 60, ' + (0.3 * f.glow * pulse * spawnFade) + ')');
        grad.addColorStop(0.6, 'rgba(255, 50, 40, ' + (0.1 * f.glow * pulse * spawnFade) + ')');
        grad.addColorStop(1, 'rgba(255, 50, 40, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, glowRadius, 0, TAU);
        ctx.fill();

        // Irregular blob shape (3-4 overlapping circles)
        ctx.globalAlpha = spawnFade * 0.8;
        ctx.fillStyle = '#ff5040';
        for (j = 0; j < 3; j++) {
          var bAngle = j * TAU / 3 + f.id * 0.5;
          var bOff = f.size * 0.3;
          ctx.beginPath();
          ctx.arc(f.x + cos(bAngle) * bOff, f.y + sin(bAngle) * bOff, f.size * (0.7 + j * 0.1), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        // Plant spore — bright dot with radiating tendrils
        grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowRadius);
        grad.addColorStop(0, 'rgba(124, 255, 107, ' + (0.4 * f.glow * pulse * spawnFade) + ')');
        grad.addColorStop(0.4, 'rgba(0, 229, 200, ' + (0.15 * f.glow * pulse * spawnFade) + ')');
        grad.addColorStop(1, 'rgba(0, 229, 200, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, glowRadius, 0, TAU);
        ctx.fill();

        // Central bright dot
        ctx.globalAlpha = spawnFade;
        ctx.fillStyle = '#7cff6b';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, TAU);
        ctx.fill();

        // 3 short radiating tendrils
        ctx.strokeStyle = 'rgba(124, 255, 107, ' + (0.35 * spawnFade) + ')';
        ctx.lineWidth = 0.6;
        for (j = 0; j < 3; j++) {
          tAngle = j * TAU / 3 + sin(tick * 0.04 + i + j) * 0.3;
          tLen = f.size * 2.5;
          tx = f.x + cos(tAngle) * tLen;
          ty = f.y + sin(tAngle) * tLen;
          ctx.beginPath();
          ctx.moveTo(f.x + cos(tAngle) * f.size, f.y + sin(tAngle) * f.size);
          ctx.quadraticCurveTo(
            f.x + cos(tAngle + 0.3) * tLen * 0.6,
            f.y + sin(tAngle + 0.3) * tLen * 0.6,
            tx, ty
          );
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  };

  Renderer.prototype.drawDyingCreatures = function (ctx, dying) {
    if (!dying) return;
    var i, d, progress, alpha, sz, j, pAngle, pDist;

    for (i = 0; i < dying.length; i++) {
      d = dying[i];
      progress = 1 - (d.ticksLeft / 20);
      alpha = (1 - progress) * 0.7;
      sz = d.size * (1 + progress * 0.8); // expand outward (membrane dissolves)

      if (alpha <= 0) continue;

      // Flash bright at start, then dim
      var flashAlpha = progress < 0.15 ? (1 - progress / 0.15) * 0.6 : 0;

      // Core flash (bright on death)
      if (flashAlpha > 0) {
        var flashGrad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, sz * 0.6);
        flashGrad.addColorStop(0, 'hsla(' + round(d.hue) + ', 90%, 85%, ' + flashAlpha + ')');
        flashGrad.addColorStop(1, 'hsla(' + round(d.hue) + ', 90%, 85%, 0)');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(d.x, d.y, sz * 0.6, 0, TAU);
        ctx.fill();
      }

      // Dissolving membrane (expanding + fading)
      ctx.globalAlpha = alpha * 0.4;
      var memGrad = ctx.createRadialGradient(d.x, d.y, sz * 0.3, d.x, d.y, sz);
      memGrad.addColorStop(0, 'hsla(' + round(d.hue) + ', ' + round(d.saturation) + '%, 50%, 0.3)');
      memGrad.addColorStop(1, 'hsla(' + round(d.hue) + ', ' + round(d.saturation) + '%, 50%, 0)');
      ctx.fillStyle = memGrad;
      ctx.beginPath();
      ctx.arc(d.x, d.y, sz, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Luminous particles drifting outward (8-12)
      var particleCount = 8 + round(d.size * 0.3);
      for (j = 0; j < particleCount; j++) {
        pAngle = j * TAU / particleCount + d.hue * 0.01;
        pDist = d.size * 0.5 + progress * d.size * 2.5 * (0.7 + 0.3 * sin(j * 2.3));
        var px = d.x + cos(pAngle) * pDist;
        var py = d.y + sin(pAngle) * pDist;
        var pAlpha = (1 - progress) * 0.5;
        var pSize = (1 - progress * 0.7) * 1.5;
        if (pSize > 0 && pAlpha > 0) {
          ctx.fillStyle = 'hsla(' + round(d.hue) + ', ' + round(d.saturation) + '%, 65%, ' + pAlpha + ')';
          ctx.beginPath();
          ctx.arc(px, py, pSize, 0, TAU);
          ctx.fill();
        }
      }
    }
  };

  Renderer.prototype.drawCreatureTrails = function (ctx, creatures, bounds) {
    var i, creature, trail, j, alpha, tp, k;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      if (bounds && (creature.x < bounds.left || creature.x > bounds.right ||
          creature.y < bounds.top || creature.y > bounds.bottom)) continue;
      trail = creature.trailPositions;
      if (!trail || trail.length < 2) continue;

      var color = creature.bodyGenes.hue;
      var sat = creature.bodyGenes.saturation;

      // Ethereal particle trail — glowing dots instead of lines
      for (j = 0; j < trail.length; j++) {
        tp = trail[j];
        alpha = (j / trail.length) * 0.12;
        var dotSize = (j / trail.length) * max(1, creature.size * 0.2);

        // 1-2 particles per trail point with slight random offset
        for (k = 0; k < 2; k++) {
          var ox = sin(j * 3.7 + k * 5.1 + creature.id) * 1.5;
          var oy = cos(j * 2.3 + k * 4.3 + creature.id) * 1.5;
          ctx.fillStyle = 'hsla(' + round(color) + ', ' + round(sat) + '%, 55%, ' + alpha + ')';
          ctx.beginPath();
          ctx.arc(tp.x + ox, tp.y + oy, max(0.3, dotSize), 0, TAU);
          ctx.fill();
        }
      }
    }
  };

  Renderer.prototype.drawCreatures = function (ctx, creatures, tick, bounds) {
    var i, creature, cx, cy, r, angle, grad;
    var j, spotAngle, spotDist, spotX, spotY;
    var tSeed, tAngle, tBaseAngle, tLen, tWave, tx1, ty1, tx2, ty2;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      if (!creature.alive) continue;

      cx = creature.x;
      cy = creature.y;

      if (bounds && (cx < bounds.left || cx > bounds.right ||
          cy < bounds.top || cy > bounds.bottom)) continue;
      r = creature.size;
      angle = creature.angle;

      var dirX = cos(angle);
      var dirY = sin(angle);
      var lum = creature.bodyGenes.luminosity !== undefined ? creature.bodyGenes.luminosity : 0.7;
      var energyRatio = min(1, max(0, creature.energy / Config.CREATURE_MAX_ENERGY));
      var hue = creature.bodyGenes.hue;
      var sat = creature.bodyGenes.saturation;
      var aggression = creature.bodyGenes.aggression;

      // --- 1. Tendrils (drawn behind body) ---
      var tCount = creature.tendrilCount || 2;
      var tSeeds = creature.tendrilSeeds || [0, PI * 0.5, PI, PI * 1.5];
      var tendrilBaseLen = r * Config.CREATURE_TENDRIL_LENGTH * (0.5 + creature.speed * 0.3);
      ctx.lineWidth = max(0.4, r * 0.08);

      for (j = 0; j < tCount; j++) {
        tSeed = tSeeds[j];
        tBaseAngle = angle + PI + (j - (tCount - 1) * 0.5) * 0.5; // spread behind
        tLen = tendrilBaseLen * (0.7 + 0.3 * sin(tSeed + j));
        tWave = sin(tick * 0.1 + tSeed + j * 1.7) * r * 0.4;

        var tStartX = cx - dirX * r * 0.7 + cos(tBaseAngle) * r * 0.2;
        var tStartY = cy - dirY * r * 0.7 + sin(tBaseAngle) * r * 0.2;
        tx1 = tStartX + cos(tBaseAngle + 0.3) * tLen * 0.5 + cos(tBaseAngle + PI * 0.5) * tWave;
        ty1 = tStartY + sin(tBaseAngle + 0.3) * tLen * 0.5 + sin(tBaseAngle + PI * 0.5) * tWave;
        tx2 = tStartX + cos(tBaseAngle) * tLen;
        ty2 = tStartY + sin(tBaseAngle) * tLen;

        var tAlpha = 0.25 * lum * energyRatio;
        ctx.strokeStyle = 'hsla(' + round(hue) + ', ' + round(sat) + '%, 55%, ' + tAlpha + ')';
        ctx.beginPath();
        ctx.moveTo(tStartX, tStartY);
        ctx.quadraticCurveTo(tx1, ty1, tx2, ty2);
        ctx.stroke();
      }

      // --- 2. Outer membrane (semi-transparent elliptical body) ---
      var memWobble = sin(tick * 0.08 + creature.id * 0.7) * r * 0.04;
      var memAlpha = Config.CREATURE_MEMBRANE_ALPHA + lum * 0.1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(1.1, 0.95 + memWobble / r); // slightly elongated in movement direction
      ctx.fillStyle = creature.getMembraneColor(memAlpha);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.restore();

      // --- 3. Aggression aura (spiky membrane distortion + red glow) ---
      if (aggression > 0.6) {
        var aggrIntensity = (aggression - 0.6) * 2.5; // 0 to 1
        // Red-shifted secondary glow
        var aggrGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.3);
        aggrGrad.addColorStop(0, 'rgba(255, 40, 20, ' + (0.08 * aggrIntensity) + ')');
        aggrGrad.addColorStop(1, 'rgba(255, 40, 20, 0)');
        ctx.fillStyle = aggrGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.3, 0, TAU);
        ctx.fill();

        // Spiky membrane distortion
        if (aggrIntensity > 0.3) {
          ctx.strokeStyle = 'rgba(255, 60, 30, ' + (0.15 * aggrIntensity) + ')';
          ctx.lineWidth = 0.8;
          var spikes = 6 + round(aggrIntensity * 4);
          ctx.beginPath();
          for (j = 0; j < spikes; j++) {
            var spikeAngle = j * TAU / spikes + tick * 0.02;
            var spikeR = r * (1 + aggrIntensity * 0.3 * (j % 2 === 0 ? 1 : 0.5));
            if (j === 0) {
              ctx.moveTo(cx + cos(spikeAngle) * spikeR, cy + sin(spikeAngle) * spikeR);
            } else {
              ctx.lineTo(cx + cos(spikeAngle) * spikeR, cy + sin(spikeAngle) * spikeR);
            }
          }
          ctx.closePath();
          ctx.stroke();
        }
      }

      // --- 4. Inner core glow (radial gradient, pulsing) ---
      var corePulse = 0.7 + 0.3 * sin(tick * 0.06 + creature.id);
      var coreAlpha = Config.CREATURE_GLOW_INTENSITY * lum * energyRatio * corePulse;
      var coreOffX = dirX * r * 0.15; // slightly forward
      var coreOffY = dirY * r * 0.15;
      var coreGrad = ctx.createRadialGradient(
        cx + coreOffX, cy + coreOffY, 0,
        cx + coreOffX, cy + coreOffY, r * 0.8
      );
      coreGrad.addColorStop(0, creature.getGlowColor(coreAlpha));
      coreGrad.addColorStop(0.5, creature.getGlowColor(coreAlpha * 0.4));
      coreGrad.addColorStop(1, creature.getGlowColor(0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // --- 5. Bioluminescent spots (3-5 glowing dots on membrane) ---
      var spots = creature.spotSeeds || [];
      var spotCount = min(spots.length, r < 6 ? 2 : (r < 10 ? 3 : 5));
      for (j = 0; j < spotCount; j++) {
        spotAngle = spots[j] + angle; // rotate with creature
        spotDist = r * (0.5 + 0.3 * sin(spots[j] * 3));
        spotX = cx + cos(spotAngle) * spotDist;
        spotY = cy + sin(spotAngle) * spotDist;
        var spotPulse = 0.5 + 0.5 * sin(tick * (0.05 + j * 0.01) + spots[j] * 5);
        var spotAlpha = 0.3 + 0.4 * spotPulse * lum;
        ctx.fillStyle = 'hsla(' + round(hue) + ', ' + round(min(100, sat + 15)) + '%, 75%, ' + spotAlpha + ')';
        ctx.beginPath();
        ctx.arc(spotX, spotY, max(0.5, r * 0.1), 0, TAU);
        ctx.fill();
      }

      // --- 6. Reproduction glow (heartbeat pulse rings) ---
      if (creature.energy > REPRODUCTION_THRESHOLD) {
        var reproPhase = (tick + creature.id * 7) % 30;
        var reproGlowAlpha = 0.12 + 0.08 * sin(tick * 0.1);
        // Constant outer glow
        ctx.strokeStyle = 'rgba(100, 255, 220, ' + reproGlowAlpha + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3 + sin(tick * 0.08) * 1.5, 0, TAU);
        ctx.stroke();
        // Heartbeat pulse ring (expanding circle every ~30 ticks)
        if (reproPhase < 15) {
          var ringProgress = reproPhase / 15;
          var ringAlpha = (1 - ringProgress) * 0.25;
          var ringRadius = r + 2 + ringProgress * r * 0.8;
          ctx.strokeStyle = 'rgba(100, 255, 220, ' + ringAlpha + ')';
          ctx.lineWidth = max(0.3, 1.5 * (1 - ringProgress));
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, TAU);
          ctx.stroke();
        }
      }

      // --- 7. Signal visualization (bioluminescent pulse waves) ---
      if (creature.signal && abs(creature.signal) > 0.3) {
        var sigVal = creature.signal;
        var sigStr = abs(sigVal) - 0.3;
        var sigColor = sigVal > 0 ? '255, 210, 60' : '180, 100, 255'; // warm gold / cool violet
        // 2-3 concentric expanding rings
        var sigRings = 2 + (sigStr > 0.4 ? 1 : 0);
        for (j = 0; j < sigRings; j++) {
          var sigPhase = ((tick * 0.06 + j * 0.4 + creature.id * 0.1) % 1);
          var sigRadius = r + 4 + sigPhase * r * 1.5;
          var sigAlpha = (1 - sigPhase) * sigStr * 0.4;
          ctx.strokeStyle = 'rgba(' + sigColor + ', ' + sigAlpha + ')';
          ctx.lineWidth = max(0.3, 1.2 * (1 - sigPhase));
          ctx.beginPath();
          ctx.arc(cx, cy, sigRadius, 0, TAU);
          ctx.stroke();
        }
      }

      // --- 8. Action indicators ---
      if (creature.lastAction === 'eating') {
        // Inner core flash green
        var eatGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.8);
        eatGrad.addColorStop(0, 'rgba(100, 255, 150, 0.35)');
        eatGrad.addColorStop(1, 'rgba(100, 255, 150, 0)');
        ctx.fillStyle = eatGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.8, 0, TAU);
        ctx.fill();
      } else if (creature.lastAction === 'attacking') {
        // Membrane flare with red energy
        var atkGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.5);
        atkGrad.addColorStop(0, 'rgba(255, 60, 30, 0.2)');
        atkGrad.addColorStop(0.6, 'rgba(255, 60, 30, 0.08)');
        atkGrad.addColorStop(1, 'rgba(255, 60, 30, 0)');
        ctx.fillStyle = atkGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.5, 0, TAU);
        ctx.fill();
        // Brief red energy tendrils extending forward
        ctx.strokeStyle = 'rgba(255, 60, 30, 0.4)';
        ctx.lineWidth = 1;
        for (j = 0; j < 3; j++) {
          var atkAngle = angle + (j - 1) * 0.4;
          ctx.beginPath();
          ctx.moveTo(cx + cos(atkAngle) * r, cy + sin(atkAngle) * r);
          ctx.lineTo(cx + cos(atkAngle) * r * 2, cy + sin(atkAngle) * r * 2);
          ctx.stroke();
        }
      }
    }
  };

  Renderer.prototype.drawParticles = function (ctx, particles, bounds) {
    var i, p, progress, alpha, radius, j;

    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      if (bounds && (p.x < bounds.left || p.x > bounds.right ||
          p.y < bounds.top || p.y > bounds.bottom)) continue;
      progress = p.age / p.maxAge;
      alpha = 1 - progress;
      if (alpha <= 0) continue;

      switch (p.type) {
        case 'eat':
          // Burst of tiny green-teal luminous sparks
          var sparkCount = 5;
          for (j = 0; j < sparkCount; j++) {
            var sAngle = j * TAU / sparkCount + p.age * 0.2;
            var sDist = p.size * (1 + progress * 4);
            var sx = p.x + cos(sAngle) * sDist;
            var sy = p.y + sin(sAngle) * sDist;
            var sSize = max(0.3, p.size * 0.4 * (1 - progress));
            ctx.fillStyle = 'rgba(80, 255, 180, ' + (alpha * 0.6) + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, sSize, 0, TAU);
            ctx.fill();
          }
          // Central glow
          var eatGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
          eatGrad.addColorStop(0, 'rgba(100, 255, 150, ' + (alpha * 0.3) + ')');
          eatGrad.addColorStop(1, 'rgba(100, 255, 150, 0)');
          ctx.fillStyle = eatGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2, 0, TAU);
          ctx.fill();
          break;

        case 'attack':
          // Orange-red energy flash with lightning lines
          var atkGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (2 + progress * 3));
          atkGrad.addColorStop(0, 'rgba(255, 100, 30, ' + (alpha * 0.4) + ')');
          atkGrad.addColorStop(1, 'rgba(255, 60, 20, 0)');
          ctx.fillStyle = atkGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (2 + progress * 3), 0, TAU);
          ctx.fill();
          // Lightning bolt lines
          ctx.strokeStyle = 'rgba(255, 180, 60, ' + (alpha * 0.5) + ')';
          ctx.lineWidth = 0.8;
          for (j = 0; j < 3; j++) {
            var lAngle = j * TAU / 3 + p.age * 0.3;
            var lLen = p.size * (1 + progress * 3);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(
              p.x + cos(lAngle) * lLen * 0.5 + sin(j * 2 + p.age) * 2,
              p.y + sin(lAngle) * lLen * 0.5 + cos(j * 3 + p.age) * 2
            );
            ctx.lineTo(
              p.x + cos(lAngle) * lLen,
              p.y + sin(lAngle) * lLen
            );
            ctx.stroke();
          }
          break;

        case 'ring':
          // Double-ring with inner glow (reproduction)
          radius = 3 + progress * 25;
          var ringWidth = max(0.3, 2 * (1 - progress));
          // Outer ring
          ctx.strokeStyle = 'rgba(0, 229, 200, ' + (alpha * 0.5) + ')';
          ctx.lineWidth = ringWidth;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.stroke();
          // Inner ring
          ctx.strokeStyle = 'rgba(100, 255, 220, ' + (alpha * 0.3) + ')';
          ctx.lineWidth = ringWidth * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.7, 0, TAU);
          ctx.stroke();
          // Inner glow fill
          var ringGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
          ringGrad.addColorStop(0, 'rgba(100, 255, 220, ' + (alpha * 0.08) + ')');
          ringGrad.addColorStop(1, 'rgba(100, 255, 220, 0)');
          ctx.fillStyle = ringGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, TAU);
          ctx.fill();
          break;

        case 'die':
          // Burst of creature-colored luminous particles drifting outward
          var dieCount = 6;
          for (j = 0; j < dieCount; j++) {
            var dAngle = j * TAU / dieCount + i * 0.5;
            var dDist = p.size * (0.5 + progress * 3);
            var dx = p.x + cos(dAngle) * dDist;
            var dy = p.y + sin(dAngle) * dDist;
            var dSize = max(0.3, p.size * 0.5 * (1 - progress));
            ctx.fillStyle = 'rgba(255, 80, 80, ' + (alpha * 0.4) + ')';
            ctx.beginPath();
            ctx.arc(dx, dy, dSize, 0, TAU);
            ctx.fill();
          }
          // Fading central glow
          var dieGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 1.5);
          dieGrad.addColorStop(0, 'rgba(255, 60, 60, ' + (alpha * 0.2) + ')');
          dieGrad.addColorStop(1, 'rgba(255, 60, 60, 0)');
          ctx.fillStyle = dieGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 1.5, 0, TAU);
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

  // ---------------------------------------------------------------
  // renderWeightHeatmap(world) — colored grid of NN weight matrices
  // ---------------------------------------------------------------
  Renderer.prototype.renderWeightHeatmap = function (world) {
    var ctx = this.heatmapCtx;
    if (!ctx) return;

    var cw = 300;
    var ch = 60;

    ctx.clearRect(0, 0, cw, ch);

    var creature = world.selectedCreature;
    if (!creature || !creature.alive || !creature.brain) return;

    var brain = creature.brain;

    // Weight matrix descriptors: label, data, rows, cols
    var matrices = [
      { label: 'W1', data: brain.weights1, rows: NN_INPUT_SIZE,   cols: NN_HIDDEN1_SIZE },
      { label: 'W2', data: brain.weights2, rows: NN_HIDDEN1_SIZE, cols: NN_HIDDEN2_SIZE },
      { label: 'W3', data: brain.weights3, rows: NN_HIDDEN2_SIZE, cols: NN_OUTPUT_SIZE }
    ];

    // Layout: 3 matrices side-by-side with gaps
    var labelHeight = 10;
    var padding = 4;
    var gapBetween = 6;
    var totalGaps = gapBetween * (matrices.length - 1);

    var availableWidth = cw - padding * 2 - totalGaps;
    var availableHeight = ch - padding - labelHeight;

    // Each matrix gets width proportional to its column count
    var totalCols = 0;
    var mi;
    for (mi = 0; mi < matrices.length; mi++) {
      totalCols += matrices[mi].cols;
    }

    // Max cell size constrained by width
    var maxCellW = availableWidth / totalCols;

    // Max cell size constrained by height (tallest matrix)
    var maxRows = 0;
    for (mi = 0; mi < matrices.length; mi++) {
      if (matrices[mi].rows > maxRows) maxRows = matrices[mi].rows;
    }
    var maxCellH = availableHeight / maxRows;

    // Use the smaller constraint; floor to avoid sub-pixel gaps
    var cellSize = min(maxCellW, maxCellH);
    cellSize = max(1, Math.floor(cellSize * 10) / 10);

    // Draw each matrix
    var curX = padding;
    var mat, row, col, weight, intensity, r, g, b;

    for (mi = 0; mi < matrices.length; mi++) {
      mat = matrices[mi];
      var matWidth = mat.cols * cellSize;
      var matHeight = mat.rows * cellSize;

      // Center matrix vertically in available space
      var matY = labelHeight + (availableHeight - matHeight) * 0.5;

      // Draw label above matrix
      ctx.font = '7px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(mat.label, curX + matWidth * 0.5, matY - 1);

      // Draw weight cells
      for (row = 0; row < mat.rows; row++) {
        for (col = 0; col < mat.cols; col++) {
          weight = mat.data[row * mat.cols + col];
          intensity = min(1, abs(weight) / 2.0);

          if (weight >= 0) {
            // Cyan: rgb(0, 212*i, 255*i)
            r = 0;
            g = round(212 * intensity);
            b = round(255 * intensity);
          } else {
            // Orange: rgb(255*i, 170*i, 50*i)
            r = round(255 * intensity);
            g = round(170 * intensity);
            b = round(50 * intensity);
          }

          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(
            curX + col * cellSize,
            matY + row * cellSize,
            cellSize,
            cellSize
          );
        }
      }

      // Draw subtle grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 0.5;

      // Vertical grid lines
      for (col = 0; col <= mat.cols; col++) {
        ctx.beginPath();
        ctx.moveTo(curX + col * cellSize, matY);
        ctx.lineTo(curX + col * cellSize, matY + matHeight);
        ctx.stroke();
      }
      // Horizontal grid lines
      for (row = 0; row <= mat.rows; row++) {
        ctx.beginPath();
        ctx.moveTo(curX, matY + row * cellSize);
        ctx.lineTo(curX + matWidth, matY + row * cellSize);
        ctx.stroke();
      }

      curX += matWidth + gapBetween;
    }
  };

  // ---------------------------------------------------------------
  // drawFamilyConnections(ctx, world, creature) — draw lines to family
  // ---------------------------------------------------------------
  Renderer.prototype.drawFamilyConnections = function (ctx, world, creature) {
    var cx = creature.x;
    var cy = creature.y;
    var i, child, childIds, parent;

    ctx.save();

    // Draw lines to living children
    childIds = creature.childIds || [];
    for (i = 0; i < childIds.length; i++) {
      child = world.getCreatureById(childIds[i]);
      if (!child || !child.alive) continue;

      // Gradient line from parent to child
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(child.x, child.y);
      ctx.stroke();

      // Highlight ring on child
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(child.x, child.y, child.size + 5, 0, TAU);
      ctx.stroke();
    }

    // Draw line to parent if alive
    if (creature.parentId) {
      parent = world.getCreatureById(creature.parentId);
      if (parent && parent.alive) {
        ctx.strokeStyle = 'rgba(255, 107, 53, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(parent.x, parent.y);
        ctx.stroke();

        // Highlight ring on parent
        ctx.strokeStyle = 'rgba(255, 107, 53, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(parent.x, parent.y, parent.size + 5, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  };

  // ---------------------------------------------------------------
  // screenToWorld(sx, sy) — convert screen/canvas coords to world coords
  // ---------------------------------------------------------------
  Renderer.prototype.screenToWorld = function (sx, sy) {
    return {
      x: (sx - this._offsetX) / this._scale,
      y: (sy - this._offsetY) / this._scale
    };
  };

  // ---------------------------------------------------------------
  // getViewBounds() — visible area in world coords (with margin)
  // ---------------------------------------------------------------
  Renderer.prototype.getViewBounds = function () {
    var canvas = this.worldCanvas;
    var dpr = this._dpr;
    var lw = canvas.width / dpr;
    var lh = canvas.height / dpr;
    var topLeft = this.screenToWorld(0, 0);
    var bottomRight = this.screenToWorld(lw, lh);
    var margin = 50; // world-space padding
    return {
      left: topLeft.x - margin,
      top: topLeft.y - margin,
      right: bottomRight.x + margin,
      bottom: bottomRight.y + margin
    };
  };

  // ---------------------------------------------------------------
  // resetCamera() — reset to comfortable default zoom
  // ---------------------------------------------------------------
  Renderer.prototype.resetCamera = function () {
    this.camera.x = Config.WORLD_WIDTH / 2;
    this.camera.y = Config.WORLD_HEIGHT / 2;
    this.camera.zoom = 2.5;
  };

  // ---------------------------------------------------------------
  // zoomAt(screenX, screenY, factor) — zoom toward a screen point
  // ---------------------------------------------------------------
  Renderer.prototype.zoomAt = function (screenX, screenY, factor) {
    var camera = this.camera;
    var worldPt = this.screenToWorld(screenX, screenY);
    var oldZoom = camera.zoom;
    camera.zoom = max(0.3, min(12, camera.zoom * factor));
    // Adjust camera so worldPt stays under cursor
    var canvas = this.worldCanvas;
    var dpr = this._dpr;
    var lw = canvas.width / dpr;
    var lh = canvas.height / dpr;
    var baseScaleX = lw / Config.WORLD_WIDTH;
    var baseScaleY = lh / Config.WORLD_HEIGHT;
    var baseScale = min(baseScaleX, baseScaleY);
    var newScale = baseScale * camera.zoom;
    camera.x = worldPt.x - (screenX - lw * 0.5) / newScale;
    camera.y = worldPt.y - (screenY - lh * 0.5) / newScale;
  };

  EcoSim.Renderer = Renderer;

})();
