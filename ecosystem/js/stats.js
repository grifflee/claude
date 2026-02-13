/**
 * EcoSim Statistics Tracker & Chart Renderer
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;

  var COLOR_CYAN   = '#00d4ff';
  var COLOR_GREEN  = '#7cff6b';
  var COLOR_ORANGE = '#ffa502';
  var COLOR_RED    = '#ff4757';
  var COLOR_DIM    = 'rgba(255,255,255,0.3)';
  var COLOR_GRID   = 'rgba(255,255,255,0.06)';
  var COLOR_BG     = 'rgba(10,14,23,0.85)';
  var COLOR_LABEL  = 'rgba(255,255,255,0.5)';

  function Stats(popCanvas, speciesCanvas, statsPanel) {
    this.popCanvas     = popCanvas;
    this.speciesCanvas = speciesCanvas;
    this.statsPanel    = statsPanel;

    this.popCtx     = popCanvas ? popCanvas.getContext('2d') : null;
    this.speciesCtx = speciesCanvas ? speciesCanvas.getContext('2d') : null;

    // Evolution timeline canvas (self-discovered)
    this.evoCanvas = document.getElementById('evo-chart');
    this.evoCtx    = this.evoCanvas ? this.evoCanvas.getContext('2d') : null;

    this.populationHistory = [];
    this.speciesHistory    = [];
    this.evoHistory        = [];
    this.maxHistoryLength  = 500;
    this.sampleInterval    = 10;

    this.frameCount     = 0;
    this.lastStats      = null;
    this.lastPanelHTML  = '';

    this.frameTimestamps = [];
    this.maxFPSFrames    = 30;
  }

  Stats.prototype.update = function (world) {
    var stats = world.getStats();
    this.lastStats = stats;

    this.frameTimestamps.push(performance.now());
    if (this.frameTimestamps.length > this.maxFPSFrames) {
      this.frameTimestamps.shift();
    }

    if (stats.tick % this.sampleInterval === 0) {
      this.populationHistory.push({
        tick:         stats.tick,
        population:   stats.population,
        foodCount:    stats.foodCount,
        totalBirths:  stats.totalBirths,
        totalDeaths:  stats.totalDeaths,
        speciesCount: stats.speciesCount
      });
      if (this.populationHistory.length > this.maxHistoryLength) {
        this.populationHistory.shift();
      }

      var dist = {};
      var key;
      for (key in stats.speciesDistribution) {
        if (stats.speciesDistribution.hasOwnProperty(key)) {
          dist[key] = stats.speciesDistribution[key];
        }
      }
      this.speciesHistory.push({
        tick:         stats.tick,
        distribution: dist,
        total:        stats.population
      });
      if (this.speciesHistory.length > this.maxHistoryLength) {
        this.speciesHistory.shift();
      }

      // Evolution timeline: track population-average genes
      if (EcoSim.world && EcoSim.world.getPopulationGeneAverages) {
        var avgs = EcoSim.world.getPopulationGeneAverages();
        if (avgs) {
          this.evoHistory.push({
            tick: stats.tick,
            size: avgs.size,
            speed: avgs.maxSpeed,
            aggression: avgs.aggression,
            efficiency: avgs.efficiency
          });
          if (this.evoHistory.length > this.maxHistoryLength) {
            this.evoHistory.shift();
          }
        }
      }
    }

    this.frameCount++;
  };

  Stats.prototype.render = function () {
    if (this.frameCount % 3 === 0) {
      this.renderPopulationChart();
      this.renderSpeciesChart();
      this.renderEvoChart();
    }
    if (this.frameCount % 10 === 0) {
      this.renderStatsPanel();
    }
  };

  Stats.prototype.renderPopulationChart = function () {
    var ctx = this.popCtx;
    if (!ctx) return;

    var w = this.popCanvas.width;
    var h = this.popCanvas.height;
    var hist = this.populationHistory;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    if (hist.length < 2) {
      ctx.fillStyle = COLOR_DIM;
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data...', w / 2, h / 2);
      return;
    }

    var maxVal = 1;
    var i;
    for (i = 0; i < hist.length; i++) {
      if (hist[i].population > maxVal) maxVal = hist[i].population;
      if (hist[i].foodCount > maxVal)  maxVal = hist[i].foodCount;
    }
    maxVal = Math.ceil(maxVal * 1.15);

    var padTop    = 12;
    var padBottom = 4;
    var padLeft   = 2;
    var padRight  = 48;
    var chartW    = w - padLeft - padRight;
    var chartH    = h - padTop - padBottom;

    var gridLines = 3;
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth   = 1;
    for (i = 1; i <= gridLines; i++) {
      var gy = padTop + chartH - (chartH * i / (gridLines + 1));
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(padLeft + chartW, gy);
      ctx.stroke();
    }

    var len = hist.length;
    function xOf(idx) {
      return padLeft + (idx / (len - 1)) * chartW;
    }
    function yOf(val) {
      return padTop + chartH - (val / maxVal) * chartH;
    }

    function drawSeries(data, color, fillAlpha) {
      var j;
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(data[0]));
      for (j = 1; j < data.length; j++) {
        var cpx = (xOf(j - 1) + xOf(j)) / 2;
        ctx.quadraticCurveTo(cpx, yOf(data[j - 1]), xOf(j), yOf(data[j]));
      }
      ctx.lineTo(xOf(data.length - 1), padTop + chartH);
      ctx.lineTo(xOf(0), padTop + chartH);
      ctx.closePath();
      ctx.fillStyle = hexToRGBA(color, fillAlpha);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(data[0]));
      for (j = 1; j < data.length; j++) {
        var cpx2 = (xOf(j - 1) + xOf(j)) / 2;
        ctx.quadraticCurveTo(cpx2, yOf(data[j - 1]), xOf(j), yOf(data[j]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    var popData  = [];
    var foodData = [];
    for (i = 0; i < hist.length; i++) {
      popData.push(hist[i].population);
      foodData.push(hist[i].foodCount);
    }

    // Compute birth/death rates (per interval)
    var birthRates = [0];
    var deathRates = [0];
    for (i = 1; i < hist.length; i++) {
      birthRates.push(Math.max(0, hist[i].totalBirths - hist[i - 1].totalBirths));
      deathRates.push(Math.max(0, hist[i].totalDeaths - hist[i - 1].totalDeaths));
    }

    // Find max rate for secondary Y axis
    var maxRate = 1;
    for (i = 0; i < birthRates.length; i++) {
      if (birthRates[i] > maxRate) maxRate = birthRates[i];
      if (deathRates[i] > maxRate) maxRate = deathRates[i];
    }
    maxRate = Math.ceil(maxRate * 1.2);

    function yOfRate(val) {
      return padTop + chartH - (val / maxRate) * chartH;
    }

    // Draw rate lines (thin, behind main series)
    function drawRateLine(data, color, yFn) {
      if (data.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(xOf(0), yFn(data[0]));
      for (var j = 1; j < data.length; j++) {
        var cpx = (xOf(j - 1) + xOf(j)) / 2;
        ctx.quadraticCurveTo(cpx, yFn(data[j - 1]), xOf(j), yFn(data[j]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawRateLine(deathRates, COLOR_RED, yOfRate);
    drawRateLine(birthRates, COLOR_ORANGE, yOfRate);

    drawSeries(foodData, COLOR_GREEN, 0.1);
    drawSeries(popData,  COLOR_CYAN,  0.15);

    var lastPop  = popData[popData.length - 1];
    var lastFood = foodData[foodData.length - 1];
    var lastBirth = birthRates[birthRates.length - 1];
    var lastDeath = deathRates[deathRates.length - 1];

    ctx.font      = '10px monospace';
    ctx.textAlign = 'left';

    ctx.fillStyle = COLOR_CYAN;
    ctx.fillText(lastPop, padLeft + chartW + 5, yOf(lastPop) + 3);

    ctx.fillStyle = COLOR_GREEN;
    ctx.fillText(lastFood, padLeft + chartW + 5, yOf(lastFood) + 3);

    // Legend
    var legendX = w - padRight + 4;
    var legendY = 4;

    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    ctx.fillStyle = COLOR_CYAN;
    ctx.beginPath();
    ctx.arc(legendX, legendY + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_LABEL;
    ctx.fillText('Pop', legendX + 6, legendY + 7);

    ctx.fillStyle = COLOR_GREEN;
    ctx.beginPath();
    ctx.arc(legendX, legendY + 16, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_LABEL;
    ctx.fillText('Food', legendX + 6, legendY + 19);

    ctx.fillStyle = COLOR_ORANGE;
    ctx.beginPath();
    ctx.arc(legendX, legendY + 28, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_LABEL;
    ctx.fillText('B:' + lastBirth, legendX + 6, legendY + 31);

    ctx.fillStyle = COLOR_RED;
    ctx.beginPath();
    ctx.arc(legendX, legendY + 38, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_LABEL;
    ctx.fillText('D:' + lastDeath, legendX + 6, legendY + 41);
  };

  Stats.prototype.renderSpeciesChart = function () {
    var ctx = this.speciesCtx;
    if (!ctx) return;

    var w = this.speciesCanvas.width;
    var h = this.speciesCanvas.height;
    var hist = this.speciesHistory;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    if (hist.length < 2) {
      ctx.fillStyle = COLOR_DIM;
      ctx.font      = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data...', w / 2, h / 2);
      return;
    }

    var padTop    = 4;
    var padBottom = 4;
    var padLeft   = 2;
    var padRight  = 2;
    var chartW    = w - padLeft - padRight;
    var chartH    = h - padTop - padBottom;
    var len       = hist.length;

    var speciesSet = {};
    var i, j, key;
    for (i = 0; i < len; i++) {
      for (key in hist[i].distribution) {
        if (hist[i].distribution.hasOwnProperty(key)) {
          speciesSet[key] = true;
        }
      }
    }
    var speciesIds = Object.keys(speciesSet);
    if (speciesIds.length === 0) return;
    speciesIds.sort();

    var proportions = [];
    for (i = 0; i < len; i++) {
      var total = hist[i].total || 1;
      var row = [];
      for (j = 0; j < speciesIds.length; j++) {
        var count = hist[i].distribution[speciesIds[j]] || 0;
        row.push(count / total);
      }
      proportions.push(row);
    }

    function xOf(idx) {
      return padLeft + (idx / (len - 1)) * chartW;
    }

    var numSpecies = speciesIds.length;

    for (j = 0; j < numSpecies; j++) {
      var hue = parseHueFromSpeciesId(speciesIds[j]);

      ctx.fillStyle   = 'hsla(' + hue + ',70%,55%,0.75)';
      ctx.strokeStyle = 'hsla(' + hue + ',70%,55%,0.35)';
      ctx.lineWidth   = 0.5;

      ctx.beginPath();

      var firstTopY = padTop + chartH - cumulativeFraction(proportions, 0, j) * chartH;
      ctx.moveTo(xOf(0), firstTopY);

      for (i = 1; i < len; i++) {
        var topY = padTop + chartH - cumulativeFraction(proportions, i, j) * chartH;
        var cpx  = (xOf(i - 1) + xOf(i)) / 2;
        var prevTopY = padTop + chartH - cumulativeFraction(proportions, i - 1, j) * chartH;
        ctx.quadraticCurveTo(cpx, prevTopY, xOf(i), topY);
      }

      var lastBotY = padTop + chartH - cumulativeFractionBelow(proportions, len - 1, j) * chartH;
      ctx.lineTo(xOf(len - 1), lastBotY);

      for (i = len - 2; i >= 0; i--) {
        var botY = padTop + chartH - cumulativeFractionBelow(proportions, i, j) * chartH;
        var cpx2 = (xOf(i + 1) + xOf(i)) / 2;
        var prevBotY = padTop + chartH - cumulativeFractionBelow(proportions, i + 1, j) * chartH;
        ctx.quadraticCurveTo(cpx2, prevBotY, xOf(i), botY);
      }

      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Species count overlay
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(numSpecies + ' species', w - padRight - 4, padTop + 2);
  };

  function cumulativeFraction(proportions, col, speciesIndex) {
    var sum = 0;
    for (var k = 0; k <= speciesIndex; k++) {
      sum += proportions[col][k];
    }
    return sum;
  }

  function cumulativeFractionBelow(proportions, col, speciesIndex) {
    var sum = 0;
    for (var k = 0; k < speciesIndex; k++) {
      sum += proportions[col][k];
    }
    return sum;
  }

  function parseHueFromSpeciesId(speciesId) {
    if (typeof speciesId !== 'string') return hashToHue(String(speciesId));
    var parts = speciesId.split('_');
    var hue = parseInt(parts[0], 10);
    if (isNaN(hue)) return hashToHue(speciesId);
    return hue % 360;
  }

  function hashToHue(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 360;
  }

  function hexToRGBA(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ---------------------------------------------------------------
  // Evolution timeline — population-average traits over time
  // ---------------------------------------------------------------
  var EVO_TRAITS = [
    { key: 'size',       label: 'Size',  color: '#00d4ff', min: 4,   max: 14 },
    { key: 'speed',      label: 'Spd',   color: '#7cff6b', min: 1,   max: 3.5 },
    { key: 'aggression', label: 'Aggr',  color: '#ff4757', min: 0,   max: 1 },
    { key: 'efficiency', label: 'Eff',   color: '#ffa502', min: 0.5, max: 1.5 }
  ];

  Stats.prototype.renderEvoChart = function () {
    var ctx = this.evoCtx;
    if (!ctx) return;

    var w = this.evoCanvas.width;
    var h = this.evoCanvas.height;
    var hist = this.evoHistory;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    if (hist.length < 2) {
      ctx.fillStyle = COLOR_DIM;
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data...', w / 2, h / 2);
      return;
    }

    var padTop    = 8;
    var padBottom = 4;
    var padLeft   = 2;
    var padRight  = 42;
    var chartW    = w - padLeft - padRight;
    var chartH    = h - padTop - padBottom;
    var len       = hist.length;

    function xOf(idx) {
      return padLeft + (idx / (len - 1)) * chartW;
    }

    // Draw grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    var midY = padTop + chartH * 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, midY);
    ctx.lineTo(padLeft + chartW, midY);
    ctx.stroke();

    // Draw each trait as a normalized line (0-1 within its range)
    var ti, i, trait, val, normVal, y, prevY, cpx;

    for (ti = 0; ti < EVO_TRAITS.length; ti++) {
      trait = EVO_TRAITS[ti];
      ctx.beginPath();
      ctx.strokeStyle = trait.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;

      val = hist[0][trait.key];
      normVal = (val - trait.min) / (trait.max - trait.min);
      normVal = Math.max(0, Math.min(1, normVal));
      y = padTop + chartH - normVal * chartH;
      ctx.moveTo(xOf(0), y);

      for (i = 1; i < len; i++) {
        val = hist[i][trait.key];
        normVal = (val - trait.min) / (trait.max - trait.min);
        normVal = Math.max(0, Math.min(1, normVal));
        prevY = y;
        y = padTop + chartH - normVal * chartH;
        cpx = (xOf(i - 1) + xOf(i)) / 2;
        ctx.quadraticCurveTo(cpx, prevY, xOf(i), y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // End label
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = trait.color;
      ctx.fillText(trait.label, padLeft + chartW + 4, y + 3);
    }
  };

  Stats.prototype.renderStatsPanel = function () {
    if (!this.statsPanel || !this.lastStats) return;

    var s = this.lastStats;

    var oldestAge  = (s.oldestCreature && s.oldestCreature.age !== undefined) ? s.oldestCreature.age : 0;
    var mostFitVal = 0;
    if (s.mostFitCreature) {
      mostFitVal = s.mostFitCreature.children !== undefined
        ? s.mostFitCreature.children
        : s.mostFitCreature.generation;
    }

    var rows = [
      { label: 'Tick',       value: s.tick },
      { label: 'Generation', value: s.maxGeneration },
      { label: 'Population', value: s.population },
      { label: 'Food',       value: s.foodCount },
      { label: 'Births',     value: s.totalBirths },
      { label: 'Deaths',     value: s.totalDeaths },
      { label: 'Avg Energy', value: s.avgEnergy.toFixed(1) },
      { label: 'Avg Age',    value: Math.round(s.avgAge) },
      { label: 'Avg Size',   value: s.avgSize.toFixed(1) },
      { label: 'Species',    value: s.speciesCount },
      { label: 'Oldest',     value: oldestAge },
      { label: 'Most Fit',   value: mostFitVal + ' offspring' }
    ];

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="stat-row">' +
        '<span class="stat-label">' + rows[i].label + '</span>' +
        '<span class="stat-value">' + rows[i].value + '</span>' +
        '</div>';
    }

    if (html !== this.lastPanelHTML) {
      this.statsPanel.innerHTML = html;
      this.lastPanelHTML = html;
    }
  };

  Stats.prototype.getFrameRate = function () {
    var ts = this.frameTimestamps;
    if (ts.length < 2) return 0;
    var elapsed = ts[ts.length - 1] - ts[0];
    if (elapsed <= 0) return 0;
    return ((ts.length - 1) / elapsed) * 1000;
  };

  Stats.prototype.getInfoOverlayText = function (stats) {
    var s = stats || this.lastStats;
    if (!s) return '';
    var fps = this.getFrameRate();
    return 'Gen: ' + s.maxGeneration +
      ' | Pop: ' + s.population +
      ' | FPS: ' + Math.round(fps);
  };

  Stats.prototype.reset = function () {
    this.populationHistory = [];
    this.speciesHistory    = [];
    this.evoHistory        = [];
    this.frameTimestamps   = [];
    this.frameCount        = 0;
    this.lastStats         = null;
    this.lastPanelHTML     = '';

    if (this.popCtx) {
      this.popCtx.clearRect(0, 0, this.popCanvas.width, this.popCanvas.height);
    }
    if (this.speciesCtx) {
      this.speciesCtx.clearRect(0, 0, this.speciesCanvas.width, this.speciesCanvas.height);
    }
    if (this.evoCtx) {
      this.evoCtx.clearRect(0, 0, this.evoCanvas.width, this.evoCanvas.height);
    }
    if (this.statsPanel) {
      this.statsPanel.innerHTML = '';
    }
  };

  EcoSim.Stats = Stats;

})();
