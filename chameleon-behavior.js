/**
 * ChameleonBehavior — the state machine: idle/wander/seek/on-target/
 * dragging/falling, tongue-flick and camouflage-fade tweens, and pointer
 * handling. Knows nothing about the DOM beyond a small `world` interface
 * injected at construction — it never queries elements or draws pixels
 * itself, so it can't accidentally grow page-specific or rendering logic.
 *
 * `world` (implemented by chameleon-pet.js) must provide:
 *   viewport()        -> { w, h }
 *   groundY()         -> number
 *   targetRect(key)   -> DOMRect | null   (null if not present/visible)
 *   targetKeys()      -> string[]
 *
 * Reactions to arriving at / clicking a watched target are looked up from
 * ChameleonActions (chameleon-behavior.js only knows *when* to fire them).
 */
(function (global) {
  'use strict';

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

  class ChameleonBehavior {
    constructor(world, config) {
      this.world = world;
      this.config = config; // { wanderSpeed }
      this.reducedMotion =
        global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const vp = world.viewport();
      this.x = rand(80, Math.max(160, vp.w - 80));
      this.y = world.groundY();
      this.facing = 1; // 1 = right, -1 = left
      this.state = STATE.IDLE;
      this.stateTimer = rand(1, 3);
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
      this._pendingReaction = null;

      this._api = {
        flickTongue: () => this.flickTongue(),
        startFade: () => this.startFade(),
      };

      this._pickNewWanderTarget();
    }

    // ---------- reactions from the outside world ----------

    // A real click landed on a watched button, wherever the pet currently
    // is. Fires that target's onClick immediately, and nudges the wander
    // goal toward it so the pet also walks over when it next gets a
    // chance (see _maybeSeekTarget).
    reactTo(key) {
      this._pendingReaction = key;
      const recipe = global.ChameleonActions && global.ChameleonActions[key];
      if (recipe && recipe.onClick) recipe.onClick(this._api);
    }

    // The hit-area itself was clicked (the pet, not one of the watched
    // buttons) — a generic startle, not tied to any particular target.
    onClickedSelf() {
      this.fadeT = 0.6;
      this.fadeDir = -1;
      this.flickTongue();
    }

    // ---------- pointer / drag ----------

    onPointerDown(clientX, clientY) {
      if (this.state === STATE.FALLING) return;
      this.state = STATE.DRAGGING;
      this.dragOffset.x = clientX - this.x;
      this.dragOffset.y = clientY - this.y;
    }

    onPointerMove(clientX, clientY) {
      if (this.state !== STATE.DRAGGING) return;
      const vp = this.world.viewport();
      const nx = clientX - this.dragOffset.x;
      const ny = clientY - this.dragOffset.y;
      this.facing = nx > this.x ? 1 : nx < this.x ? -1 : this.facing;
      this.x = clamp(nx, 20, vp.w - 20);
      this.y = clamp(ny, 40, vp.h - 10);
    }

    onPointerUp() {
      if (this.state !== STATE.DRAGGING) return;
      this.state = STATE.FALLING;
      this.fallVelocity = 0;
    }

    // ---------- internal behavior helpers ----------

    _pickNewWanderTarget() {
      const vp = this.world.viewport();
      this.wanderTargetX = clamp(rand(40, vp.w - 40), 40, vp.w - 40);
    }

    // Starts a tongue-flick; a no-op while one is already mid-flight so
    // rapid triggers (e.g. spam-clicking the pet) don't restart the tween.
    flickTongue() {
      if (this.tongueActive) return;
      this.tongueActive = true;
      this.tongueT = 0;
    }

    // Kicks off the camouflage tween. fadeT ramps 0->1 (fadeDir 1) then
    // update() flips fadeDir to -1 once it peaks, so a single call
    // produces a full fade-out-then-back-in cycle, not just a one-way fade.
    startFade() {
      this.fadeDir = 1;
    }

    // Walks toward a watched button: picks _pendingReaction if a real
    // click was observed, otherwise a random target key, so the pet reacts
    // to actual user activity when there is any instead of only wandering
    // aimlessly. Returns false (leaving state untouched) if that target
    // isn't in the DOM yet or is hidden, which happens on pages still
    // under construction.
    _maybeSeekTarget() {
      const keys = this.world.targetKeys();
      if (keys.length === 0) return false;
      const key = this._pendingReaction || keys[Math.floor(Math.random() * keys.length)];
      this._pendingReaction = null;
      const rect = this.world.targetRect(key);
      if (!rect) return false;
      const vp = this.world.viewport();
      this.currentTargetKey = key;
      this.wanderTargetX = clamp(rect.left + rect.width / 2, 30, vp.w - 30);
      this.state = STATE.SEEK;
      return true;
    }

    _runArriveAction() {
      const key = this.currentTargetKey;
      const recipe = key && global.ChameleonActions && global.ChameleonActions[key];
      if (recipe && recipe.onArrive) recipe.onArrive(this._api);
    }

    // ---------- main update ----------

    // Advances the state machine by dt seconds. Each STATE case owns its
    // own transition logic; the tongue/fade tweens below run every frame
    // regardless of state since they're independent of movement.
    update(dt) {
      const vp = this.world.viewport();
      const groundY = this.world.groundY();

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
              this.flickTongue();
              this.stateTimer = rand(1, 2);
            } else if (Math.random() < 0.25 && !this.reducedMotion) {
              this.startFade();
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
              this._runArriveAction();
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
          if (this.y >= groundY) {
            this.y = groundY;
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

      // Clamp stray positions back into a resized viewport.
      this.x = clamp(this.x, 10, vp.w - 10);
    }

    // Snapshot consumed by the bootstrap's draw loop: sprite pose plus
    // on-screen placement.
    getPose() {
      return {
        x: this.x,
        y: this.y,
        facing: this.facing,
        bob: this.bob,
        walkFrame: this.walkFrame,
        isWalking: this.state === STATE.WANDER || this.state === STATE.SEEK,
        tongueActive: this.tongueActive,
        tongueT: this.tongueT,
        fadeT: this.fadeT,
      };
    }
  }

  global.ChameleonBehavior = ChameleonBehavior;
})(window);
