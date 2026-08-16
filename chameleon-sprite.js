/**
 * ChameleonSprite — pure rendering. Given a pose snapshot and a palette,
 * draws the chameleon into a 2D context. Knows nothing about DOM, timers,
 * or the page it's running on — only how to turn (pose, palette) into
 * pixels. All sprite/pose variations belong in this file.
 */
(function (global) {
  'use strict';

  // Extra buffer width past the body so a full comedic tongue extension
  // has room to draw without getting clipped at the canvas edge. Extra
  // height below the ground line gives the perched tail-hook (see the
  // tail block below) room to dip under the edge it's gripping.
  const WIDTH = 72;
  const HEIGHT = 30;
  // The point in buffer-space (feet on the ground line) that the bootstrap
  // rotates/mirrors the sprite around, so it pivots on its feet rather than
  // its bounding-box center when oriented onto a side or top edge. Fixed
  // at the body's own center (not WIDTH / 2) so widening the buffer for
  // tongue overflow doesn't shift the body relative to the pet's anchor.
  const ANCHOR_X = 20;
  const ANCHOR_Y = 21;

  // ---------------------------------------------------------------------
  // Body-part naming convention (buffer-space, before scale/mirror/rotate)
  // — use these names when discussing changes so it's unambiguous which
  // part of the silhouette is meant:
  //   casque          — the small forward-pointing spike above the snout
  //   crest           — the row of dorsal spikes along the spine/back
  //   snout           — the forward tip of the head, opposite the tail
  //   eye turret      — the raised eye bump with its accent ring + pupil
  //   flank stripe    — the thin light line along the side of the body
  //   belly           — the underside of the body silhouette
  //   tail            — the coiled spiral at the rear
  //   near-back leg   — near-side rear leg (x=14), full color, on top
  //   near-front leg  — near-side front leg (x=27), full color, on top
  //   far-back leg    — far-side rear leg (x=13.2), shaded darker/shorter
  //   far-front leg   — far-side front leg (x=29), shaded darker/shorter
  //   hip / knee / foot / toe fork — the three drawn points of a leg,
  //     hip nearest the body, foot at the ankle, toe fork the small
  //     forked mark past the foot
  // ---------------------------------------------------------------------

  // Traces the body+head+snout silhouette path (no fill/stroke of its own)
  // so it can be reused both to paint the body and, via clip(), to confine
  // patch/speckle rendering to exactly that silhouette regardless of what
  // else has already been drawn into the buffer (legs, tail).
  function traceBodyPath(bctx) {
    bctx.moveTo(9, 17.5); // tail base / rear
    bctx.bezierCurveTo(9, 13, 13, 9, 19, 7.5); // low rise into shoulder
    bctx.bezierCurveTo(23, 6.3, 26, 4.6, 30, 4.3); // ridge toward casque, slight head bump
    bctx.bezierCurveTo(33, 4.3, 35, 6.5, 37.5, 9); // casque down to snout
    bctx.bezierCurveTo(38.5, 10, 38, 10.8, 36.5, 11.2); // snout underside
    bctx.bezierCurveTo(33.5, 10.5, 30, 11.3, 27.5, 13); // chin/throat back in
    bctx.bezierCurveTo(22, 16.5, 16, 17.8, 10, 17.8); // belly back to tail base
    bctx.closePath();
  }

  // 'transitionHigh'/'transitionLow': a handful of small overlapping-circle
  // clusters (irregular rather than perfect circles) scattered along the
  // body, as if the chameleon is mid-shift toward the patch color.
  function drawBlotches(bctx, color) {
    bctx.fillStyle = color;
    const blotches = [
      [13, 12.5, 1.6], [14.5, 11, 1.3], [12, 10.3, 1.1],
      [20, 8, 1.7], [21.6, 9.3, 1.2],
      [27, 7, 1.8], [28.7, 8.2, 1.3], [25.8, 8.6, 1.1],
      [34, 9.8, 1.4], [35.4, 8.7, 1],
    ];
    for (const [x, y, r] of blotches) {
      bctx.beginPath();
      bctx.arc(x, y, r, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  // 'speckled': many small dots dusted evenly over the body for a fine
  // dither/texture look rather than the larger blotch clusters above.
  function drawSpeckle(bctx, color) {
    bctx.fillStyle = color;
    const dots = [
      [11, 14, 0.5], [13, 10, 0.45], [15, 16, 0.4], [17, 8.5, 0.5], [19, 13, 0.45],
      [21, 7, 0.4], [23, 11, 0.5], [25, 9, 0.45], [27, 13.5, 0.4], [29, 6.5, 0.5],
      [31, 10, 0.45], [33, 8, 0.4], [35, 10.5, 0.5], [12, 17, 0.4], [16, 12, 0.45],
      [20, 15, 0.4], [24, 14, 0.45], [28, 11, 0.4], [32, 12.5, 0.45], [36, 9.5, 0.4],
    ];
    for (const [x, y, r] of dots) {
      bctx.beginPath();
      bctx.arc(x, y, r, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  // Darkens a '#rrggbb' color toward black by `factor` (0-1, lower = darker)
  // for the far leg pair's in-shadow look, without needing a dedicated
  // palette entry.
  function shadeDark(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8) & 255) * factor);
    const b = Math.round((n & 255) * factor);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * @param {CanvasRenderingContext2D} bctx - low-res offscreen context, WIDTH x HEIGHT
   * @param {object} pose - { walkFrame, isWalking, tongueActive, tongueT, fadeT }
   * @param {object} palette - see chameleon-themes.js for shape; optional
   *   patchColor/patchStyle ('blotches' | 'speckle') paint a second color
   *   over the body, clipped to its silhouette.
   */
  function draw(bctx, pose, palette) {
    const p = palette;
    bctx.clearRect(0, 0, WIDTH, HEIGHT);
    bctx.imageSmoothingEnabled = false;

    // Camouflage is handled entirely as opacity (see the bootstrap's
    // globalAlpha = 1 - fadeT) so "hiding" fades all the way to invisible
    // rather than shifting hue toward the page background.
    const bodyColor = p.body;
    const darkColor = p.bodyDark;
    const lightColor = p.bodyLight;
    const crestColor = p.crest;

    const legLift = pose.walkFrame === 0 ? 1 : -1;
    const isWalking = !!pose.isWalking;
    // A tiny per-step sink applied to the body (and hips) on alternating
    // walk frames, on top of the bootstrap's smooth overall bob — reads as
    // the body settling its weight with each stride rather than gliding.
    const bodyDip = isWalking ? (pose.walkFrame === 0 ? 0 : 0.6) : 0;

    // Tail: tight double-coil spiral (thin line reads as sleeker/more
    // deliberate than a single loose loop), drawn first so the body
    // silhouette overlaps its base. While perched, the same base instead
    // hooks *down* past the ground line (y > ANCHOR_Y) to grip the edge
    // it's sitting on — since the whole sprite is already rotated/mirrored
    // to match whichever side of the element it's on (see the shared
    // ChameleonPath angle convention), this one hook shape automatically
    // reads as wrapping the correct edge without any per-side art.
    bctx.save();
    bctx.translate(0, bodyDip);
    // Gradient from the belly's light accent at the tail base fading to the
    // usual dark tail color within the first stretch of the coil — ties the
    // tail into the belly patch instead of reading as a separate dark
    // appendage bolted onto a light-bellied body.
    const tailGradient = pose.perched
      ? bctx.createLinearGradient(10, 17.5, 5, 22.5)
      : bctx.createLinearGradient(10, 17.5, 4, 12);
    tailGradient.addColorStop(0, lightColor);
    tailGradient.addColorStop(0.45, darkColor);
    tailGradient.addColorStop(1, darkColor);
    bctx.strokeStyle = tailGradient;
    bctx.lineWidth = 2;
    bctx.lineCap = 'round';
    bctx.beginPath();
    if (pose.perched) {
      bctx.moveTo(10, 17.5);
      bctx.bezierCurveTo(6, 19.5, 3, 21.5, 3, 24.5);
      bctx.bezierCurveTo(3, 27, 6, 27.7, 7.7, 25.8);
      bctx.bezierCurveTo(8.6, 24.7, 7.3, 23.7, 5.8, 24.2);
    } else {
      bctx.moveTo(10, 17.5);
      bctx.bezierCurveTo(4, 18, 0.5, 14.5, 2, 11);
      bctx.bezierCurveTo(3, 8.5, 6.5, 8, 6.5, 10.5);
      bctx.bezierCurveTo(6.5, 12, 4.5, 12, 4.5, 10.3);
    }
    bctx.stroke();
    bctx.restore();

    // Legs: four total (a near pair and, peeking out from behind them, a
    // far pair) so the stance reads as a quadruped rather than a biped
    // silhouette. Each leg bends at a knee that kicks slightly forward as
    // it swings, and the near pair's hips follow the body's bodyDip so
    // nothing separates from the belly mid-stride. The far pair swings on
    // the opposite phase from the near pair (diagonal gait: near-back and
    // far-front lift together), and is thinner/dimmer to read as farther
    // away.
    const legY = 14.5;
    const backLift = isWalking ? legLift : 0;
    const frontLift = isWalking ? -legLift : 0;
    const FRONT_LEG_XS = [27, 29]; // near-front, far-front

    function drawLeg(lx, lift, lineWidth, color, dip, lengthScale, hipInset) {
      const isFrontLeg = FRONT_LEG_XS.includes(lx);
      // The front legs' hip sits 2px higher (see below) so it stays tucked
      // under the belly, which makes its hip-to-foot span longer than the
      // back legs'. The same +/-1 lift is then a smaller fraction of that
      // longer span, so it visibly bounces less — boost the lift for the
      // whole front leg (hip, knee, and foot alike) to match the back leg's
      // bounce. Boosting only the hip here would leave the knee/foot
      // trailing behind it on the unboosted lift, which reads as the hip
      // jerking while the rest of the leg stays put rather than the leg
      // bending as a whole.
      const legLift = lift * (isFrontLeg ? 1.3 : 1);
      // hipInset pulls the hip a little further up, under the body fill
      // (drawn after the legs), so the near pair visibly plants into the
      // body instead of just touching its edge.
      const hipY = (isFrontLeg ? legY - 2 : legY) + legLift + dip - (hipInset || 0);
      const kneeX = lx - 0.5 + legLift * 0.6;
      const kneeY = legY + 3.3 * lengthScale + legLift * 0.5 + dip * 0.5;
      const footX = lx - 1;
      const footY = legY + 6.5 * lengthScale + legLift * 0.3;
      bctx.strokeStyle = color;
      bctx.lineWidth = lineWidth;
      bctx.lineCap = 'round';
      bctx.beginPath();
      bctx.moveTo(lx, hipY);
      bctx.lineTo(kneeX, kneeY);
      bctx.lineTo(footX, footY);
      bctx.stroke();
      bctx.beginPath();
      bctx.moveTo(footX, footY);
      bctx.lineTo(footX - 1.5, footY + 0.5);
      bctx.moveTo(footX, footY);
      bctx.lineTo(footX + 1.5, footY + 0.8);
      bctx.stroke();
    }

    // Far pair (far-back, far-front) first, so the near pair and body
    // silhouette overlap them — shaded a couple shades darker (in the
    // body's shadow) and shortened a bit so they read as the legs on the
    // far side of the body rather than just a copy of the near pair.
    const farColor = shadeDark(darkColor, 0.55);
    drawLeg(13.2, frontLift, 1.3, farColor, 0, 0.78); // far-back leg
    drawLeg(29, backLift, 1.3, farColor, 0, 0.78); // far-front leg

    // Near pair (near-back, near-front), drawn on top, hips tied to the
    // body's dip. Hips inset an extra 1.2px into the body silhouette
    // (painted afterward) so the legs read as planted into the body rather
    // than just butting up against its edge.
    drawLeg(14, backLift, 2, darkColor, bodyDip, 1, 1.2); // near-back leg
    drawLeg(27, frontLift, 2, darkColor, bodyDip, 1, 1.2); // near-front leg

    // Body + head + snout as one continuous, laterally-compressed
    // silhouette — kept low and long rather than round, closer to how a
    // real chameleon reads in profile.
    bctx.save();
    bctx.translate(0, bodyDip);
    bctx.fillStyle = bodyColor;
    bctx.beginPath();
    traceBodyPath(bctx);
    bctx.fill();
    bctx.strokeStyle = darkColor;
    bctx.lineWidth = 0.7;
    bctx.stroke();

    // Transition/speckled variants: a second color patched over the body,
    // clipped to the silhouette just traced so it can never spill onto the
    // legs/tail/eye drawn elsewhere.
    if (p.patchColor) {
      bctx.save();
      bctx.beginPath();
      traceBodyPath(bctx);
      bctx.clip();
      if (p.patchStyle === 'speckle') {
        drawSpeckle(bctx, p.patchColor);
      } else {
        drawBlotches(bctx, p.patchColor);
      }
      bctx.restore();
    }

    // Dorsal crest: a low row of spikes along the spine — the single
    // biggest lever for reading "sleek/stealthy" instead of "cute blob".
    bctx.fillStyle = crestColor;
    const crestSpikes = [
      [13, 9.5],
      [16.5, 8],
      [20, 7],
      [23.5, 6],
    ];
    for (const [cx, cy] of crestSpikes) {
      bctx.beginPath();
      bctx.moveTo(cx - 1, cy + 1.4);
      bctx.lineTo(cx, cy - 1.4);
      bctx.lineTo(cx + 1, cy + 1.4);
      bctx.closePath();
      bctx.fill();
    }

    // Belly patch: a filled band along the underside of the body, clipped
    // to the silhouette so it can't spill onto the legs/tail. Shaded with a
    // gradient (light at the belly edge, fading to body color toward the
    // top of the patch) so it blends into the rest of the body instead of
    // ending in a hard line.
    bctx.save();
    bctx.beginPath();
    traceBodyPath(bctx);
    bctx.clip();
    const bellyGradient = bctx.createLinearGradient(0, 17.7, 0, 7.5);
    bellyGradient.addColorStop(0, lightColor);
    bellyGradient.addColorStop(1, bodyColor);
    bctx.fillStyle = bellyGradient;
    bctx.beginPath();
    bctx.moveTo(10.2, 17.7);
    bctx.bezierCurveTo(16, 17.7, 24, 15.5, 31, 10.7); // along the belly's bottom edge, reaching up toward the snout
    bctx.bezierCurveTo(28, 7.8, 18, 10.5, 11.5, 12.3); // back up higher into the body
    bctx.closePath();
    bctx.fill();
    bctx.restore();

    // Casque spike: a bit taller than a bare accent but still a clean
    // triangle (not a flat-topped block) so it reads as a spike rather
    // than a square, and the body curve/ridge underneath it is untouched.
    bctx.fillStyle = darkColor;
    bctx.beginPath();
    bctx.moveTo(28.5, 4.8);
    bctx.lineTo(30.6, 0.9);
    bctx.lineTo(32.5, 5.3);
    bctx.closePath();
    bctx.fill();

    // Nose stripe: the same light accent used on the belly, run along the
    // top ridge of the snout. Starts back near where the belly patch's
    // forward tip reaches, so the two overlap slightly and read as one
    // continuous accent rather than two disconnected marks.
    bctx.strokeStyle = lightColor;
    bctx.lineWidth = 0.6;
    bctx.beginPath();
    bctx.moveTo(28.5, 7.8);
    bctx.bezierCurveTo(31.5, 6.3, 34.3, 7, 37.3, 9.3);
    bctx.stroke();

    // Eye turret with an accent ring, and a vertical slit pupil instead of
    // a round dot — the slit is what makes it read as watchful rather than
    // cartoonish.
    bctx.fillStyle = bodyColor;
    bctx.beginPath();
    bctx.arc(32, 8.5, 2.8, 0, Math.PI * 2);
    bctx.fill();
    bctx.strokeStyle = p.eyeRing;
    bctx.lineWidth = 0.6;
    bctx.stroke();
    // Light accent stripe just inside the ring, arcing around the top of
    // the pupil rather than crossing it.
    bctx.strokeStyle = lightColor;
    bctx.lineWidth = 0.4;
    bctx.beginPath();
    bctx.arc(32, 8.5, 2, Math.PI * 1.05, Math.PI * 1.75);
    bctx.stroke();
    bctx.fillStyle = p.eye;
    bctx.beginPath();
    bctx.ellipse(32.8, 8.5, 0.5, 1.6, 0, 0, Math.PI * 2);
    bctx.fill();

    // Tongue: length/speed/shape all come from the behavior's chosen
    // tongue mode (see TONGUE_MODES in chameleon-behavior.js) — "original"
    // is a plain symmetric ping-pong, the others snap out fast (eased,
    // within the first snapT of the cycle) and relax back in slower.
    if (pose.tongueActive) {
      const t = pose.tongueT || 0;
      const snapT = pose.tongueSnapT != null ? pose.tongueSnapT : 0.5;
      const extend = pose.tongueEase
        ? t < snapT
          ? Math.sin((t / snapT) * (Math.PI / 2))
          : (1 - t) / (1 - snapT)
        : t < 0.5
          ? t * 2
          : (1 - t) * 2;
      const len = (pose.tongueLen != null ? pose.tongueLen : 13) * extend;
      bctx.strokeStyle = p.tongue;
      bctx.lineWidth = 1.1;
      bctx.beginPath();
      bctx.moveTo(37.5, 10);
      bctx.lineTo(37.5 + len, 10);
      bctx.stroke();
      bctx.fillStyle = p.tongue;
      bctx.beginPath();
      bctx.arc(37.5 + len, 10, 0.9, 0, Math.PI * 2);
      bctx.fill();
    }
    bctx.restore();
  }

  global.ChameleonSprite = { WIDTH, HEIGHT, ANCHOR_X, ANCHOR_Y, draw };
})(window);
