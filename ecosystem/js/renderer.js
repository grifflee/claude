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

    // Performance caches — glow sprites, LOD, background
    this._glowSprites = {};       // hue-bucketed creature glow sprites
    this._foodGlowSprites = {};   // plant/meat glow sprites
    this._gridPatternObj = null;  // pre-rendered grid tile pattern
    this._bgGradient = null;      // cached background gradient
    this._bgDayPhase = -1;        // dayPhase when bg was last computed
    this._bgLogicalW = 0;
    this._bgLogicalH = 0;
    this._finalScale = 1;         // stored per frame for LOD checks

    this._initGlowSprites();

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

  // ---------------------------------------------------------------
  // _initGlowSprites() — pre-render glow textures to offscreen canvases
  // ---------------------------------------------------------------
  Renderer.prototype._initGlowSprites = function () {
    var spriteSize = 64;
    var half = spriteSize / 2;
    var hue, canvas, sctx, grad;

    // 12 creature glow sprites (one per 30-degree hue bucket)
    for (hue = 0; hue < 360; hue += 30) {
      canvas = document.createElement('canvas');
      canvas.width = spriteSize;
      canvas.height = spriteSize;
      sctx = canvas.getContext('2d');
      grad = sctx.createRadialGradient(half, half, 0, half, half, half);
      grad.addColorStop(0, 'hsla(' + hue + ', 85%, 75%, 1)');
      grad.addColorStop(0.5, 'hsla(' + hue + ', 85%, 75%, 0.4)');
      grad.addColorStop(1, 'hsla(' + hue + ', 85%, 75%, 0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, spriteSize, spriteSize);
      this._glowSprites[hue] = canvas;
    }

    // Plant food glow sprite
    canvas = document.createElement('canvas');
    canvas.width = spriteSize;
    canvas.height = spriteSize;
    sctx = canvas.getContext('2d');
    grad = sctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(124, 255, 107, 1)');
    grad.addColorStop(0.4, 'rgba(0, 229, 200, 0.4)');
    grad.addColorStop(1, 'rgba(0, 229, 200, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, spriteSize, spriteSize);
    this._foodGlowSprites.plant = canvas;

    // Meat food glow sprite
    canvas = document.createElement('canvas');
    canvas.width = spriteSize;
    canvas.height = spriteSize;
    sctx = canvas.getContext('2d');
    grad = sctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255, 80, 60, 1)');
    grad.addColorStop(0.6, 'rgba(255, 50, 40, 0.35)');
    grad.addColorStop(1, 'rgba(255, 50, 40, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, spriteSize, spriteSize);
    this._foodGlowSprites.meat = canvas;

    // Aggression aura glow sprite
    canvas = document.createElement('canvas');
    canvas.width = spriteSize;
    canvas.height = spriteSize;
    sctx = canvas.getContext('2d');
    grad = sctx.createRadialGradient(half, half, half * 0.23, half, half, half);
    grad.addColorStop(0, 'rgba(255, 40, 20, 1)');
    grad.addColorStop(1, 'rgba(255, 40, 20, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, spriteSize, spriteSize);
    this._glowSprites.aggression = canvas;
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

    // Store for screenToWorld calculations and LOD
    this._scale = finalScale;
    this._offsetX = offsetX;
    this._offsetY = offsetY;
    this._finalScale = finalScale;

    // Deep-sea gradient background with day/night modulation (cached)
    var dayPhase = world.getDayNightPhase ? world.getDayNightPhase() : 0.5;
    if (!this._bgGradient || abs(dayPhase - this._bgDayPhase) > 0.05 ||
        this._bgLogicalW !== logicalWidth || this._bgLogicalH !== logicalHeight) {
      var bgBase = 6 + Math.round(dayPhase * 6);
      var bgGrad = ctx.createRadialGradient(
        logicalWidth * 0.5, logicalHeight * 0.5, 0,
        logicalWidth * 0.5, logicalHeight * 0.5, max(logicalWidth, logicalHeight) * 0.7
      );
      bgGrad.addColorStop(0, 'rgb(' + (bgBase + 4) + ',' + (bgBase + 8) + ',' + (bgBase + 18) + ')');
      bgGrad.addColorStop(1, 'rgb(' + bgBase + ',' + (bgBase + 2) + ',' + (bgBase + 8) + ')');
      this._bgGradient = bgGrad;
      this._bgDayPhase = dayPhase;
      this._bgLogicalW = logicalWidth;
      this._bgLogicalH = logicalHeight;
    }
    ctx.fillStyle = this._bgGradient;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(finalScale, finalScale);

    // Compute view bounds once per frame for viewport culling
    // Only cull when zoomed in (at zoom <= 1.0, everything is visible)
    var bounds = camera.zoom > 1.0 ? this.getViewBounds() : null;

    this.drawIslandOcean(ctx, world);
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

    // Migration portal effects
    if (world._migrationEffects && world._migrationEffects.length > 0) {
      this.drawMigrationEffect(ctx, world._migrationEffects, world.tick);
    }

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

    // Draw island ocean gaps
    if (world.islands && world.islands.length >= 2) {
      ctx.fillStyle = 'rgba(2, 4, 10, 0.9)';
      if (world.islands.length === 2) {
        var mgX1 = world.islands[0].bounds.x2 * sx;
        var mgX2 = world.islands[1].bounds.x1 * sx;
        ctx.fillRect(mgX1, 0, mgX2 - mgX1, mh);
      } else if (world.islands.length >= 4) {
        var mvX1 = world.islands[0].bounds.x2 * sx;
        var mvX2 = world.islands[1].bounds.x1 * sx;
        var mhY1 = world.islands[0].bounds.y2 * sy;
        var mhY2 = world.islands[2].bounds.y1 * sy;
        ctx.fillRect(mvX1, 0, mvX2 - mvX1, mh);
        ctx.fillRect(0, mhY1, mw, mhY2 - mhY1);
      }
      // Island boundary lines
      ctx.strokeStyle = 'rgba(0, 180, 200, 0.3)';
      ctx.lineWidth = 0.5;
      for (var mi = 0; mi < world.islands.length; mi++) {
        var mb = world.islands[mi].bounds;
        ctx.strokeRect(mb.x1 * sx, mb.y1 * sy, (mb.x2 - mb.x1) * sx, (mb.y2 - mb.y1) * sy);
      }
    }

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

  // ---------------------------------------------------------------
  // drawIslandOcean(ctx, world) — dark ocean gaps between islands
  // ---------------------------------------------------------------
  Renderer.prototype.drawIslandOcean = function (ctx, world) {
    var islands = world.islands;
    if (!islands || islands.length < 2) return;
    var tick = this._borderTick || 0;
    var gap = EcoSim.Config.ISLAND_GAP;

    // Draw full dark overlay, then clear island areas
    // More efficient: just draw the gap regions directly

    if (islands.length === 2) {
      // Vertical gap between two islands
      var gapX1 = islands[0].bounds.x2;
      var gapX2 = islands[1].bounds.x1;
      // Dark ocean fill
      ctx.fillStyle = 'rgba(2, 4, 10, 0.85)';
      ctx.fillRect(gapX1, 0, gapX2 - gapX1, world.height);

      // Bioluminescent particles drifting in the ocean
      for (var i = 0; i < 15; i++) {
        var py = ((tick * 0.3 + i * world.height / 15) % world.height);
        var px = gapX1 + (gap * 0.5) + sin(tick * 0.02 + i * 2.1) * gap * 0.3;
        var pAlpha = 0.03 + 0.02 * sin(tick * 0.04 + i * 1.7);
        var pHue = 190 + (i * 17) % 40;
        ctx.fillStyle = 'hsla(' + pHue + ', 70%, 60%, ' + pAlpha + ')';
        ctx.beginPath();
        ctx.arc(px, py, 1.5 + sin(tick * 0.03 + i) * 0.5, 0, TAU);
        ctx.fill();
      }

      // Soft glow edges along island boundaries
      var glowW = 30;
      // Right edge of west island
      var edgeGrad = ctx.createLinearGradient(gapX1 - glowW, 0, gapX1, 0);
      edgeGrad.addColorStop(0, 'rgba(0, 180, 200, 0)');
      edgeGrad.addColorStop(1, 'rgba(0, 180, 200, ' + (0.04 + 0.02 * sin(tick * 0.03)) + ')');
      ctx.fillStyle = edgeGrad;
      ctx.fillRect(gapX1 - glowW, 0, glowW, world.height);

      // Left edge of east island
      edgeGrad = ctx.createLinearGradient(gapX2, 0, gapX2 + glowW, 0);
      edgeGrad.addColorStop(0, 'rgba(0, 180, 200, ' + (0.04 + 0.02 * sin(tick * 0.03)) + ')');
      edgeGrad.addColorStop(1, 'rgba(0, 180, 200, 0)');
      ctx.fillStyle = edgeGrad;
      ctx.fillRect(gapX2, 0, glowW, world.height);

    } else if (islands.length >= 4) {
      // 2x2 grid — horizontal and vertical gap channels
      var hGapY1 = islands[0].bounds.y2;
      var hGapY2 = islands[2].bounds.y1;
      var vGapX1 = islands[0].bounds.x2;
      var vGapX2 = islands[1].bounds.x1;

      ctx.fillStyle = 'rgba(2, 4, 10, 0.85)';
      // Vertical channel (full height)
      ctx.fillRect(vGapX1, 0, vGapX2 - vGapX1, world.height);
      // Horizontal channel (full width, but don't double-fill intersection)
      ctx.fillRect(0, hGapY1, vGapX1, hGapY2 - hGapY1);
      ctx.fillRect(vGapX2, hGapY1, world.width - vGapX2, hGapY2 - hGapY1);

      // Particles in both channels
      var gapCenterX = (vGapX1 + vGapX2) * 0.5;
      var gapCenterY = (hGapY1 + hGapY2) * 0.5;
      for (var j = 0; j < 20; j++) {
        var jx, jy;
        if (j < 10) {
          // Vertical channel particles
          jy = ((tick * 0.3 + j * world.height / 10) % world.height);
          jx = gapCenterX + sin(tick * 0.02 + j * 2.1) * gap * 0.3;
        } else {
          // Horizontal channel particles
          jx = ((tick * 0.25 + (j - 10) * world.width / 10) % world.width);
          jy = gapCenterY + sin(tick * 0.02 + j * 1.8) * gap * 0.3;
        }
        var ja = 0.03 + 0.02 * sin(tick * 0.04 + j * 1.7);
        var jh = 190 + (j * 17) % 40;
        ctx.fillStyle = 'hsla(' + jh + ', 70%, 60%, ' + ja + ')';
        ctx.beginPath();
        ctx.arc(jx, jy, 1.5, 0, TAU);
        ctx.fill();
      }

      // Glow edges for all 4 islands
      var glowSize = 30;
      var glowAlpha = 0.04 + 0.02 * sin(tick * 0.03);
      var gi, gIsland, gb, gGrad;
      for (gi = 0; gi < islands.length; gi++) {
        gIsland = islands[gi];
        gb = gIsland.bounds;
        // Right edge glow (if not at world right)
        if (gb.x2 < world.width - 10) {
          gGrad = ctx.createLinearGradient(gb.x2 - glowSize, 0, gb.x2, 0);
          gGrad.addColorStop(0, 'rgba(0, 180, 200, 0)');
          gGrad.addColorStop(1, 'rgba(0, 180, 200, ' + glowAlpha + ')');
          ctx.fillStyle = gGrad;
          ctx.fillRect(gb.x2 - glowSize, gb.y1, glowSize, gb.y2 - gb.y1);
        }
        // Left edge glow (if not at world left)
        if (gb.x1 > 10) {
          gGrad = ctx.createLinearGradient(gb.x1, 0, gb.x1 + glowSize, 0);
          gGrad.addColorStop(0, 'rgba(0, 180, 200, ' + glowAlpha + ')');
          gGrad.addColorStop(1, 'rgba(0, 180, 200, 0)');
          ctx.fillStyle = gGrad;
          ctx.fillRect(gb.x1, gb.y1, glowSize, gb.y2 - gb.y1);
        }
        // Bottom edge glow (if not at world bottom)
        if (gb.y2 < world.height - 10) {
          gGrad = ctx.createLinearGradient(0, gb.y2 - glowSize, 0, gb.y2);
          gGrad.addColorStop(0, 'rgba(0, 180, 200, 0)');
          gGrad.addColorStop(1, 'rgba(0, 180, 200, ' + glowAlpha + ')');
          ctx.fillStyle = gGrad;
          ctx.fillRect(gb.x1, gb.y2 - glowSize, gb.x2 - gb.x1, glowSize);
        }
        // Top edge glow (if not at world top)
        if (gb.y1 > 10) {
          gGrad = ctx.createLinearGradient(0, gb.y1, 0, gb.y1 + glowSize);
          gGrad.addColorStop(0, 'rgba(0, 180, 200, ' + glowAlpha + ')');
          gGrad.addColorStop(1, 'rgba(0, 180, 200, 0)');
          ctx.fillStyle = gGrad;
          ctx.fillRect(gb.x1, gb.y1, gb.x2 - gb.x1, glowSize);
        }
      }
    }
  };

  // ---------------------------------------------------------------
  // drawMigrationEffect(ctx, effects, tick) — portal rings for migration
  // ---------------------------------------------------------------
  Renderer.prototype.drawMigrationEffect = function (ctx, effects, tick) {
    if (!effects || effects.length === 0) return;
    var i, eff, progress, alpha, radius;

    for (i = 0; i < effects.length; i++) {
      eff = effects[i];
      progress = 1 - (eff.ticksLeft / eff.maxTicks);
      alpha = (1 - progress) * 0.6;
      radius = 10 + progress * 40;

      // Source portal — expanding ring fading out
      ctx.strokeStyle = 'hsla(' + round(eff.hue) + ', 80%, 65%, ' + alpha + ')';
      ctx.lineWidth = max(0.5, 3 * (1 - progress));
      ctx.beginPath();
      ctx.arc(eff.fromX, eff.fromY, radius, 0, TAU);
      ctx.stroke();

      // Inner glow at source
      var srcGrad = ctx.createRadialGradient(eff.fromX, eff.fromY, 0, eff.fromX, eff.fromY, radius * 0.6);
      srcGrad.addColorStop(0, 'hsla(' + round(eff.hue) + ', 80%, 65%, ' + (alpha * 0.2) + ')');
      srcGrad.addColorStop(1, 'hsla(' + round(eff.hue) + ', 80%, 65%, 0)');
      ctx.fillStyle = srcGrad;
      ctx.beginPath();
      ctx.arc(eff.fromX, eff.fromY, radius * 0.6, 0, TAU);
      ctx.fill();

      // Destination portal — contracting ring appearing
      var destAlpha = progress * 0.6;
      var destRadius = 40 * (1 - progress * 0.5);
      ctx.strokeStyle = 'hsla(' + round(eff.hue) + ', 80%, 65%, ' + destAlpha + ')';
      ctx.lineWidth = max(0.5, 3 * progress);
      ctx.beginPath();
      ctx.arc(eff.toX, eff.toY, destRadius, 0, TAU);
      ctx.stroke();

      // Inner glow at destination
      var dstGrad = ctx.createRadialGradient(eff.toX, eff.toY, 0, eff.toX, eff.toY, destRadius * 0.6);
      dstGrad.addColorStop(0, 'hsla(' + round(eff.hue) + ', 80%, 65%, ' + (destAlpha * 0.3) + ')');
      dstGrad.addColorStop(1, 'hsla(' + round(eff.hue) + ', 80%, 65%, 0)');
      ctx.fillStyle = dstGrad;
      ctx.beginPath();
      ctx.arc(eff.toX, eff.toY, destRadius * 0.6, 0, TAU);
      ctx.fill();

      // Sparkle particles along migration path
      var sparkCount = 5;
      for (var s = 0; s < sparkCount; s++) {
        var t = (progress + s * 0.15) % 1;
        var sx = eff.fromX + (eff.toX - eff.fromX) * t;
        var sy = eff.fromY + (eff.toY - eff.fromY) * t;
        sx += sin(tick * 0.1 + s * 2) * 8;
        sy += cos(tick * 0.1 + s * 2) * 8;
        var sAlpha = (1 - abs(t - 0.5) * 2) * alpha * 0.5;
        ctx.fillStyle = 'hsla(' + round(eff.hue) + ', 80%, 75%, ' + sAlpha + ')';
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, TAU);
        ctx.fill();
      }
    }
  };

  Renderer.prototype.drawGrid = function (ctx, width, height, bounds) {
    // Organic dot grid — single fillRect with a repeating pattern tile
    if (!this._gridPatternObj) {
      var tile = document.createElement('canvas');
      tile.width = 50;
      tile.height = 50;
      var tctx = tile.getContext('2d');
      tctx.fillStyle = 'rgba(100, 180, 255, 0.05)';
      tctx.beginPath();
      tctx.arc(0, 0, 0.8, 0, TAU);
      tctx.fill();
      this._gridPatternObj = ctx.createPattern(tile, 'repeat');
    }
    ctx.fillStyle = this._gridPatternObj;
    if (bounds) {
      ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    } else {
      ctx.fillRect(0, 0, width, height);
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
    var i, f, pulse, glowRadius, isMeat;
    var spawnFade, j, tAngle, tLen, tx, ty;
    var tick = this._borderTick || 0;
    var scale = this._finalScale;
    var LOD0 = Config.LOD_THRESHOLD_0;
    var LOD1 = Config.LOD_THRESHOLD_1;

    for (i = 0; i < food.length; i++) {
      f = food[i];
      if (bounds && (f.x < bounds.left || f.x > bounds.right ||
          f.y < bounds.top || f.y > bounds.bottom)) continue;

      isMeat = f.type === 'meat';
      var apparentSize = f.size * scale;

      // LOD 0: tiny on screen — single colored rect
      if (apparentSize < LOD0) {
        ctx.fillStyle = isMeat ? '#ff5040' : '#7cff6b';
        ctx.fillRect(f.x - f.size, f.y - f.size, f.size * 2, f.size * 2);
        continue;
      }

      pulse = 0.7 + 0.3 * sin(f.age * 0.05 + i);
      spawnFade = min(1, f.age / 10);
      glowRadius = (f.size + 6) * pulse;

      // LOD 1: medium — glow sprite + central dot, no tendrils/blobs
      if (apparentSize < LOD1) {
        var sprite = isMeat ? this._foodGlowSprites.meat : this._foodGlowSprites.plant;
        ctx.globalAlpha = 0.3 * f.glow * pulse * spawnFade;
        ctx.drawImage(sprite, f.x - glowRadius, f.y - glowRadius, glowRadius * 2, glowRadius * 2);
        ctx.globalAlpha = spawnFade;
        ctx.fillStyle = isMeat ? '#ff5040' : '#7cff6b';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }

      // LOD 2: full detail
      if (isMeat) {
        // Organic red matter — glow sprite + irregular overlapping circles
        ctx.globalAlpha = 0.3 * f.glow * pulse * spawnFade;
        ctx.drawImage(this._foodGlowSprites.meat, f.x - glowRadius, f.y - glowRadius, glowRadius * 2, glowRadius * 2);
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
        // Plant spore — glow sprite + bright dot + radiating tendrils
        ctx.globalAlpha = 0.4 * f.glow * pulse * spawnFade;
        ctx.drawImage(this._foodGlowSprites.plant, f.x - glowRadius, f.y - glowRadius, glowRadius * 2, glowRadius * 2);
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

  // ---------------------------------------------------------------
  // drawWorldEvents(ctx, events, tick) — visual effects for active world events
  // ---------------------------------------------------------------
  Renderer.prototype.drawWorldEvents = function (ctx, events, tick) {
    var i, evt, progress, alpha, grad, j;

    for (i = 0; i < events.length; i++) {
      evt = events[i];
      progress = 1 - (evt.ticksLeft / evt.maxTicks);

      switch (evt.type) {
        case 'bloom':
          // Green-teal expanding glow ring with inner fill
          var bloomAlpha = (1 - progress) * 0.6;
          var bloomRing = evt.radius * (0.3 + progress * 0.7);

          // Soft inner fill
          grad = ctx.createRadialGradient(evt.x, evt.y, 0, evt.x, evt.y, bloomRing);
          grad.addColorStop(0, 'rgba(124, 255, 107, ' + (bloomAlpha * 0.15) + ')');
          grad.addColorStop(0.5, 'rgba(0, 229, 200, ' + (bloomAlpha * 0.08) + ')');
          grad.addColorStop(1, 'rgba(0, 229, 200, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(evt.x, evt.y, bloomRing, 0, TAU);
          ctx.fill();

          // Expanding ring
          ctx.strokeStyle = 'rgba(124, 255, 107, ' + (bloomAlpha * 0.5) + ')';
          ctx.lineWidth = max(1, 3 * (1 - progress));
          ctx.beginPath();
          ctx.arc(evt.x, evt.y, bloomRing, 0, TAU);
          ctx.stroke();

          // Sparkle particles within bloom area
          for (j = 0; j < 8; j++) {
            var sAngle = j * TAU / 8 + tick * 0.03 + i;
            var sDist = bloomRing * (0.3 + 0.5 * sin(tick * 0.05 + j * 1.7));
            var sx = evt.x + cos(sAngle) * sDist;
            var sy = evt.y + sin(sAngle) * sDist;
            var sPulse = 0.5 + 0.5 * sin(tick * 0.1 + j * 2);
            ctx.fillStyle = 'rgba(124, 255, 107, ' + (bloomAlpha * sPulse * 0.4) + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, 2, 0, TAU);
            ctx.fill();
          }
          break;

        case 'plague':
          // Purple-red toxic cloud with pulsing particles
          var plagueAlpha = min(1, progress < 0.1 ? progress / 0.1 : 1) *
                            (evt.ticksLeft > 30 ? 1 : evt.ticksLeft / 30);
          var plaguePulse = 0.7 + 0.3 * sin(tick * 0.06);
          var plagueR = evt.radius * plaguePulse;

          // Toxic cloud gradient
          grad = ctx.createRadialGradient(evt.x, evt.y, 0, evt.x, evt.y, plagueR);
          grad.addColorStop(0, 'rgba(180, 40, 180, ' + (plagueAlpha * 0.12) + ')');
          grad.addColorStop(0.4, 'rgba(120, 20, 80, ' + (plagueAlpha * 0.08) + ')');
          grad.addColorStop(0.7, 'rgba(80, 0, 60, ' + (plagueAlpha * 0.04) + ')');
          grad.addColorStop(1, 'rgba(80, 0, 60, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(evt.x, evt.y, plagueR, 0, TAU);
          ctx.fill();

          // Pulsing border
          ctx.strokeStyle = 'rgba(200, 50, 180, ' + (plagueAlpha * 0.2 * plaguePulse) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(evt.x, evt.y, plagueR * 0.95, 0, TAU);
          ctx.stroke();

          // Floating toxic spore particles
          for (j = 0; j < 12; j++) {
            var pAngle = j * TAU / 12 + tick * 0.015 * (j % 2 === 0 ? 1 : -1);
            var pDist = evt.radius * (0.2 + 0.6 * sin(tick * 0.02 + j * 0.8));
            var px = evt.x + cos(pAngle) * pDist;
            var py = evt.y + sin(pAngle) * pDist;
            var pSize = 1.5 + sin(tick * 0.08 + j) * 0.8;
            ctx.fillStyle = 'rgba(200, 80, 200, ' + (plagueAlpha * 0.25) + ')';
            ctx.beginPath();
            ctx.arc(px, py, max(0.5, pSize), 0, TAU);
            ctx.fill();
          }
          break;

        case 'meteor':
          // Bright flash → expanding shockwave → crater glow
          var meteorPhase = progress;

          if (meteorPhase < 0.15) {
            // Bright white flash (first 15% of animation)
            var flashIntensity = 1 - (meteorPhase / 0.15);
            grad = ctx.createRadialGradient(evt.x, evt.y, 0, evt.x, evt.y, evt.radius * 0.8);
            grad.addColorStop(0, 'rgba(255, 255, 255, ' + (flashIntensity * 0.6) + ')');
            grad.addColorStop(0.3, 'rgba(255, 200, 100, ' + (flashIntensity * 0.3) + ')');
            grad.addColorStop(1, 'rgba(255, 150, 50, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(evt.x, evt.y, evt.radius * 0.8, 0, TAU);
            ctx.fill();
          }

          // Expanding shockwave ring
          var shockRadius = evt.radius * (0.3 + meteorPhase * 1.2);
          var shockAlpha = (1 - meteorPhase) * 0.5;
          ctx.strokeStyle = 'rgba(255, 160, 50, ' + shockAlpha + ')';
          ctx.lineWidth = max(0.5, 4 * (1 - meteorPhase));
          ctx.beginPath();
          ctx.arc(evt.x, evt.y, shockRadius, 0, TAU);
          ctx.stroke();

          // Secondary inner ring
          if (meteorPhase < 0.6) {
            var innerRadius = evt.radius * meteorPhase * 0.8;
            ctx.strokeStyle = 'rgba(255, 220, 150, ' + ((0.6 - meteorPhase) * 0.4) + ')';
            ctx.lineWidth = max(0.3, 2 * (1 - meteorPhase));
            ctx.beginPath();
            ctx.arc(evt.x, evt.y, innerRadius, 0, TAU);
            ctx.stroke();
          }

          // Crater glow (persists toward end)
          if (meteorPhase > 0.2) {
            var craterAlpha = (1 - meteorPhase) * 0.2;
            grad = ctx.createRadialGradient(evt.x, evt.y, 0, evt.x, evt.y, evt.radius * 0.6);
            grad.addColorStop(0, 'rgba(255, 120, 40, ' + craterAlpha + ')');
            grad.addColorStop(0.5, 'rgba(200, 80, 20, ' + (craterAlpha * 0.5) + ')');
            grad.addColorStop(1, 'rgba(200, 80, 20, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(evt.x, evt.y, evt.radius * 0.6, 0, TAU);
            ctx.fill();
          }

          // Flying debris particles
          if (meteorPhase < 0.5) {
            for (j = 0; j < 10; j++) {
              var dAngle = j * TAU / 10 + evt.x * 0.01;
              var dDist = evt.radius * (0.5 + meteorPhase * 2) * (0.5 + 0.5 * sin(j * 3.7));
              var debX = evt.x + cos(dAngle) * dDist;
              var debY = evt.y + sin(dAngle) * dDist;
              var debAlpha = (0.5 - meteorPhase) * 0.6;
              var debSize = max(0.5, 2 * (1 - meteorPhase * 2));
              ctx.fillStyle = 'rgba(255, 180, 80, ' + debAlpha + ')';
              ctx.beginPath();
              ctx.arc(debX, debY, debSize, 0, TAU);
              ctx.fill();
            }
          }
          break;

        case 'mutationStorm':
          // Subtle purple atmospheric tint + sparkles across the world
          var stormAlpha = min(1, progress < 0.05 ? progress / 0.05 : 1) *
                           (evt.ticksLeft > 60 ? 1 : evt.ticksLeft / 60);

          // Subtle full-world purple tint via the event center (very large radius)
          grad = ctx.createRadialGradient(evt.x, evt.y, 0, evt.x, evt.y, evt.radius * 0.5);
          grad.addColorStop(0, 'rgba(180, 100, 255, ' + (stormAlpha * 0.02) + ')');
          grad.addColorStop(1, 'rgba(180, 100, 255, ' + (stormAlpha * 0.01) + ')');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, evt.x * 2, evt.y * 2);

          // Scattered sparkles across the world
          for (j = 0; j < 20; j++) {
            var msX = sin(tick * 0.007 + j * 47.3) * evt.x + evt.x;
            var msY = cos(tick * 0.009 + j * 31.7) * evt.y + evt.y;
            var msPulse = 0.5 + 0.5 * sin(tick * 0.15 + j * 2.3);
            var msSize = 1 + msPulse * 1.5;
            var msAlpha = stormAlpha * msPulse * 0.3;
            ctx.fillStyle = 'rgba(200, 150, 255, ' + msAlpha + ')';
            ctx.beginPath();
            ctx.arc(msX, msY, msSize, 0, TAU);
            ctx.fill();
            // Tiny glow halo
            ctx.fillStyle = 'rgba(200, 150, 255, ' + (msAlpha * 0.3) + ')';
            ctx.beginPath();
            ctx.arc(msX, msY, msSize * 3, 0, TAU);
            ctx.fill();
          }
          break;
      }
    }
  };

  Renderer.prototype.drawCreatureTrails = function (ctx, creatures, bounds) {
    var i, creature, trail, j, alpha, tp, k;
    var scale = this._finalScale;
    var LOD0 = Config.LOD_THRESHOLD_0;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      // Skip trails for LOD 0 creatures (too small to see trails)
      if (creature.size * scale < LOD0) continue;
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
    var i, creature, cx, cy, r, angle;
    var j, spotAngle, spotDist, spotX, spotY;
    var tSeed, tBaseAngle, tLen, tWave, tx1, ty1, tx2, ty2;
    var scale = this._finalScale;
    var LOD0 = Config.LOD_THRESHOLD_0;
    var LOD1 = Config.LOD_THRESHOLD_1;

    for (i = 0; i < creatures.length; i++) {
      creature = creatures[i];
      if (!creature.alive) continue;

      cx = creature.x;
      cy = creature.y;

      if (bounds && (cx < bounds.left || cx > bounds.right ||
          cy < bounds.top || cy > bounds.bottom)) continue;

      r = creature.size;
      var apparentSize = r * scale;

      // LOD 0: < 3px on screen — single filled circle
      if (apparentSize < LOD0) {
        ctx.fillStyle = 'hsla(' + round(creature.bodyGenes.hue) + ', 70%, 55%, 0.7)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
        continue;
      }

      angle = creature.angle;
      var dirX = cos(angle);
      var dirY = sin(angle);
      var lum = creature.bodyGenes.luminosity !== undefined ? creature.bodyGenes.luminosity : 0.7;
      var energyRatio = min(1, max(0, creature.energy / Config.CREATURE_MAX_ENERGY));
      var hue = creature.bodyGenes.hue;
      var sat = creature.bodyGenes.saturation;

      // LOD 1: 3-8px on screen — circle + glow sprite, no tendrils/spots/signals
      if (apparentSize < LOD1) {
        // Membrane circle
        ctx.fillStyle = creature.getMembraneColor(Config.CREATURE_MEMBRANE_ALPHA + lum * 0.1);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();

        // Core glow via sprite
        var corePulse1 = 0.7 + 0.3 * sin(tick * 0.06 + creature.id);
        var coreAlpha1 = Config.CREATURE_GLOW_INTENSITY * lum * energyRatio * corePulse1;
        var spriteHue1 = (round(hue / 30) * 30) % 360;
        var glowSprite1 = this._glowSprites[spriteHue1];
        if (glowSprite1) {
          ctx.globalAlpha = coreAlpha1;
          var gr1 = r * 0.8;
          ctx.drawImage(glowSprite1, cx - gr1, cy - gr1, gr1 * 2, gr1 * 2);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      // LOD 2: Full detail rendering
      var aggression = creature.bodyGenes.aggression;

      // --- 1. Tendrils (drawn behind body) ---
      var tCount = creature.tendrilCount || 2;
      var tSeeds = creature.tendrilSeeds || [0, PI * 0.5, PI, PI * 1.5];
      var tendrilBaseLen = r * Config.CREATURE_TENDRIL_LENGTH * (0.5 + creature.speed * 0.3);
      ctx.lineWidth = max(0.4, r * 0.08);

      for (j = 0; j < tCount; j++) {
        tSeed = tSeeds[j];
        tBaseAngle = angle + PI + (j - (tCount - 1) * 0.5) * 0.5;
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
      ctx.scale(1.1, 0.95 + memWobble / r);
      ctx.fillStyle = creature.getMembraneColor(memAlpha);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.restore();

      // --- 3. Aggression aura (glow sprite + spiky membrane) ---
      if (aggression > 0.6) {
        var aggrIntensity = (aggression - 0.6) * 2.5;
        // Red-shifted glow via sprite
        var aggrSprite = this._glowSprites.aggression;
        if (aggrSprite) {
          ctx.globalAlpha = 0.08 * aggrIntensity;
          var aggrR = r * 1.3;
          ctx.drawImage(aggrSprite, cx - aggrR, cy - aggrR, aggrR * 2, aggrR * 2);
          ctx.globalAlpha = 1;
        }

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

      // --- 4. Inner core glow (sprite-based, pulsing) ---
      var corePulse = 0.7 + 0.3 * sin(tick * 0.06 + creature.id);
      var coreAlpha = Config.CREATURE_GLOW_INTENSITY * lum * energyRatio * corePulse;
      var coreOffX = dirX * r * 0.15;
      var coreOffY = dirY * r * 0.15;
      var spriteHue = (round(hue / 30) * 30) % 360;
      var glowSprite = this._glowSprites[spriteHue];
      if (glowSprite) {
        ctx.globalAlpha = coreAlpha;
        var glowR = r * 0.8;
        ctx.drawImage(glowSprite, cx + coreOffX - glowR, cy + coreOffY - glowR, glowR * 2, glowR * 2);
        ctx.globalAlpha = 1;
      }

      // --- 5. Bioluminescent spots (3-5 glowing dots on membrane) ---
      var spots = creature.spotSeeds || [];
      var spotCount = min(spots.length, r < 6 ? 2 : (r < 10 ? 3 : 5));
      for (j = 0; j < spotCount; j++) {
        spotAngle = spots[j] + angle;
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
        ctx.strokeStyle = 'rgba(100, 255, 220, ' + reproGlowAlpha + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3 + sin(tick * 0.08) * 1.5, 0, TAU);
        ctx.stroke();
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
        var sigColor = sigVal > 0 ? '255, 210, 60' : '180, 100, 255';
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
        ctx.globalAlpha = 0.35;
        var eatSprite = this._glowSprites[120] || this._glowSprites[90];
        if (eatSprite) {
          ctx.drawImage(eatSprite, cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
        }
        ctx.globalAlpha = 1;
      } else if (creature.lastAction === 'attacking') {
        ctx.globalAlpha = 0.2;
        var atkSprite = this._glowSprites.aggression;
        if (atkSprite) {
          ctx.drawImage(atkSprite, cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
        }
        ctx.globalAlpha = 1;
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
