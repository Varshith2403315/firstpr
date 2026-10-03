// topo.js: draws the contour lines behind the headline.
// Two "peaks" of wobbly closed loops, smoothed with Catmull-Rom curves.
function loop(cx, cy, r, phase, wob) {
  const pts = [];
  for (let k = 0; k < 48; k++) {
    const a = (2 * Math.PI * k) / 48;
    const rr = r * (1 + wob * (0.55 * Math.sin(3 * a + phase) + 0.3 * Math.sin(5 * a + phase * 1.7) + 0.15 * Math.sin(2 * a - phase)));
    pts.push([cx + rr * Math.cos(a) * 1.25, cy + rr * Math.sin(a)]);
  }
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

export function drawTopo(svg) {
  const paths = [];
  for (let i = 1; i < 14; i++) paths.push([loop(560, 230, 22 * i, 0.4 + i * 0.18, 0.06 + i * 0.004), i % 5 === 0]);
  for (let i = 1; i < 7; i++) paths.push([loop(250, 470, 18 * i, 2.1 + i * 0.3, 0.08), i % 5 === 0]);
  svg.innerHTML = paths.map(([d, index]) => `<path d="${d}"${index ? ' class="index"' : ''}/>`).join('');
}
