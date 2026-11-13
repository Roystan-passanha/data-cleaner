// Particle animation behind the landing page.
// shape 'bars': particles rise into the columns of a bar chart.
// shape 'grid': particles drift as a messy cloud, then settle into the rows and columns of a table.
// Stops when the page is hidden, when the canvas is off screen, and for people who ask for reduced motion.

const BG = '#05070d';
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // roughly -1..1, dense in the middle
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function startHero(canvas, shape = 'bars') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, parts = [], layout = null, raf = 0, last = 0, clock = Math.random() * 100;
  const pointer = { x: -9999, y: -9999 };

  function build() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const narrow = W < 760;
    const count = Math.round(Math.min(5200, (W * H) / (narrow ? 200 : 250)));
    parts = [];
    if (shape === 'bars') {
      const heights = narrow ? [0.34, 0.5, 0.44, 0.74, 1] : [0.26, 0.4, 0.34, 0.56, 0.48, 0.78, 1];
      const x0 = W * (narrow ? 0.1 : 0.3), x1 = W * (narrow ? 0.9 : 0.9);
      const slot = (x1 - x0) / heights.length;
      layout = { base: H * (narrow ? 0.6 : 0.8), top: H * (narrow ? 0.34 : 0.62), slot, bars: heights.map((h, i) => ({ x: x0 + slot * (i + 0.5), h, w: slot * 0.6 })) };
      const weight = heights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) {
        if (i < count * 0.14) { parts.push(dust()); continue; }
        let r = Math.random() * weight, b = 0;
        while (r > heights[b]) { r -= heights[b]; b++; }
        parts.push({ kind: 'bar', b, u: gauss(), t: Math.random(), v: rand(0.04, 0.14), size: rand(1.2, 3), tint: Math.random(), phase: rand(0, 6.28), ox: 0, oy: 0 });
      }
    } else {
      const cols = narrow ? 4 : 7, rows = narrow ? 7 : 8;
      const x0 = W * (narrow ? 0.08 : 0.32), x1 = W * 0.92, y0 = H * (narrow ? 0.2 : 0.2), y1 = H * (narrow ? 0.58 : 0.78);
      layout = { cols, rows, x0, x1, y0, y1, cw: (x1 - x0) / cols, rh: (y1 - y0) / rows };
      for (let i = 0; i < count; i++) {
        if (i < count * 0.14) { parts.push(dust()); continue; }
        const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
        // each cell holds a short dash, like a value typed into it
        const len = r === 0 ? 0.62 : rand(0.25, 0.7);
        parts.push({ kind: 'cell', c, r, hx: layout.x0 + (c + 0.14 + Math.random() * len) * layout.cw, hy: layout.y0 + (r + 0.5) * layout.rh + rand(-1.6, 1.6),
          mx: (x0 + x1) / 2 + gauss() * (x1 - x0) * 0.62, my: (y0 + y1) / 2 + gauss() * (y1 - y0) * 0.7, size: rand(1.3, 3), tint: Math.random(), phase: rand(0, 6.28), ox: 0, oy: 0 });
      }
    }
  }

  const dust = () => ({ kind: 'dust', x: Math.random(), y: Math.random(), vx: rand(-0.004, 0.004), vy: rand(-0.012, -0.002), size: rand(0.8, 1.8), tint: Math.random(), phase: rand(0, 6.28) });

  // deep blue at the bottom of the range, pale blue at the top, with a few violet and pink sparks
  function colour(tint, lift) {
    if (tint > 0.94) return `rgb(232, ${Math.round(140 + 60 * lift)}, 255)`;
    if (tint > 0.8) return `rgb(${Math.round(120 + 60 * lift)}, ${Math.round(110 + 70 * lift)}, 255)`;
    return `rgb(${Math.round(40 + 130 * lift)}, ${Math.round(110 + 110 * lift)}, 255)`;
  }

  function push(p, x, y) {
    const dx = x - pointer.x, dy = y - pointer.y, d2 = dx * dx + dy * dy;
    if (d2 < 9000) { const f = (1 - d2 / 9000) * 16, d = Math.sqrt(d2) || 1; p.ox += ((dx / d) * f - p.ox) * 0.2; p.oy += ((dy / d) * f - p.oy) * 0.2; }
    else { p.ox *= 0.92; p.oy *= 0.92; }
  }

  function frame(dt) {
    clock += dt;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    // soft glow behind the shape
    const gx = shape === 'bars' ? (layout.bars[0].x + layout.bars[layout.bars.length - 1].x) / 2 : (layout.x0 + layout.x1) / 2;
    const gy = shape === 'bars' ? layout.base - layout.top * 0.35 : (layout.y0 + layout.y1) / 2;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.55);
    glow.addColorStop(0, 'rgba(37, 99, 235, 0.34)'); glow.addColorStop(0.5, 'rgba(49, 46, 129, 0.16)'); glow.addColorStop(1, 'rgba(5, 7, 13, 0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    if (shape === 'bars') {
      // ripples on the floor under the chart
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const r = ((clock * 0.07 + k / 6) % 1);
        ctx.globalAlpha = (1 - r) * 0.45;
        ctx.strokeStyle = '#3b82f6';
        ctx.beginPath(); ctx.ellipse(gx, layout.base + 6, W * (0.08 + r * 0.5), H * (0.012 + r * 0.085), 0, 0, 6.2832); ctx.stroke();
      }
    } else {
      // table lines fade in as the data settles
      const tidy = settle(0);
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.globalAlpha = 0.3 * tidy;
      ctx.beginPath();
      for (let r = 0; r <= layout.rows; r++) { const y = Math.round(layout.y0 + r * layout.rh) + 0.5; ctx.moveTo(layout.x0, y); ctx.lineTo(layout.x1, y); }
      for (let c = 0; c <= layout.cols; c++) { const x = Math.round(layout.x0 + c * layout.cw) + 0.5; ctx.moveTo(x, layout.y0); ctx.lineTo(x, layout.y1); }
      ctx.stroke();
    }

    for (const p of parts) {
      let x, y, a, lift;
      if (p.kind === 'dust') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        if (p.x < -0.02) p.x = 1.02; else if (p.x > 1.02) p.x = -0.02;
        x = p.x * W; y = p.y * H; lift = 0.5; a = 0.2 + 0.25 * Math.sin(clock * 0.8 + p.phase) ** 2;
      } else if (p.kind === 'bar') {
        const bar = layout.bars[p.b];
        p.t += p.v * dt; if (p.t > 1) { p.t -= 1; p.u = gauss(); }
        const tall = layout.top * bar.h * (1 + 0.05 * Math.sin(clock * 0.5 + p.b));
        const spread = 1 + 0.5 * (1 - p.t) * (1 - p.t); // a little wider at the base, like water rising
        x = bar.x + p.u * bar.w * 0.5 * spread + Math.sin(clock * 0.9 + p.phase) * 1.4;
        y = layout.base - p.t * tall;
        lift = p.t;
        a = (0.45 + 0.55 * (1 - Math.abs(p.u))) * Math.min(1, p.t * 9) * Math.min(1, (1 - p.t) * 4);
        push(p, x, y); x += p.ox; y += p.oy;
      } else {
        const m = settle(p.c * 0.07);
        const wob = (1 - m) * 10;
        x = p.mx + (p.hx - p.mx) * m + Math.sin(clock * 0.6 + p.phase) * wob;
        y = p.my + (p.hy - p.my) * m + Math.cos(clock * 0.5 + p.phase * 1.7) * wob;
        lift = p.r === 0 ? 0.95 : 0.35 + 0.3 * m;
        a = p.r === 0 ? 0.65 + 0.35 * m : 0.55 + 0.35 * m;
        push(p, x, y); x += p.ox; y += p.oy;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = colour(p.tint, lift);
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // 0 = messy cloud, 1 = tidy table. Cycle: messy 2s, settle 2.6s, tidy 5s, scatter 2s.
  function settle(delay) {
    const t = (clock - delay * 2.6 + 200) % 11.6;
    if (t < 2) return 0;
    if (t < 4.6) return ease((t - 2) / 2.6);
    if (t < 9.6) return 1;
    return 1 - ease((t - 9.6) / 2);
  }

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (W && H) frame(dt);
    schedule();
  }
  const visible = () => !document.hidden && canvas.offsetParent !== null && onScreen;
  function schedule() { if (!raf && !still && visible()) { raf = requestAnimationFrame(tick); } }
  let onScreen = true;

  function reset() {
    build();
    if (!W || !H) return;
    if (still) { clock = shape === 'grid' ? 6 : clock; frame(0); } // one finished frame, no movement
    else { last = performance.now(); schedule(); }
  }

  new ResizeObserver(reset).observe(canvas);
  new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; if (onScreen) { last = performance.now(); schedule(); } }).observe(canvas);
  document.addEventListener('visibilitychange', () => { last = performance.now(); schedule(); });
  const host = canvas.parentElement;
  host.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; });
  host.addEventListener('pointerleave', () => { pointer.x = pointer.y = -9999; });
  reset();
}
