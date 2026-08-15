/**
 * ChameleonPath — pure geometry for walking the inset perimeter of the
 * viewport (a rounded rectangle "track" the pet patrols). No DOM, no
 * timers, no state — just distance-along-loop <-> point/angle conversions.
 *
 * The loop is parameterized by a single scalar `s`: distance in pixels
 * measured clockwise from the bottom-left corner, wrapping at the total
 * perimeter length. Segment order: bottom -> right -> top -> left.
 *
 * `angle` is the rotation (radians) that should be applied to a sprite
 * drawn normally (walking rightward, feet at the bottom of its own frame)
 * so its feet point at the local edge instead of always at the screen's
 * bottom — e.g. on the right edge the sprite is rotated -90 degrees so
 * its feet press against the right wall instead of hanging in space.
 */
(function (global) {
  'use strict';

  function rectFor(w, h, m) {
    const left = m;
    const right = Math.max(m + 1, w - m);
    const top = m;
    const bottom = Math.max(m + 1, h - m);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  function segmentsFor(w, h, m) {
    const r = rectFor(w, h, m);
    return [
      { edge: 'bottom', angle: 0, from: { x: r.left, y: r.bottom }, to: { x: r.right, y: r.bottom }, len: r.width },
      { edge: 'right', angle: -Math.PI / 2, from: { x: r.right, y: r.bottom }, to: { x: r.right, y: r.top }, len: r.height },
      { edge: 'top', angle: Math.PI, from: { x: r.right, y: r.top }, to: { x: r.left, y: r.top }, len: r.width },
      { edge: 'left', angle: Math.PI / 2, from: { x: r.left, y: r.top }, to: { x: r.left, y: r.bottom }, len: r.height },
    ];
  }

  function perimeterLength(w, h, m) {
    const segs = segmentsFor(w, h, m);
    return segs.reduce((sum, seg) => sum + seg.len, 0);
  }

  // Distance -> { x, y, angle, edge } on the loop, wrapping at the total length.
  function pointAt(w, h, m, s) {
    const segs = segmentsFor(w, h, m);
    const total = segs.reduce((sum, seg) => sum + seg.len, 0);
    let d = ((s % total) + total) % total;
    for (const seg of segs) {
      if (d <= seg.len || seg === segs[segs.length - 1]) {
        const t = seg.len === 0 ? 0 : clamp01(d / seg.len);
        return {
          x: seg.from.x + (seg.to.x - seg.from.x) * t,
          y: seg.from.y + (seg.to.y - seg.from.y) * t,
          angle: seg.angle,
          edge: seg.edge,
        };
      }
      d -= seg.len;
    }
    // Unreachable, but keep a safe fallback.
    return { x: segs[0].from.x, y: segs[0].from.y, angle: segs[0].angle, edge: segs[0].edge };
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // Nearest point on the loop to an arbitrary (x, y), e.g. a button's
  // center that isn't itself on the perimeter. Returns { s, x, y, angle, edge }.
  function nearestS(w, h, m, x, y) {
    const segs = segmentsFor(w, h, m);
    let best = null;
    let cumulative = 0;
    for (const seg of segs) {
      const vx = seg.to.x - seg.from.x;
      const vy = seg.to.y - seg.from.y;
      const lenSq = vx * vx + vy * vy || 1;
      const t = clamp01(((x - seg.from.x) * vx + (y - seg.from.y) * vy) / lenSq);
      const px = seg.from.x + vx * t;
      const py = seg.from.y + vy * t;
      const dist = Math.hypot(x - px, y - py);
      if (!best || dist < best.dist) {
        best = { dist, s: cumulative + t * seg.len, x: px, y: py, angle: seg.angle, edge: seg.edge };
      }
      cumulative += seg.len;
    }
    return best;
  }

  // Which direction (+1 clockwise / -1 counter-clockwise) is the shorter
  // way from `fromS` to `toS` around the loop, and how far that is.
  function shortestDirection(fromS, toS, total) {
    const forward = ((toS - fromS) % total + total) % total;
    const backward = total - forward;
    return forward <= backward ? { dir: 1, dist: forward } : { dir: -1, dist: backward };
  }

  // Shortest-path interpolation between two angles (radians), used to ease
  // sprite rotation through corners instead of snapping.
  function lerpAngle(a, b, t) {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  global.ChameleonPath = { perimeterLength, pointAt, nearestS, shortestDirection, lerpAngle };
})(window);
