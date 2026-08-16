/**
 * ChameleonStandardBehaviour — the pet's ambient, non-interactive
 * behaviour: patrolling the window perimeter (the initial establishing lap
 * plus steady-state back-and-forth wander), and the idle cosmetic tweens
 * that fire on their own while patrolling (tongue flicks, camouflage
 * fades). None of this is triggered by the user or by a site element —
 * see user-interaction-behaviour.js and desktop-interaction-behaviour.js
 * for those.
 *
 * Every function here takes the owning ChameleonBehavior instance as its
 * first argument (`ctx`) and reads/writes its shared pose fields (x, y,
 * angle, mirror, bob, ...) directly, rather than owning private state of
 * its own — those fields are inherently shared across all three behaviour
 * modules (dragging and patrolling both move x/y, for instance), so
 * splitting *files* by concern is what stays maintainable here, not
 * splitting *ownership* of the shared instance.
 */
(function (global) {
  'use strict';

  // How long the pet commits to a walking direction before reversing, in
  // seconds, quantized to 15s steps from 15s to 2 minutes. The "don't
  // repeat within 3 turns" rule (see pickDirectionInterval) is what keeps
  // this feeling randomized without ever producing a jittery back-to-back
  // repeat of the same short or long stretch.
  const DIRECTION_INTERVALS = [15, 30, 45, 60, 75, 90, 105, 120];

  // How quickly the rendered angle chases the path's "raw" angle each
  // frame (higher = snappier corners, lower = lazier/more of a swing).
  const ANGLE_EASE_RATE = 9;

  // Tongue-flick presets: how far it reaches (len), how fast the whole
  // out-and-back cycle runs (speed, in tongueT units/sec), and the shape
  // of the motion — "original" is a plain symmetric ping-pong, the other
  // two snap out fast (within the first snapT of the cycle, eased) and
  // relax back in slower, just to differing degrees.
  const TONGUE_MODES = {
    original: { speed: 3.2, len: 13, ease: false, snapT: 0.5 },
    middle: { speed: 2.4, len: 21, ease: true, snapT: 0.35 },
    snappy: { speed: 3.2, len: 30, ease: true, snapT: 0.35 },
  };

  function initState(ctx) {
    ctx.tongueMode = TONGUE_MODES[ctx.config && ctx.config.tongueMode] || TONGUE_MODES.middle;
    ctx._activeTongueMode = ctx.tongueMode; // mode of the in-flight (or most recent) flick

    ctx.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    ctx.angle = 0; // smoothed render angle
    ctx._rawAngle = 0; // angle the path/state wants us at right now
    ctx._lapDistance = 0;
    ctx._recentIntervals = [];
    ctx._directionTimer = pickDirectionInterval(ctx);

    ctx.walkFrame = 0;
    ctx.walkFrameTimer = 0;
    ctx.tongueT = 0; // 0..1 progress of a tongue flick, 0 = retracted
    ctx.tongueActive = false;
    ctx.fadeT = 0; // 0 = fully visible, 1 = fully camouflaged
    ctx.fadeDir = 0;
  }

  // Picks the next direction-hold duration. Excludes whichever intervals
  // were used in the last two turns so the same gap can't recur within
  // any 3 consecutive turns, while still being free random choice
  // otherwise — the "illusion of randomness without chaos".
  function pickDirectionInterval(ctx) {
    const pool = DIRECTION_INTERVALS.filter((v) => !ctx._recentIntervals || !ctx._recentIntervals.includes(v));
    const candidates = pool.length ? pool : DIRECTION_INTERVALS;
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (!ctx._recentIntervals) ctx._recentIntervals = [];
    ctx._recentIntervals.push(choice);
    if (ctx._recentIntervals.length > 2) ctx._recentIntervals.shift();
    return choice;
  }

  // Moves `s` by dt*speed*dir along the perimeter loop and updates
  // x/y/rawAngle and the walk-cycle frame timer to match.
  function advanceAlongPath(ctx, dt, dir) {
    const total = ctx._perimeterLength();
    ctx.s = ((ctx.s + dir * ctx.config.wanderSpeed * dt) % total + total) % total;
    const p = ctx._pointAt(ctx.s);
    ctx.x = p.x;
    ctx.y = p.y;
    ctx._rawAngle = p.angle;
    ctx.mirror = dir === -1;

    ctx.walkFrameTimer += dt;
    if (ctx.walkFrameTimer > 0.18) {
      ctx.walkFrameTimer = 0;
      ctx.walkFrame = (ctx.walkFrame + 1) % 2;
    }
    ctx.bob = Math.abs(Math.sin(performance.now() / 120)) * 1.5;
  }

  function maybeTongueFlick(ctx, dt) {
    if (ctx.reducedMotion || ctx.tongueActive) return;
    if (Math.random() < dt * 0.12) flickTongue(ctx);
  }

  function maybeFade(ctx, dt) {
    if (ctx.reducedMotion || ctx.fadeDir !== 0) return;
    if (Math.random() < dt * 0.05) startFade(ctx);
  }

  // Starts a tongue-flick; a no-op while one is already mid-flight so
  // rapid triggers (e.g. spam-clicking the pet) don't restart the tween.
  // Optional modeName overrides the configured default for just this
  // flick (e.g. clicking the pet directly triggers the snappy preset).
  function flickTongue(ctx, modeName) {
    if (ctx.tongueActive) return;
    ctx._activeTongueMode = (modeName && TONGUE_MODES[modeName]) || ctx.tongueMode;
    ctx.tongueActive = true;
    ctx.tongueT = 0;
  }

  // Kicks off the camouflage tween. fadeT ramps 0->1 (fadeDir 1) then
  // updateFade() flips fadeDir to -1 once it peaks, so a single call
  // produces a full fade-out-then-back-in cycle, not just a one-way fade.
  function startFade(ctx) {
    ctx.fadeDir = 1;
  }

  function updateTongue(ctx, dt) {
    if (!ctx.tongueActive) return;
    ctx.tongueT += dt * ctx._activeTongueMode.speed;
    if (ctx.tongueT >= 1) {
      ctx.tongueT = 0;
      ctx.tongueActive = false;
    }
  }

  function updateFade(ctx, dt) {
    if (ctx.fadeDir === 0) return;
    ctx.fadeT += ctx.fadeDir * dt * 0.6;
    if (ctx.fadeT >= 1) {
      ctx.fadeT = 1;
      ctx.fadeDir = -1;
    } else if (ctx.fadeT <= 0) {
      ctx.fadeT = 0;
      ctx.fadeDir = 0;
    }
  }

  // Eases the rendered rotation toward wherever the path/state wants it —
  // this is what makes corners (and picking the pet up) read as a pivot
  // instead of an instant snap.
  function updateAngleEase(ctx, dt) {
    const ease = 1 - Math.exp(-ANGLE_EASE_RATE * dt);
    ctx.angle = global.ChameleonPath.lerpAngle(ctx.angle, ctx._rawAngle, ease);
  }

  global.ChameleonStandardBehaviour = {
    TONGUE_MODES,
    initState,
    pickDirectionInterval,
    advanceAlongPath,
    maybeTongueFlick,
    maybeFade,
    flickTongue,
    startFade,
    updateTongue,
    updateFade,
    updateAngleEase,
  };
})(window);
