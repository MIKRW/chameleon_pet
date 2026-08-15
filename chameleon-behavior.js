/**
 * ChameleonBehavior — the state machine: an initial full lap of the
 * window's perimeter, then continuous back-and-forth patrolling that
 * reverses direction at randomized intervals, plus seeking/reacting to
 * watched targets, dragging, and returning to the track after a drop.
 *
 * Movement follows ChameleonPath's perimeter loop (see that file for the
 * geometry) rather than a fixed ground line, so the pet walks the full
 * border of the window — bottom, up one side, across the top, down the
 * other side — always oriented feet-first into whichever edge it's on.
 * Rotation is eased toward the path's angle every frame (see _rawAngle /
 * lerpAngle below) so corners read as a pivot rather than a snap; no
 * separate hand-drawn corner sprites are needed for that.
 *
 * Knows nothing about the DOM beyond a small `world` interface injected
 * at construction — it never queries elements or draws pixels itself.
 *
 *   world.viewport()      -> { w, h }
 *   world.edgeMargin()     -> number (inset of the walkable loop from the true window edge)
 *   world.targetRect(key) -> DOMRect | null   (null if not present/visible)
 *   world.targetKeys()    -> string[]
 *
 * Reactions to arriving at / clicking a watched target are looked up from
 * ChameleonActions (this file only knows *when* to fire them).
 */
