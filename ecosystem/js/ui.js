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

    this.bindEvents();
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

  EcoSim.UI = UI;

})();
