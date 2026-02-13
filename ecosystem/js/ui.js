/**
 * EcoSim UI Controller
 *
 * Provides EcoSim.UI -- handles all user interaction including buttons,
 * canvas clicks, keyboard shortcuts, and inspector panel updates.
 */
(function () {
  'use strict';

  var Config = EcoSim.Config;
  var Events = EcoSim.Events;

  function UI(world, renderer, stats) {
    this.world = world;
    this.renderer = renderer;
    this.stats = stats;

    this.addFoodMode = false;
    this.showFamily = false;
    this.speed = 1;
    this._frameCount = 0;

    this.canvas = document.getElementById('world-canvas');
    this.creatureInspector = document.getElementById('creature-inspector');
    this.creatureDetails = document.getElementById('creature-details');
    this.infoOverlay = document.getElementById('info-overlay');
    this.addFoodBtn = document.getElementById('add-food-btn');
    this.spawnBtn = document.getElementById('spawn-btn');
    this.resetBtn = document.getElementById('reset-btn');
    this.speedBtns = document.querySelectorAll('.speed-btn');
    this.toggleBtns = document.querySelectorAll('.toggle-btn');

    this.downloadBtn = document.getElementById('download-btn');
    this.uploadBtn = document.getElementById('upload-btn');
    this.uploadInput = document.getElementById('upload-input');
    this.universeSaveBtn = document.getElementById('universe-save-btn');
    this.universeNewBtn = document.getElementById('universe-new-btn');
    this.universeNameEl = document.getElementById('universe-name');
    this.universeListEl = document.getElementById('universe-list');
    this.autosaveIndicator = document.getElementById('autosave-indicator');

    this.creatureExportBtn = document.getElementById('creature-export-btn');
    this.creatureImportBtn = document.getElementById('creature-import-btn');
    this.creatureImportInput = document.getElementById('creature-import-input');

    this.bindEvents();
    this.initSettings();
    this.initUniversePanel();
  }

  UI.prototype.bindEvents = function () {
    var self = this;
    var world = this.world;
    var renderer = this.renderer;
    var canvas = this.canvas;

    // 1. Speed buttons
    this.speedBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var speed = parseInt(btn.getAttribute('data-speed'), 10);

        self.speedBtns.forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');

        self.speed = speed;

        if (speed === 0) {
          world.paused = true;
        } else {
          world.paused = false;
          Config.TICKS_PER_FRAME = speed;
        }
      });
    });

    // 2. Toggle buttons
    this.toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.classList.toggle('active');

        var toggle = btn.getAttribute('data-toggle');
        var isActive = btn.classList.contains('active');

        if (toggle === 'trails') {
          renderer.showTrails = isActive;
        } else if (toggle === 'vision') {
          renderer.showVision = isActive;
        }
      });
    });

    // 3. Add Food button
    if (this.addFoodBtn) {
      this.addFoodBtn.addEventListener('click', function () {
        self.addFoodMode = !self.addFoodMode;
        self.addFoodBtn.classList.toggle('active', self.addFoodMode);
        canvas.style.cursor = self.addFoodMode ? 'crosshair' : 'default';
      });
    }

    // 4. Spawn button
    if (this.spawnBtn) {
      this.spawnBtn.addEventListener('click', function () {
        var x = Math.random() * world.width;
        var y = Math.random() * world.height;
        world.addCreature(x, y);
      });
    }

    // 5. Reset button
    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', function () {
        world.reset();
        self.stats.reset();
        self._resetUIState();
      });
    }

    // 5b. Screenshot button
    var screenshotBtn = document.getElementById('screenshot-btn');
    if (screenshotBtn) {
      screenshotBtn.addEventListener('click', function () {
        self.takeScreenshot();
      });
    }

    // 5c. Camera buttons
    var cameraResetBtn = document.getElementById('camera-reset-btn');
    if (cameraResetBtn) {
      cameraResetBtn.addEventListener('click', function () {
        renderer.resetCamera();
      });
    }

    var cameraFollowBtn = document.getElementById('camera-follow-btn');
    if (cameraFollowBtn) {
      cameraFollowBtn.addEventListener('click', function () {
        if (world.selectedCreature && world.selectedCreature.alive) {
          renderer.camera.x = world.selectedCreature.x;
          renderer.camera.y = world.selectedCreature.y;
          if (renderer.camera.zoom < 2) {
            renderer.camera.zoom = 3; // zoom in to follow
          }
        }
      });
    }

    // 5d. Sound toggle button
    var soundToggleBtn = document.getElementById('sound-toggle-btn');
    if (soundToggleBtn) {
      soundToggleBtn.addEventListener('click', function () {
        if (EcoSim.Sound) {
          var nowEnabled = EcoSim.Sound.toggle();
          soundToggleBtn.textContent = nowEnabled ? 'Sound On (m)' : 'Sound Off (m)';
          soundToggleBtn.classList.toggle('active', nowEnabled);
        }
      });
    }

    // 5e. Family button
    var familyBtn = document.getElementById('family-btn');
    if (familyBtn) {
      familyBtn.addEventListener('click', function () {
        self.showFamily = !self.showFamily;
        familyBtn.classList.toggle('active', self.showFamily);
      });
    }

    // 5f. Export/Import buttons
    if (this.downloadBtn) {
      this.downloadBtn.addEventListener('click', function () {
        if (EcoSim.Serialization) {
          EcoSim.Serialization.downloadSave(world);
        }
      });
    }

    if (this.uploadBtn && this.uploadInput) {
      this.uploadBtn.addEventListener('click', function () {
        self.uploadInput.click();
      });
      this.uploadInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file || !EcoSim.Serialization) return;
        EcoSim.Serialization.loadFromFile(world, file, function (err, name) {
          if (err) {
            self.uploadBtn.textContent = 'Error';
          } else {
            self.stats.reset();
            self._resetUIState();
            self.refreshUniversePanel();
            self.uploadBtn.textContent = 'Imported!';
          }
          setTimeout(function () { self.uploadBtn.textContent = 'Import'; }, 1500);
        });
        self.uploadInput.value = '';
      });
    }

    // 5g. Creature Export/Import buttons
    if (this.creatureExportBtn) {
      this.creatureExportBtn.addEventListener('click', function () {
        self.exportCreature();
      });
    }

    if (this.creatureImportBtn && this.creatureImportInput) {
      this.creatureImportBtn.addEventListener('click', function () {
        self.creatureImportInput.click();
      });
      this.creatureImportInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        self.importCreature(file);
        self.creatureImportInput.value = '';
      });
    }

    // Helper: convert page click coords to world coords (uses renderer camera transform)
    function canvasToWorld(event) {
      var rect = canvas.getBoundingClientRect();
      var px = event.clientX - rect.left;
      var py = event.clientY - rect.top;
      return renderer.screenToWorld(px, py);
    }

    // 6. Canvas click
    if (canvas) {
      canvas.addEventListener('click', function (event) {
        var pos = canvasToWorld(event);
        var x = pos.x;
        var y = pos.y;

        if (self.addFoodMode) {
          for (var i = 0; i < 5; i++) {
            var offsetX = (Math.random() - 0.5) * 30;
            var offsetY = (Math.random() - 0.5) * 30;
            world.addFood(x + offsetX, y + offsetY);
          }
        } else {
          world.selectCreature(x, y);
        }

        self.updateCreatureInspector();
      });

      // 7. Canvas mousemove
      canvas.addEventListener('mousemove', function (event) {
        if (self.addFoodMode) return;

        var pos = canvasToWorld(event);
        var x = pos.x;
        var y = pos.y;

        var creatures = world.creatures;
        var hoverRadius = 20 * 20;
        var hovering = false;

        for (var i = 0; i < creatures.length; i++) {
          var c = creatures[i];
          var dx = x - c.x;
          var dy = y - c.y;
          if (dx * dx + dy * dy < hoverRadius) {
            hovering = true;
            break;
          }
        }

        canvas.style.cursor = hovering ? 'pointer' : 'default';
      });
    }

    // 8. Mouse wheel zoom
    if (canvas) {
      canvas.addEventListener('wheel', function (event) {
        event.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var sx = event.clientX - rect.left;
        var sy = event.clientY - rect.top;
        var factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        renderer.zoomAt(sx, sy, factor);
      }, { passive: false });

      // 8b. Right-click drag to pan camera
      var isPanning = false;
      var panStartX = 0;
      var panStartY = 0;
      var panStartCamX = 0;
      var panStartCamY = 0;

      canvas.addEventListener('mousedown', function (event) {
        if (event.button === 2) { // right-click
          isPanning = true;
          panStartX = event.clientX;
          panStartY = event.clientY;
          panStartCamX = renderer.camera.x;
          panStartCamY = renderer.camera.y;
          canvas.style.cursor = 'grabbing';
          event.preventDefault();
        }
      });

      document.addEventListener('mousemove', function (event) {
        if (!isPanning) return;
        var dx = event.clientX - panStartX;
        var dy = event.clientY - panStartY;
        renderer.camera.x = panStartCamX - dx / renderer._scale;
        renderer.camera.y = panStartCamY - dy / renderer._scale;
      });

      document.addEventListener('mouseup', function (event) {
        if (event.button === 2 && isPanning) {
          isPanning = false;
          canvas.style.cursor = self.addFoodMode ? 'crosshair' : 'default';
        }
      });

      // Prevent context menu on canvas (for right-click pan)
      canvas.addEventListener('contextmenu', function (event) {
        event.preventDefault();
      });

      // 8c. Double-click to toggle fullscreen
      canvas.addEventListener('dblclick', function () {
        self.toggleFullscreen();
      });
    }

    // 9. Keyboard shortcuts
    document.addEventListener('keydown', function (event) {
      var tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      var key = event.key;

      switch (key) {
        case ' ':
          event.preventDefault();
          self._togglePause();
          break;
        case '1':
          self._clickSpeedButton(1);
          break;
        case '2':
          self._clickSpeedButton(2);
          break;
        case '3':
          self._clickSpeedButton(5);
          break;
        case '4':
          self._clickSpeedButton(10);
          break;
        case 'f':
          if (self.addFoodBtn) self.addFoodBtn.click();
          break;
        case 't':
          self._clickToggleButton('trails');
          break;
        case 'v':
          self._clickToggleButton('vision');
          break;
        case 'Escape':
          world.selectedCreature = null;
          self.updateCreatureInspector();
          break;
        // Camera controls
        case 'w': case 'W':
          renderer.camera.y -= 30 / renderer.camera.zoom;
          break;
        case 'a': case 'A':
          renderer.camera.x -= 30 / renderer.camera.zoom;
          break;
        case 's': case 'S':
          renderer.camera.y += 30 / renderer.camera.zoom;
          break;
        case 'd': case 'D':
          renderer.camera.x += 30 / renderer.camera.zoom;
          break;
        case '=': case '+':
          renderer.camera.zoom = Math.min(12, renderer.camera.zoom * 1.2);
          break;
        case '-': case '_':
          renderer.camera.zoom = Math.max(0.5, renderer.camera.zoom / 1.2);
          break;
        case 'Home':
          renderer.resetCamera();
          break;
        case 'c':
          if (world.selectedCreature && world.selectedCreature.alive) {
            renderer.camera.x = world.selectedCreature.x;
            renderer.camera.y = world.selectedCreature.y;
            if (renderer.camera.zoom < 2) {
              renderer.camera.zoom = 3;
            }
          }
          break;
        case 'p':
          self.takeScreenshot();
          break;
        case 'g':
          self.showFamily = !self.showFamily;
          var fBtn = document.getElementById('family-btn');
          if (fBtn) fBtn.classList.toggle('active', self.showFamily);
          break;
        case 'm':
          if (EcoSim.Sound) {
            var soundNowEnabled = EcoSim.Sound.toggle();
            var sBtn = document.getElementById('sound-toggle-btn');
            if (sBtn) {
              sBtn.textContent = soundNowEnabled ? 'Sound On (m)' : 'Sound Off (m)';
              sBtn.classList.toggle('active', soundNowEnabled);
            }
          }
          break;
      }
    });

    // 9. Window resize
    window.addEventListener('resize', function () {
      if (renderer && typeof renderer.resize === 'function') {
        renderer.resize();
      }
    });
  };

  UI.prototype._togglePause = function () {
    if (this.world.paused) {
      var restoreSpeed = this.speed > 0 ? this.speed : 1;
      this._clickSpeedButton(restoreSpeed);
    } else {
      this._clickSpeedButton(0);
    }
  };

  UI.prototype._clickSpeedButton = function (speed) {
    var btns = this.speedBtns;
    for (var i = 0; i < btns.length; i++) {
      var btnSpeed = parseInt(btns[i].getAttribute('data-speed'), 10);
      if (btnSpeed === speed) {
        btns[i].click();
        return;
      }
    }
  };

  UI.prototype._clickToggleButton = function (name) {
    var btns = this.toggleBtns;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-toggle') === name) {
        btns[i].click();
        return;
      }
    }
  };

  UI.prototype._resetUIState = function () {
    this._clickSpeedButton(1);

    if (this.addFoodMode) {
      this.addFoodMode = false;
      if (this.addFoodBtn) this.addFoodBtn.classList.remove('active');
      if (this.canvas) this.canvas.style.cursor = 'default';
    }

    this.updateCreatureInspector();
  };

  // Gene display config: name, color, range key
  var GENE_DISPLAY = [
    { key: 'size',       label: 'Size',    color: '#00d4ff' },
    { key: 'maxSpeed',   label: 'Speed',   color: '#7cff6b' },
    { key: 'turnSpeed',  label: 'Turn',    color: '#50e8d0' },
    { key: 'aggression', label: 'Aggro',   color: '#ff4757' },
    { key: 'efficiency', label: 'Eff',     color: '#ffa502' },
    { key: 'saturation', label: 'Sat',     color: '#a55eea' },
    { key: 'luminosity', label: 'Lum',     color: '#00e5c8' }
  ];

  var GENE_RANGES = {
    size:       { min: Config.CREATURE_MIN_SIZE, max: Config.CREATURE_MAX_SIZE },
    maxSpeed:   { min: 1, max: Config.CREATURE_MAX_SPEED },
    turnSpeed:  { min: 0.05, max: 0.2 },
    saturation: { min: 40, max: 100 },
    aggression: { min: 0, max: 1 },
    efficiency: { min: 0.5, max: 1.5 },
    luminosity: { min: 0.3, max: 1.0 }
  };

  UI.prototype.updateCreatureInspector = function () {
    var details = this.creatureDetails;
    if (!details) return;

    var creature = this.world.selectedCreature;
    var genomeViewer = document.getElementById('genome-viewer');
    var inspectorActions = document.getElementById('inspector-actions');

    if (creature && creature.alive) {
      var g = creature.bodyGenes;
      var rows = [
        'ID: ' + creature.id + ' | Gen: ' + creature.generation,
        'Age: ' + creature.age + ' | Energy: ' + creature.energy.toFixed(1),
        'Size: ' + creature.size.toFixed(1) + ' | Max Speed: ' + g.maxSpeed.toFixed(1),
        'Food Eaten: ' + creature.foodEaten + ' | Kills: ' + creature.kills,
        'Children: ' + creature.children + (creature.parentId ? ' | Parent: #' + creature.parentId : ''),
        'Species: ' + creature.speciesId,
        'Efficiency: ' + g.efficiency.toFixed(2) + ' | Aggression: ' + g.aggression.toFixed(2),
        'Signal: ' + (creature.signal || 0).toFixed(2)
      ];

      var html = '';
      for (var i = 0; i < rows.length; i++) {
        html += '<div class="inspector-row">' + rows[i] + '</div>';
      }
      details.innerHTML = html;

      // Genome viewer — gene bars
      if (genomeViewer) {
        var avgs = this.world.getPopulationGeneAverages();
        var ghtml = '';

        for (var gi = 0; gi < GENE_DISPLAY.length; gi++) {
          var gd = GENE_DISPLAY[gi];
          var range = GENE_RANGES[gd.key];
          var val = g[gd.key];
          var span = range.max - range.min;
          var pct = Math.max(0, Math.min(100, ((val - range.min) / span) * 100));

          var avgPct = 50;
          if (avgs && avgs[gd.key] !== undefined) {
            avgPct = Math.max(0, Math.min(100, ((avgs[gd.key] - range.min) / span) * 100));
          }

          // Display value
          var dispVal = val.toFixed(gd.key === 'aggression' ? 2 : 1);

          ghtml += '<div class="gene-row">';
          ghtml += '<span class="gene-label">' + gd.label + '</span>';
          ghtml += '<div class="gene-bar-track">';
          ghtml += '<div class="gene-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + gd.color + ';opacity:0.7"></div>';
          ghtml += '<div class="gene-bar-avg" style="left:' + avgPct.toFixed(1) + '%" title="Pop avg"></div>';
          ghtml += '</div>';
          ghtml += '<span class="gene-value">' + dispVal + '</span>';
          ghtml += '</div>';
        }

        genomeViewer.innerHTML = ghtml;
      }

      // Show inspector actions
      if (inspectorActions) {
        inspectorActions.style.display = '';
      }

      if (this.creatureInspector) {
        this.creatureInspector.classList.add('visible');
      }
    } else {
      details.innerHTML = '<div class="inspector-row" style="color: rgba(255,255,255,0.4)">Click a creature to inspect</div>';

      if (genomeViewer) genomeViewer.innerHTML = '';
      if (inspectorActions) inspectorActions.style.display = 'none';

      // Turn off family view when deselecting
      if (this.showFamily) {
        this.showFamily = false;
        var fBtn = document.getElementById('family-btn');
        if (fBtn) fBtn.classList.remove('active');
      }

      if (this.creatureInspector) {
        this.creatureInspector.classList.remove('visible');
      }
    }
  };

  UI.prototype.updateInfoOverlay = function (stats) {
    if (!this.infoOverlay) return;

    if (stats && typeof stats.getInfoOverlayText === 'function') {
      this.infoOverlay.textContent = stats.getInfoOverlayText();
    }
  };

  UI.prototype.update = function () {
    this._frameCount++;

    if (this.world.selectedCreature && !this.world.selectedCreature.alive) {
      this.world.selectedCreature = null;
      this.updateCreatureInspector();
    }

    this.updateInfoOverlay(this.stats);

    if (this._frameCount % 10 === 0) {
      this.updateCreatureInspector();
    }

    // Sync showFamily flag to renderer
    this.renderer.showFamily = this.showFamily;

    // Follow selected creature when zoomed in
    var cam = this.renderer.camera;
    if (cam.zoom > 1.2 && this.world.selectedCreature && this.world.selectedCreature.alive) {
      // Smooth lerp toward creature position
      var target = this.world.selectedCreature;
      cam.x += (target.x - cam.x) * 0.08;
      cam.y += (target.y - cam.y) * 0.08;
    }

    // Update zoom indicator
    var zoomEl = document.getElementById('zoom-indicator');
    if (zoomEl) {
      var zoom = this.renderer.camera.zoom;
      if (Math.abs(zoom - 1) > 0.05) {
        zoomEl.textContent = zoom.toFixed(1) + 'x';
        zoomEl.classList.add('visible');
      } else {
        zoomEl.classList.remove('visible');
      }
    }
  };

  UI.prototype.initUniversePanel = function () {
    var self = this;
    var world = this.world;
    var Ser = EcoSim.Serialization;
    if (!Ser) return;

    // Save button — save current universe (or create new one)
    if (this.universeSaveBtn) {
      this.universeSaveBtn.addEventListener('click', function () {
        if (!Ser.currentUniverse) {
          // No active universe — create one
          var name = Ser.generateName();
          Ser.saveUniverse(world, name);
        } else {
          Ser.saveUniverse(world, Ser.currentUniverse);
        }
        self.refreshUniversePanel();
        self._flashButton(self.universeSaveBtn, 'Saved!', 'Save');
      });
    }

    // New button — save current to new universe
    if (this.universeNewBtn) {
      this.universeNewBtn.addEventListener('click', function () {
        var name = Ser.generateName();
        Ser.saveUniverse(world, name);
        self.refreshUniversePanel();
        self._flashButton(self.universeNewBtn, 'Created!', 'New');
      });
    }

    this.refreshUniversePanel();
  };

  UI.prototype.refreshUniversePanel = function () {
    var self = this;
    var world = this.world;
    var Ser = EcoSim.Serialization;
    if (!Ser) return;

    // Update current universe name
    if (this.universeNameEl) {
      this.universeNameEl.textContent = Ser.currentUniverse || 'Unsaved';
    }

    // Build universe list
    if (!this.universeListEl) return;
    var index = Ser.getUniverseIndex();
    var html = '';

    for (var i = 0; i < index.length; i++) {
      var u = index[i];
      var isActive = u.name === Ser.currentUniverse;
      var ago = self._timeAgo(u.savedAt);
      html += '<div class="universe-slot' + (isActive ? ' active' : '') + '" data-universe="' + self._escHtml(u.name) + '">';
      html += '<span class="universe-slot-name">' + self._escHtml(u.name) + '</span>';
      html += '<span class="universe-slot-info">Gen ' + u.generation + ' | ' + ago + '</span>';
      html += '<span class="universe-slot-delete" data-delete="' + self._escHtml(u.name) + '">&times;</span>';
      html += '</div>';
    }

    if (index.length === 0) {
      html = '<div style="font-size:10px;color:rgba(255,255,255,0.3);text-align:center;padding:8px 0">No saved universes</div>';
    }

    this.universeListEl.innerHTML = html;

    // Bind click handlers
    var slots = this.universeListEl.querySelectorAll('.universe-slot');
    for (var j = 0; j < slots.length; j++) {
      (function (slot) {
        slot.addEventListener('click', function (e) {
          // Check if delete button was clicked
          if (e.target.classList.contains('universe-slot-delete')) {
            var delName = e.target.getAttribute('data-delete');
            if (delName) {
              Ser.deleteUniverse(delName);
              self.refreshUniversePanel();
            }
            return;
          }
          // Load this universe
          var name = slot.getAttribute('data-universe');
          if (name && name !== Ser.currentUniverse) {
            // Auto-save current universe before switching
            if (Ser.currentUniverse) {
              Ser.saveUniverse(world, Ser.currentUniverse);
            }
            Ser.loadUniverse(world, name);
            self.stats.reset();
            self._resetUIState();
            self.refreshUniversePanel();
          }
        });
      })(slots[j]);
    }
  };

  UI.prototype.showAutoSaveIndicator = function () {
    var indicator = this.autosaveIndicator;
    if (!indicator) return;
    indicator.textContent = 'auto-saved';
    indicator.classList.add('visible');
    clearTimeout(this._autosaveTimeout);
    this._autosaveTimeout = setTimeout(function () {
      indicator.classList.remove('visible');
    }, 2000);
  };

  UI.prototype._flashButton = function (btn, flashText, normalText) {
    if (!btn) return;
    btn.textContent = flashText;
    setTimeout(function () { btn.textContent = normalText; }, 1500);
  };

  UI.prototype._escHtml = function (str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  UI.prototype._timeAgo = function (timestamp) {
    if (!timestamp) return '';
    var diff = Date.now() - timestamp;
    var secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  };

  // ---------------------------------------------------------------
  // Creature Export — download selected creature genome as JSON
  // ---------------------------------------------------------------
  UI.prototype.exportCreature = function () {
    var creature = this.world.selectedCreature;
    if (!creature || !creature.alive) {
      return;
    }

    // Get brain genome and convert Float32Arrays to regular arrays (4 decimal places)
    var genome = creature.brain.getGenome();
    var exportData = {
      version: 1,
      type: 'ecosim_creature',
      exportedAt: Date.now(),
      creature: {
        generation: creature.generation,
        bodyGenes: {
          size: creature.bodyGenes.size,
          maxSpeed: creature.bodyGenes.maxSpeed,
          turnSpeed: creature.bodyGenes.turnSpeed,
          hue: creature.bodyGenes.hue,
          saturation: creature.bodyGenes.saturation,
          aggression: creature.bodyGenes.aggression,
          efficiency: creature.bodyGenes.efficiency,
          luminosity: creature.bodyGenes.luminosity !== undefined ? creature.bodyGenes.luminosity : 0.7
        },
        brain: {
          w1: f32ToArr(genome.weights1),
          b1: f32ToArr(genome.biases1),
          w2: f32ToArr(genome.weights2),
          b2: f32ToArr(genome.biases2),
          w3: f32ToArr(genome.weights3),
          b3: f32ToArr(genome.biases3)
        },
        stats: {
          kills: creature.kills,
          foodEaten: creature.foodEaten,
          children: creature.children,
          age: creature.age
        }
      }
    };

    var json = JSON.stringify(exportData, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'creature_gen' + creature.generation + '_id' + creature.id + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------
  // Creature Import — load creature genome from JSON file
  // ---------------------------------------------------------------
  UI.prototype.importCreature = function (file) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);

        // Validate file type
        if (data.type !== 'ecosim_creature') {
          console.warn('EcoSim: Invalid creature file — missing type field');
          self._flashButton(self.creatureImportBtn, 'Invalid file', 'Import Creature');
          return;
        }

        var cd = data.creature;

        // Convert brain arrays back to Float32Arrays
        var genome = {
          weights1: new Float32Array(cd.brain.w1),
          biases1:  new Float32Array(cd.brain.b1),
          weights2: new Float32Array(cd.brain.w2),
          biases2:  new Float32Array(cd.brain.b2),
          weights3: new Float32Array(cd.brain.w3),
          biases3:  new Float32Array(cd.brain.b3)
        };

        // Spawn at random position
        var x = Math.random() * self.world.width;
        var y = Math.random() * self.world.height;

        var creature = new EcoSim.Creature({
          x: x,
          y: y,
          bodyGenes: cd.bodyGenes,
          genome: genome,
          generation: cd.generation
        });

        self.world.creatures.push(creature);
        self._flashButton(self.creatureImportBtn, 'Imported!', 'Import Creature');
      } catch (err) {
        console.error('EcoSim: Failed to import creature', err);
        self._flashButton(self.creatureImportBtn, 'Error', 'Import Creature');
      }
    };
    reader.readAsText(file);
  };

  // ---------------------------------------------------------------
  // Helper: convert Float32Array to plain Array with 4 decimal places
  // ---------------------------------------------------------------
  function f32ToArr(f32) {
    var arr = new Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      arr[i] = Math.round(f32[i] * 10000) / 10000;
    }
    return arr;
  }

  // ---------------------------------------------------------------
  // Screenshot — download canvas as PNG
  // ---------------------------------------------------------------
  UI.prototype.takeScreenshot = function () {
    var canvas = this.canvas;
    if (!canvas) return;
    var url = canvas.toDataURL('image/png');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ecosim_t' + this.world.tick + '_gen' + this.world.maxGeneration + '.png';
    a.click();
  };

  // ---------------------------------------------------------------
  // Fullscreen toggle
  // ---------------------------------------------------------------
  UI.prototype.toggleFullscreen = function () {
    var container = document.getElementById('world-container');
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen();
    }
  };

  UI.prototype.initSettings = function () {
    var toggle = document.getElementById('settings-toggle');
    var content = document.getElementById('settings-content');
    var arrow = document.getElementById('settings-arrow');

    if (toggle && content) {
      toggle.addEventListener('click', function () {
        content.classList.toggle('collapsed');
        arrow.textContent = content.classList.contains('collapsed') ? '\u25BC' : '\u25B2';
      });
    }

    var sliders = [
      { id: 'slider-mutation-rate', valId: 'val-mutation-rate', key: 'MUTATION_RATE',
        toConfig: function (v) { return v / 100; },
        toDisplay: function (v) { return v + '%'; } },
      { id: 'slider-mutation-strength', valId: 'val-mutation-strength', key: 'MUTATION_STRENGTH',
        toConfig: function (v) { return v / 100; },
        toDisplay: function (v) { return (v / 100).toFixed(2); } },
      { id: 'slider-food-spawn', valId: 'val-food-spawn', key: 'FOOD_SPAWN_RATE',
        toConfig: function (v) { return v / 100; },
        toDisplay: function (v) { return (v / 100).toFixed(2); } },
      { id: 'slider-energy-drain', valId: 'val-energy-drain', key: 'CREATURE_ENERGY_DRAIN',
        toConfig: function (v) { return v / 100; },
        toDisplay: function (v) { return (v / 100).toFixed(2); } },
      { id: 'slider-day-cycle', valId: 'val-day-cycle', key: 'DAY_CYCLE_LENGTH',
        toConfig: function (v) { return parseInt(v, 10); },
        toDisplay: function (v) { return v; } }
    ];

    sliders.forEach(function (s) {
      var slider = document.getElementById(s.id);
      var valEl = document.getElementById(s.valId);
      if (!slider || !valEl) return;

      slider.addEventListener('input', function () {
        var raw = parseFloat(slider.value);
        Config[s.key] = s.toConfig(raw);
        valEl.textContent = s.toDisplay(raw);
      });
    });
  };

  EcoSim.UI = UI;

})();
