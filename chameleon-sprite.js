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

  // bg may be "rgb(r,g,b)" from getComputedStyle; normalize to hex-ish lerp.
  function blendToBg(color, bg, t) {
    const bgMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    const bgHex = bgMatch
      ? '#' + [1, 2, 3].map((i) => Number(bgMatch[i]).toString(16).padStart(2, '0')).join('')
      : '#ffffff';
    return lerpColor(color, bgHex, t);
  }

  /**
   * @param {CanvasRenderingContext2D} bctx - low-res offscreen context, WIDTH x HEIGHT
   * @param {object} pose - { walkFrame, isWalking, tongueActive, tongueT, fadeT }
   * @param {object} palette - see chameleon-themes.js for shape
   * @param {string} bgColor - computed page background, used for the camouflage blend
   */
  function draw(bctx, pose, palette, bgColor) {
    const p = palette;
    bctx.clearRect(0, 0, WIDTH, HEIGHT);
    bctx.imageSmoothingEnabled = false;

    const fadeT = pose.fadeT || 0;
    const bodyColor = fadeT > 0 ? blendToBg(p.body, bgColor, fadeT) : p.body;
    const darkColor = fadeT > 0 ? blendToBg(p.bodyDark, bgColor, fadeT) : p.bodyDark;
    const lightColor = fadeT > 0 ? blendToBg(p.bodyLight, bgColor, fadeT) : p.bodyLight;
    const crestColor = fadeT > 0 ? blendToBg(p.crest, bgColor, fadeT) : p.crest;

    const legLift = pose.walkFrame === 0 ? 1 : -1;
    const isWalking = !!pose.isWalking;

    // Tail: tight double-coil spiral (thin line reads as sleeker/more
    // deliberate than a single loose loop), drawn first so the body
    // silhouette overlaps its base. While perched, the same base instead
    // hooks *down* past the ground line (y > ANCHOR_Y) to grip the edge
    // it's sitting on — since the whole sprite is already rotated/mirrored
    // to match whichever side of the element it's on (see the shared
    // ChameleonPath angle convention), this one hook shape automatically
    // reads as wrapping the correct edge without any per-side art.
    bctx.strokeStyle = darkColor;
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

    // Legs: thin and slightly forward-angled (a low, stalking stance
    // rather than a stubby standing one), with a small toe-fork foot.
    bctx.strokeStyle = darkColor;
    bctx.lineWidth = 2;
    bctx.lineCap = 'round';
    const legY = 16;
    for (const lx of [14, 27]) {
      const lift = lx === 14 ? (isWalking ? legLift : 0) : isWalking ? -legLift : 0;
      bctx.beginPath();
      bctx.moveTo(lx, legY + lift);
      bctx.lineTo(lx - 1, legY + 5 + lift);
      bctx.stroke();
      bctx.beginPath();
      bctx.moveTo(lx - 1, legY + 5 + lift);
      bctx.lineTo(lx - 2.5, legY + 5.5 + lift);
      bctx.moveTo(lx - 1, legY + 5 + lift);
      bctx.lineTo(lx + 0.5, legY + 5.8 + lift);
      bctx.stroke();
    }

    // Body + head + snout as one continuous, laterally-compressed
    // silhouette — kept low and long rather than round, closer to how a
    // real chameleon reads in profile.
    bctx.fillStyle = bodyColor;
    bctx.beginPath();
    bctx.moveTo(9, 17.5); // tail base / rear
    bctx.bezierCurveTo(9, 13, 13, 9, 19, 7.5); // low rise into shoulder
    bctx.bezierCurveTo(23, 6.5, 26, 5, 30, 5); // ridge toward casque
    bctx.bezierCurveTo(33, 5, 35, 6.5, 37.5, 9); // casque down to snout
    bctx.bezierCurveTo(38.5, 10, 38, 10.8, 36.5, 11.2); // snout underside
    bctx.bezierCurveTo(33.5, 10.5, 30, 11.3, 27.5, 13); // chin/throat back in
    bctx.bezierCurveTo(22, 16.5, 16, 17.8, 10, 17.8); // belly back to tail base
    bctx.closePath();
    bctx.fill();
    bctx.strokeStyle = darkColor;
    bctx.lineWidth = 0.7;
    bctx.stroke();

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

    // Thin flank stripe instead of a large bright belly patch — keeps the
    // silhouette dark and low-contrast (mysterious) while still hinting
    // at volume.
    bctx.strokeStyle = lightColor;
    bctx.lineWidth = 0.6;
    bctx.beginPath();
    bctx.moveTo(13, 14.5);
    bctx.bezierCurveTo(19, 15, 25, 13, 30, 9.5);
    bctx.stroke();

    // Casque spike.
    bctx.fillStyle = darkColor;
    bctx.beginPath();
    bctx.moveTo(28.5, 5.2);
    bctx.lineTo(30.5, 2);
    bctx.lineTo(32.5, 5.4);
    bctx.closePath();
    bctx.fill();

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
  }

  global.ChameleonSprite = { WIDTH, HEIGHT, ANCHOR_X, ANCHOR_Y, draw };
})(window);
