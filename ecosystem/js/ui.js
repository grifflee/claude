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

    // 5b. Export/Import buttons
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

    // Helper: convert page click coords to world coords (matching renderer transform)
    function canvasToWorld(event) {
      var rect = canvas.getBoundingClientRect();
      var logicalW = rect.width;
      var logicalH = rect.height;
      var scaleX = logicalW / world.width;
      var scaleY = logicalH / world.height;
      var scale = Math.min(scaleX, scaleY);
      var offsetX = (logicalW - world.width * scale) * 0.5;
      var offsetY = (logicalH - world.height * scale) * 0.5;
      var px = event.clientX - rect.left;
      var py = event.clientY - rect.top;
      return {
        x: (px - offsetX) / scale,
        y: (py - offsetY) / scale
      };
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

    // 8. Keyboard shortcuts
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

  UI.prototype.updateCreatureInspector = function () {
    var details = this.creatureDetails;
    if (!details) return;

    var creature = this.world.selectedCreature;

    if (creature && creature.alive) {
      var g = creature.bodyGenes;
      var rows = [
        'ID: ' + creature.id + ' | Gen: ' + creature.generation,
        'Age: ' + creature.age + ' | Energy: ' + creature.energy.toFixed(1),
        'Size: ' + creature.size.toFixed(1) + ' | Max Speed: ' + g.maxSpeed.toFixed(1),
        'Food Eaten: ' + creature.foodEaten + ' | Kills: ' + creature.kills,
        'Children: ' + creature.children,
        'Species: ' + creature.speciesId,
        'Efficiency: ' + g.efficiency.toFixed(2) + ' | Aggression: ' + g.aggression.toFixed(2)
      ];

      var html = '';
      for (var i = 0; i < rows.length; i++) {
        html += '<div class="inspector-row">' + rows[i] + '</div>';
      }
      details.innerHTML = html;

      if (this.creatureInspector) {
        this.creatureInspector.classList.add('visible');
      }
    } else {
      details.innerHTML = '<div class="inspector-row" style="color: rgba(255,255,255,0.4)">Click a creature to inspect</div>';

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
