/**
 * ChameleonPet — a small graphical desktop-pet-style widget for web pages.
 * Self-contained, no dependencies. Drop this script anywhere and call:
 *
 *   ChameleonPet.init();
 *
 * Targets (theme/resume/email buttons) are located generically via
 * data-chameleon-target="theme" | "resume" | "email" attributes, with
 * #theme-toggle / #resume-download / #email-link as ID fallbacks — so this
 * works on any site without editing this file, just tag your buttons.
 */
(function (global) {
  'use strict';

  const DEFAULT_CONFIG = {
    scale: 6, // internal-pixel -> screen-pixel multiplier
    groundOffset: 24, // px from bottom of viewport the pet's feet rest on
    wanderSpeed: 55, // px/sec
    palette: {
      body: '#4caf6b',
      bodyLight: '#7fd99a',
      bodyDark: '#2e7a4a',
      outline: '#1c3f28',
      eye: '#101010',
      tongue: '#e0567a',
    },
    targets: {
      theme: '[data-chameleon-target="theme"], #theme-toggle',
      resume: '[data-chameleon-target="resume"], #resume-download',
      email: '[data-chameleon-target="email"], #email-link',
    },
  };

  const STATE = {
    IDLE: 'idle',
    WANDER: 'wander',
    SEEK: 'seek',
    ON_TARGET: 'on_target',
    DRAGGING: 'dragging',
    FALLING: 'falling',
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  class ChameleonPet {
    constructor(config) {
      this.config = Object.assign({}, DEFAULT_CONFIG, config, {
        palette: Object.assign({}, DEFAULT_CONFIG.palette, config && config.palette),
        targets: Object.assign({}, DEFAULT_CONFIG.targets, config && config.targets),
      });

      this.reducedMotion =
        global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.x = rand(80, 300);
      this.y = 0; // set in resize()
      this.facing = 1; // 1 = right, -1 = left
      this.state = STATE.IDLE;
      this.stateTimer = 0;
      this.walkFrame = 0;
      this.walkFrameTimer = 0;
      this.tongueT = 0; // 0..1 progress of a tongue flick, 0 = retracted
      this.tongueActive = false;
      this.fadeT = 0; // 0 = fully visible, 1 = fully camouflaged
      this.fadeDir = 0;
      this.bob = 0;
      this.wanderTargetX = this.x;
      this.currentTargetKey = null;
      this.dragOffset = { x: 0, y: 0 };
      this.fallVelocity = 0;
      this.paletteOverride = null;
      this._raf = null;
      this._lastTime = performance.now();

      this._buildDom();
      this._bindEvents();
      this.resize();
      this._pickNewWanderTarget();
      this._loop = this._loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }

    // ---------- setup ----------

    _buildDom() {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.zIndex = '2147483000';
      canvas.style.pointerEvents = 'none'; // hitbox handled manually on the sprite region
      canvas.style.imageRendering = 'pixelated';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      // Offscreen low-res buffer the chameleon is drawn onto, then scaled up.
      this.spriteW = 40;
      this.spriteH = 24;
      this.buffer = document.createElement('canvas');
      this.buffer.width = this.spriteW;
      this.buffer.height = this.spriteH;
      this.bctx = this.buffer.getContext('2d');

      // Invisible hit-area element so the pet can receive pointer events
      // without the full-viewport canvas blocking clicks on the page.
      const hit = document.createElement('div');
      hit.style.position = 'fixed';
      hit.style.zIndex = '2147483001';
      hit.style.cursor = 'grab';
      hit.style.background = 'transparent';
      document.body.appendChild(hit);
      this.hitEl = hit;
    }

    _bindEvents() {
      global.addEventListener('resize', () => this.resize());

      this.hitEl.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      global.addEventListener('pointermove', (e) => this._onPointerMove(e));
      global.addEventListener('pointerup', (e) => this._onPointerUp(e));

      this.hitEl.addEventListener('click', () => this._onClicked());

      // React to real clicks on watched buttons even if the pet isn't there.
      for (const key of Object.keys(this.config.targets)) {
        const el = this._findTarget(key);
        if (el) {
          el.addEventListener('click', () => this._onTargetClicked(key));
        }
      }

      // If the site adds these buttons later (dev-in-progress sites), pick
      // them up without requiring a manual re-init.
      this._observer = new MutationObserver(() => {
        for (const key of Object.keys(this.config.targets)) {
          if (this._targetElCache && this._targetElCache[key]) continue;
          const el = this._findTarget(key);
          if (el && !el.dataset.chameleonBound) {
            el.dataset.chameleonBound = 'true';
            el.addEventListener('click', () => this._onTargetClicked(key));
          }
        }
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
    }

    _findTarget(key) {
      const selector = this.config.targets[key];
      if (!selector) return null;
      return document.querySelector(selector);
    }

    resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const cssW = global.innerWidth;
      const cssH = global.innerHeight;
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewW = cssW;
      this.viewH = cssH;
      this.groundY = cssH - this.config.groundOffset;
      this.y = this.groundY;
    }

    // ---------- pointer interaction ----------

    _onPointerDown(e) {
      if (this.state === STATE.FALLING) return;
      this.state = STATE.DRAGGING;
      this.hitEl.style.cursor = 'grabbing';
      this.dragOffset.x = e.clientX - this.x;
      this.dragOffset.y = e.clientY - this.y;
      this.hitEl.setPointerCapture(e.pointerId);
    }

    _onPointerMove(e) {
      if (this.state !== STATE.DRAGGING) return;
      const nx = e.clientX - this.dragOffset.x;
      const ny = e.clientY - this.dragOffset.y;
      this.facing = nx > this.x ? 1 : nx < this.x ? -1 : this.facing;
      this.x = clamp(nx, 20, this.viewW - 20);
      this.y = clamp(ny, 40, this.viewH - 10);
    }

    _onPointerUp() {
      if (this.state !== STATE.DRAGGING) return;
      this.hitEl.style.cursor = 'grab';
      this.state = STATE.FALLING;
      this.fallVelocity = 0;
    }

    _onClicked() {
      // Startle reaction: quick camouflage flash, does not block state machine.
      this.fadeT = 0.6;
      this.fadeDir = -1;
      this._flickTongue();
    }

    _onTargetClicked(key) {
      // Real click on a watched button — react even from a distance by
      // nudging the wander goal toward it next chance we get.
      this._pendingReaction = key;
    }

    // ---------- behavior state machine ----------

    _pickNewWanderTarget() {
      this.wanderTargetX = clamp(rand(40, this.viewW - 40), 40, this.viewW - 40);
    }

    _flickTongue() {
      if (this.tongueActive) return;
      this.tongueActive = true;
      this.tongueT = 0;
    }

    _startFade() {
      this.fadeDir = 1;
    }

    _maybeSeekTarget() {
      const keys = Object.keys(this.config.targets);
      const key = this._pendingReaction || keys[Math.floor(Math.random() * keys.length)];
      this._pendingReaction = null;
      const el = this._findTarget(key);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      this.currentTargetKey = key;
      this.wanderTargetX = clamp(rect.left + rect.width / 2, 30, this.viewW - 30);
      this.targetRect = rect;
      this.state = STATE.SEEK;
      return true;
    }

    update(dt) {
      if (this.reducedMotion) {
        // Minimal motion: stay idle, still allow drag/click reactions.
        if (this.state !== STATE.DRAGGING && this.state !== STATE.FALLING) {
          this.state = STATE.IDLE;
        }
      }

      this.stateTimer -= dt;

      switch (this.state) {
        case STATE.IDLE:
          this.bob = Math.sin(performance.now() / 400) * 1.2;
          if (this.stateTimer <= 0) {
            if (this._pendingReaction && this._maybeSeekTarget()) break;
            if (Math.random() < 0.3 && !this.reducedMotion) {
              this._flickTongue();
              this.stateTimer = rand(1, 2);
            } else if (Math.random() < 0.25 && !this.reducedMotion) {
              this._startFade();
              this.stateTimer = rand(3, 5);
            } else if (!this.reducedMotion) {
              this._pickNewWanderTarget();
              this.state = STATE.WANDER;
              this.stateTimer = rand(3, 7);
            } else {
              this.stateTimer = rand(2, 4);
            }
          }
          break;

        case STATE.WANDER:
        case STATE.SEEK: {
          const dx = this.wanderTargetX - this.x;
          const dist = Math.abs(dx);
          if (dist < 4) {
            if (this.state === STATE.SEEK) {
              this.state = STATE.ON_TARGET;
              this.stateTimer = rand(1.5, 2.5);
              this._flickTongue();
              if (this.currentTargetKey === 'theme') this._startFade();
            } else {
              this.state = STATE.IDLE;
              this.stateTimer = rand(1.5, 4);
            }
          } else {
            this.facing = dx > 0 ? 1 : -1;
            this.x += this.facing * this.config.wanderSpeed * dt;
            this.walkFrameTimer += dt;
            if (this.walkFrameTimer > 0.18) {
              this.walkFrameTimer = 0;
              this.walkFrame = (this.walkFrame + 1) % 2;
            }
            this.bob = Math.abs(Math.sin(performance.now() / 120)) * 1.5;
          }
          if (this.stateTimer <= 0 && this.state === STATE.WANDER) {
            this.state = STATE.IDLE;
            this.stateTimer = rand(1.5, 4);
          }
          break;
        }

        case STATE.ON_TARGET:
          this.bob = Math.sin(performance.now() / 350) * 1;
          if (this.stateTimer <= 0) {
            this.currentTargetKey = null;
            this.state = STATE.IDLE;
            this.stateTimer = rand(1, 2);
          }
          break;

        case STATE.DRAGGING:
          this.bob = 0;
          break;

        case STATE.FALLING:
          this.fallVelocity += 900 * dt;
          this.y += this.fallVelocity * dt;
          if (this.y >= this.groundY) {
            this.y = this.groundY;
            this.state = STATE.IDLE;
            this.stateTimer = rand(0.5, 1);
          }
          break;
      }

      // Tongue animation, independent of state.
      if (this.tongueActive) {
        this.tongueT += dt * 3.2;
        if (this.tongueT >= 1) {
          this.tongueT = 0;
          this.tongueActive = false;
        }
      }

      // Camouflage fade in/out.
      if (this.fadeDir !== 0) {
        this.fadeT += this.fadeDir * dt * 0.6;
        if (this.fadeT >= 1) {
          this.fadeT = 1;
          this.fadeDir = -1;
        } else if (this.fadeT <= 0) {
          this.fadeT = 0;
          this.fadeDir = 0;
        }
      }

      // Occasionally pursue a pending reaction even outside idle's own roll.
      if (
        this._pendingReaction &&
        this.state !== STATE.SEEK &&
        this.state !== STATE.DRAGGING &&
        this.state !== STATE.FALLING
      ) {
        this._maybeSeekTarget();
      }

      // Keep hit-area synced to sprite's on-screen box.
      const w = this.spriteW * this.config.scale;
      const h = this.spriteH * this.config.scale;
      this.hitEl.style.width = w + 'px';
      this.hitEl.style.height = h + 'px';
      this.hitEl.style.left = this.x - w / 2 + 'px';
      this.hitEl.style.top = this.y - h + this.bob + 'px';
    }

    // ---------- rendering ----------

    _currentPalette() {
      return this.paletteOverride || this.config.palette;
    }

    _bgSampleColor() {
      // Approximate "blend into background" using the page/body background.
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      return bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#ffffff';
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewW, this.viewH);

      this._drawSpriteToBuffer();

      const w = this.spriteW * this.config.scale;
      const h = this.spriteH * this.config.scale;
      const dx = this.x - w / 2;
      const dy = this.y - h + this.bob;

      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.globalAlpha = 1 - this.fadeT * 0.85; // never fully invisible/unusable
      if (this.facing === -1) {
        ctx.translate(dx + w, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(this.buffer, 0, 0, w, h);
      } else {
        ctx.drawImage(this.buffer, dx, dy, w, h);
      }
      ctx.restore();
    }

    _drawSpriteToBuffer() {
      const bctx = this.bctx;
      const p = this._currentPalette();
      const W = this.spriteW;
      const H = this.spriteH;
      bctx.clearRect(0, 0, W, H);
      bctx.imageSmoothingEnabled = false;

      // Camouflage blend target color (fades body toward background).
      const bg = this._bgSampleColor();
      const bodyColor = this.fadeT > 0 ? this._blendToBg(p.body, bg, this.fadeT) : p.body;
      const darkColor = this.fadeT > 0 ? this._blendToBg(p.bodyDark, bg, this.fadeT) : p.bodyDark;
      const lightColor = this.fadeT > 0 ? this._blendToBg(p.bodyLight, bg, this.fadeT) : p.bodyLight;

      const legLift = this.walkFrame === 0 ? 1 : -1;
      const isWalking = this.state === STATE.WANDER || this.state === STATE.SEEK;

      // Tail: spiral curl, drawn first so the body silhouette overlaps its base.
      bctx.strokeStyle = darkColor;
      bctx.lineWidth = 2.6;
      bctx.lineCap = 'round';
      bctx.beginPath();
      bctx.moveTo(11, 17);
      bctx.bezierCurveTo(4, 18, 1, 14, 4, 10);
      bctx.bezierCurveTo(6, 7.5, 9, 8.5, 8, 11);
      bctx.stroke();

      // Legs (two pairs, alternate lift while walking), drawn under the body.
      bctx.fillStyle = darkColor;
      const legY = 16.5;
      bctx.fillRect(14, legY + (isWalking ? legLift : 0), 3, 5);
      bctx.fillRect(26, legY + (isWalking ? -legLift : 0), 3, 5);

      // Body + head + snout as one continuous silhouette.
      bctx.fillStyle = bodyColor;
      bctx.beginPath();
      bctx.moveTo(10, 17); // tail base / rear
      bctx.bezierCurveTo(10, 12, 14, 7, 20, 6); // rise into shoulder hump
      bctx.bezierCurveTo(24, 5, 27, 3, 31, 3); // up toward casque
      bctx.bezierCurveTo(34, 3, 36, 5, 38, 8); // casque down to snout tip
      bctx.bezierCurveTo(39, 9.5, 38, 10.5, 36, 11); // snout underside
      bctx.bezierCurveTo(33, 10, 30, 11, 28, 13); // chin/throat curve back in
      bctx.bezierCurveTo(24, 17, 18, 18.5, 12, 18); // belly back to tail base
      bctx.closePath();
      bctx.fill();
      bctx.strokeStyle = darkColor;
      bctx.lineWidth = 0.8;
      bctx.stroke();

      // Belly highlight.
      bctx.fillStyle = lightColor;
      bctx.beginPath();
      bctx.moveTo(13, 16.5);
      bctx.bezierCurveTo(18, 17.5, 24, 16.5, 30, 12.5);
      bctx.bezierCurveTo(24, 15.5, 17, 16, 13, 16.5);
      bctx.closePath();
      bctx.fill();

      // Casque spike.
      bctx.fillStyle = darkColor;
      bctx.beginPath();
      bctx.moveTo(29, 3.2);
      bctx.lineTo(31, 0.5);
      bctx.lineTo(33, 3.4);
      bctx.closePath();
      bctx.fill();

      // Eye turret + eye.
      bctx.fillStyle = bodyColor;
      bctx.beginPath();
      bctx.arc(32, 7, 3, 0, Math.PI * 2);
      bctx.fill();
      bctx.strokeStyle = darkColor;
      bctx.lineWidth = 0.6;
      bctx.stroke();
      bctx.fillStyle = p.eye;
      bctx.beginPath();
      bctx.arc(33, 7, 1.3, 0, Math.PI * 2);
      bctx.fill();

      // Tongue.
      if (this.tongueActive) {
        const extend = this.tongueT < 0.5 ? this.tongueT * 2 : (1 - this.tongueT) * 2;
        const len = 13 * extend;
        bctx.strokeStyle = p.tongue;
        bctx.lineWidth = 1.2;
        bctx.beginPath();
        bctx.moveTo(38, 9);
        bctx.lineTo(38 + len, 9);
        bctx.stroke();
        bctx.fillStyle = p.tongue;
        bctx.beginPath();
        bctx.arc(38 + len, 9, 1, 0, Math.PI * 2);
        bctx.fill();
      }
    }

    _blendToBg(color, bg, t) {
      // bg may be "rgb(r,g,b)" from computed style; normalize to hex-ish lerp.
      const bgMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
      const bgHex = bgMatch
        ? '#' + [1, 2, 3].map((i) => Number(bgMatch[i]).toString(16).padStart(2, '0')).join('')
        : '#ffffff';
      return lerpColor(color, bgHex, t);
    }

    // ---------- public API ----------

    setPalette(paletteOverride) {
      this.paletteOverride = paletteOverride
        ? Object.assign({}, this.config.palette, paletteOverride)
        : null;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this._observer && this._observer.disconnect();
      this.canvas.remove();
      this.hitEl.remove();
    }

    // ---------- loop ----------

    _loop(now) {
      const dt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;
      this.update(dt);
      this.draw();
      this._raf = requestAnimationFrame(this._loop);
    }
  }

  global.ChameleonPet = {
    init(config) {
      if (global.__chameleonPetInstance) return global.__chameleonPetInstance;
      const instance = new ChameleonPet(config);
      global.__chameleonPetInstance = instance;
      return instance;
    },
  };
})(window);