(function (global) {
  'use strict';

  const STATE = {
    LAP: 'lap', // one full establishing loop of the perimeter on startup
    WANDER: 'wander', // steady-state patrol, reversing direction periodically
    SEEK: 'seek',
    ON_TARGET: 'on_target',
    DRAGGING: 'dragging',
    RETURNING: 'returning', // easing back onto the track after being dropped
  };

  // How long the pet commits to a walking direction before reversing, in
  // seconds, quantized to 15s steps from 15s to 2 minutes. The "don't
  // repeat within 3 turns" rule (see _pickDirectionInterval) is what keeps
  // this feeling randomized without ever producing a jittery back-to-back
  // repeat of the same short or long stretch.
  const DIRECTION_INTERVALS = [15, 30, 45, 60, 75, 90, 105, 120];

  // How quickly the rendered angle chases the path's "raw" angle each
  // frame (higher = snappier corners, lower = lazier/more of a swing).
  const ANGLE_EASE_RATE = 9;

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

      this.s = 0; // distance along the perimeter loop
      this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
      this.mirror = false; // sprite horizontal flip
      this.angle = 0; // smoothed render angle
      this._rawAngle = 0; // angle the path/state wants us at right now

      const start = this._pointAt(0);
      this.x = start.x;
      this.y = start.y;
      this.angle = start.angle;
      this._rawAngle = start.angle;

      this.state = this.reducedMotion ? STATE.WANDER : STATE.LAP;
      this._lapDistance = 0;
      this.stateTimer = 0;
      this._directionTimer = this._pickDirectionInterval();
      this._recentIntervals = [];

      this.walkFrame = 0;
      this.walkFrameTimer = 0;
      this.tongueT = 0; // 0..1 progress of a tongue flick, 0 = retracted
      this.tongueActive = false;
      this.fadeT = 0; // 0 = fully visible, 1 = fully camouflaged
      this.fadeDir = 0;
      this.bob = 0;

      this.currentTargetKey = null;
      this._seekS = 0;
      this._pendingReaction = null;

      this._returnTarget = null;
      this._dragAnchor = { x: 0, y: 0 }; // offset from pointer to sprite anchor while dragging

      this._api = {
        flickTongue: () => this.flickTongue(),
        startFade: () => this.startFade(),
      };
    }

    // ---------- path helpers (thin wrappers so call sites stay short) ----------

    _pointAt(s) {
      const vp = this.world.viewport();
      return global.ChameleonPath.pointAt(vp.w, vp.h, this.world.edgeMargin(), s);
    }

    _perimeterLength() {
      const vp = this.world.viewport();
      return global.ChameleonPath.perimeterLength(vp.w, vp.h, this.world.edgeMargin());
    }

    _nearestPoint(x, y) {
      const vp = this.world.viewport();
      return global.ChameleonPath.nearestS(vp.w, vp.h, this.world.edgeMargin(), x, y);
    }

    // Picks the next direction-hold duration. Excludes whichever intervals
    // were used in the last two turns so the same gap can't recur within
    // any 3 consecutive turns, while still being free random choice
    // otherwise — the "illusion of randomness without chaos".
    _pickDirectionInterval() {
      const pool = DIRECTION_INTERVALS.filter((v) => !this._recentIntervals || !this._recentIntervals.includes(v));
      const candidates = pool.length ? pool : DIRECTION_INTERVALS;
      const choice = candidates[Math.floor(Math.random() * candidates.length)];
      if (!this._recentIntervals) this._recentIntervals = [];
      this._recentIntervals.push(choice);
      if (this._recentIntervals.length > 2) this._recentIntervals.shift();
      return choice;
    }

    // Moves `s` by dt*speed*dir along the loop and updates x/y/rawAngle
    // and the walk-cycle frame timer to match.
    _advanceAlongPath(dt, dir) {
      const total = this._perimeterLength();
      this.s = ((this.s + dir * this.config.wanderSpeed * dt) % total + total) % total;
      const p = this._pointAt(this.s);
      this.x = p.x;
      this.y = p.y;
      this._rawAngle = p.angle;
      this.mirror = dir === -1;

      this.walkFrameTimer += dt;
      if (this.walkFrameTimer > 0.18) {
        this.walkFrameTimer = 0;
        this.walkFrame = (this.walkFrame + 1) % 2;
      }
      this.bob = Math.abs(Math.sin(performance.now() / 120)) * 1.5;
    }

    // ---------- cosmetic overlays (independent of state/position) ----------

    _maybeTongueFlick(dt) {
      if (this.reducedMotion || this.tongueActive) return;
      if (Math.random() < dt * 0.12) this.flickTongue();
    }

    _maybeFade(dt) {
      if (this.reducedMotion || this.fadeDir !== 0) return;
      if (Math.random() < dt * 0.05) this.startFade();
    }

    // ---------- reactions from the outside world ----------

    // A real click landed on a watched button, wherever the pet currently
    // is. Fires that target's onClick immediately, and queues it to be
    // walked to next chance the state machine gets (see _maybeSeekTarget).
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
      if (this.state === STATE.RETURNING) return;
      this.state = STATE.DRAGGING;
      this._dragAnchor.x = clientX - this.x;
      this._dragAnchor.y = clientY - this.y;
    }

    onPointerMove(clientX, clientY) {
      if (this.state !== STATE.DRAGGING) return;
      const vp = this.world.viewport();
      const nx = clientX - this._dragAnchor.x;
      const ny = clientY - this._dragAnchor.y;
      this.mirror = nx < this.x ? true : nx > this.x ? false : this.mirror;
      this.x = clamp(nx, 10, vp.w - 10);
      this.y = clamp(ny, 10, vp.h - 10);
      this._rawAngle = 0; // held freely — not pressed against any edge while dragging
    }

    onPointerUp() {
      if (this.state !== STATE.DRAGGING) return;
      this._returnTarget = this._nearestPoint(this.x, this.y);
      this.state = STATE.RETURNING;
    }

    // ---------- internal behavior helpers ----------

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
    // to actual user activity when there is any instead of only patrolling
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
      const nearest = this._nearestPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      this.currentTargetKey = key;
      this._seekS = nearest.s;
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
    // own transition logic; the tongue/fade tweens and angle easing below
    // run every frame regardless of state.
    update(dt) {
      if (this.reducedMotion) {
        if (this.state === STATE.LAP) this.state = STATE.WANDER;
        if (this.state !== STATE.DRAGGING && this.state !== STATE.RETURNING) {
          // Stay put; still allow drag/click reactions and cosmetic overlays.
        }
      }

      this.stateTimer -= dt;

      switch (this.state) {
        case STATE.LAP: {
          if (this.reducedMotion) break;
          this._advanceAlongPath(dt, 1); // establishing lap always runs clockwise
          this._maybeTongueFlick(dt);
          this._lapDistance += this.config.wanderSpeed * dt;
          if (this._lapDistance >= this._perimeterLength()) {
            this.state = STATE.WANDER;
            this.direction = 1;
            this._directionTimer = this._pickDirectionInterval();
          }
          if (this._pendingReaction) this._maybeSeekTarget();
          break;
        }

        case STATE.WANDER: {
          if (this.reducedMotion) break;
          this._directionTimer -= dt;
          if (this._directionTimer <= 0) {
            this.direction *= -1;
            this._directionTimer = this._pickDirectionInterval();
          }
          this._advanceAlongPath(dt, this.direction);
          this._maybeTongueFlick(dt);
          this._maybeFade(dt);
          if (this._pendingReaction) this._maybeSeekTarget();
          break;
        }

        case STATE.SEEK: {
          const total = this._perimeterLength();
          const { dir, dist } = global.ChameleonPath.shortestDirection(this.s, this._seekS, total);
          if (dist < 4) {
            this.state = STATE.ON_TARGET;
            this.stateTimer = rand(1.5, 2.5);
            this._runArriveAction();
          } else {
            this._advanceAlongPath(dt, dir);
            this._maybeTongueFlick(dt);
          }
          break;
        }

        case STATE.ON_TARGET:
          this.bob = Math.sin(performance.now() / 350) * 1;
          if (this.stateTimer <= 0) {
            this.currentTargetKey = null;
            this.state = STATE.WANDER;
          }
          break;

        case STATE.DRAGGING:
          this.bob = 0;
          break;

        case STATE.RETURNING: {
          const dx = this._returnTarget.x - this.x;
          const dy = this._returnTarget.y - this.y;
          const dist = Math.hypot(dx, dy);
          this._rawAngle = this._returnTarget.angle;
          if (dist < 3) {
            this.s = this._returnTarget.s;
            this.x = this._returnTarget.x;
            this.y = this._returnTarget.y;
            this.state = STATE.WANDER;
          } else {
            const speed = 260;
            this.x += (dx / dist) * speed * dt;
            this.y += (dy / dist) * speed * dt;
            this.mirror = dx < 0;
          }
          break;
        }
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

      // Ease the rendered rotation toward wherever the path/state wants it
      // — this is what makes corners (and picking the pet up) read as a
      // pivot instead of an instant snap.
      const ease = 1 - Math.exp(-ANGLE_EASE_RATE * dt);
      this.angle = global.ChameleonPath.lerpAngle(this.angle, this._rawAngle, ease);
    }

    // Snapshot consumed by the bootstrap's draw loop: sprite pose plus
    // on-screen placement.
    getPose() {
      return {
        x: this.x,
        y: this.y,
        angle: this.angle,
        mirror: this.mirror,
        bob: this.bob,
        walkFrame: this.walkFrame,
        isWalking:
          this.state === STATE.LAP || this.state === STATE.WANDER || this.state === STATE.SEEK,
        tongueActive: this.tongueActive,
        tongueT: this.tongueT,
        fadeT: this.fadeT,
      };
    }
  }

  global.ChameleonBehavior = ChameleonBehavior;
})(window);
