// ```ev-tree 代码块的画面：滑杆 → 行动树（每个行动的 EV、最高 / 少多少、各结果）→ 折线图（横轴是最近拖动的变量）→ 读数。
// 计算在 ev-tree.mjs。好红坏绿：EV 为正红、为负绿。
import { h, s } from './dom.mjs';
import { bestOf, evOf, parseEvTree, round, scanEvTree, varValues } from './ev-tree.mjs';
import { MARK_RE, resolveMark } from './textbook.mjs';

const COLORS = ['var(--muted)', 'var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const MINUS = '−';
const num = (v, d = 2) => { const r = round(v, d); return `${r < 0 ? MINUS : ''}${Math.abs(r)}`; };
const signed = (v) => (round(v, 2) > 0 ? `+${num(v)}` : num(v));
const tone = (v) => (round(v, 2) > 0 ? 'pos' : round(v, 2) < 0 ? 'neg' : '');
const dot = (k) => h('i', { class: 'evt-dot', style: `background:${COLORS[k]}` });

// 出处 “一年级01 p15” → 原书页链接（写法和 hand 块一样）
function sourceLink(text, chapters) {
  const m = [...`[${text}]`.matchAll(MARK_RE)][0];
  const r = m && resolveMark(m, { chapter: null, chapters, hasText: () => false, concepts: null });
  return r?.href && !r.error ? h('a', { class: 'tb-src', href: r.href, textContent: text }) : h('span', { class: 'tb-src', textContent: text });
}

function chart(spec, vars, results, x) {
  // 手机上画得窄一点，字才不会缩得太小（用户 2026-11-08 设计稿第 3 条）
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const W = narrow ? 380 : 600, H = narrow ? 240 : 230, L = 36, R = narrow ? 84 : 100, T = 12, B = 30;
  const pts = spec.actions.map((a) => Array.from({ length: 121 }, (_, i) => {
    const xv = x.min + (x.max - x.min) * i / 120;
    return [xv, evOf(a, { ...vars, [x.name]: xv }).ev];
  }));
  const ys = pts.flat().map((p) => p[1]).filter(Number.isFinite).concat(0);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => L + (v - x.min) / (x.max - x.min) * (W - L - R);
  const sy = (v) => T + (y1 - v) / (y1 - y0 || 1) * (H - T - B);
  const text = (attrs, t) => { const e = s('text', attrs); e.textContent = t; return e; };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'evt-chart', role: 'img', 'aria-label': `各行动 EV 随${x.label}变化` });
  svg.append(s('line', { x1: L, x2: W - R, y1: sy(0), y2: sy(0), stroke: 'var(--axis)' }),
    text({ x: L - 6, y: sy(0) + 4, 'text-anchor': 'end', class: 'evt-tick' }, '0'),
    text({ x: L - 6, y: sy(y1) + 4, 'text-anchor': 'end', class: 'evt-tick' }, y1 ? num(y1, 0) : ''),
    text({ x: sx(x.min), y: H - 8, 'text-anchor': 'start', class: 'evt-tick' }, String(x.min)),
    text({ x: sx(x.max), y: H - 8, 'text-anchor': 'end', class: 'evt-tick' }, String(x.max)),
    text({ x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle', class: 'evt-tick' }, `${x.label}（%）→`));
  pts.forEach((p, k) => svg.append(s('polyline', {
    points: p.map(([a, b]) => `${sx(a)},${sy(b)}`).join(' '), fill: 'none', stroke: COLORS[k], 'stroke-width': 2,
    'stroke-linejoin': 'round', ...(k === 0 ? { 'stroke-dasharray': '5 4' } : {}),
  })));
  // 线尾直接标行动名，挨太近就上下推开
  const ends = pts.map((p, k) => ({ k, y: sy(p.at(-1)[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
  for (const e of ends) svg.append(text({ x: W - R + 6, y: e.y + 4, class: 'evt-end' }, spec.actions[e.k].name));
  const cx = sx(vars[x.name]);
  svg.append(s('line', { x1: cx, x2: cx, y1: T, y2: H - B, stroke: 'var(--ink-2)', 'stroke-dasharray': '2 3' }));
  results.forEach((r, k) => svg.append(s('circle', { cx, cy: sy(r.ev), r: 4.5, fill: COLORS[k], stroke: 'var(--surface)', 'stroke-width': 2 })));
  return svg;
}

// 读数：只改横轴变量时各段谁最高；每个下注从哪里开始正 EV、从哪里开始最高
function reading(spec, vars, x) {
  const { segs, zeros } = scanEvTree(spec, vars, x);
  const r1 = (v) => round(v, 1);
  const lines = [h('div', {}, h('b', { textContent: `只改「${x.label}」，EV 最高的行动：` }),
    ...segs.map((g, i) => h('span', { class: 'evt-seg' }, dot(g.best), `${r1(g.from)}–${r1(g.to)}% ${spec.actions[g.best].name}${i < segs.length - 1 ? '；' : ''}`)))];
  if (!segs.length) lines.push(h('div', { class: 'muted', textContent: '整段都是并列最高。' }));
  zeros.forEach((z, k) => {
    if (!z.length) return;
    const flip = segs.find((g, i) => i > 0 && g.best === k);
    lines.push(h('div', { class: 'muted', textContent: `${spec.actions[k].name}：${x.label}过 ${r1(z[0])}% 就是正 EV`
      + (flip ? `，过 ${r1(flip.from)}% 才是最高 EV。` : segs.some((g) => g.best === k) ? '。' : '，但在这个范围里一直不是最高 EV。') }));
  });
  return lines;
}

export function evTree(src, chapters = []) {
  const spec = parseEvTree(src);
  const vars = varValues(spec);
  let active = spec.vars[0];   // 图的横轴跟着最近拖动的变量；没有变量就不画图
  const sliders = spec.vars.map((v) => {
    const out = h('b');
    const input = h('input', { type: 'range', min: v.min, max: v.max, step: (v.max - v.min) > 20 ? 0.5 : 0.1, value: v.value, 'aria-label': v.label });
    input.addEventListener('input', () => { vars[v.name] = Number(input.value); active = v; update(); });
    return { v, out, row: h('label', { class: 'evt-var' }, h('span', { textContent: v.label }), input, out) };
  });
  const tree = h('div', { class: 'evt-tree' });
  const chartBox = h('div', { class: 'evt-chart-box' });
  const read = h('div', { class: 'evt-read', 'aria-live': 'polite' });
  const warn = h('p', { class: 'tb-bad tb-note', hidden: true });

  function update() {
    for (const x of sliders) x.out.textContent = `${vars[x.v.name]}%`;
    const results = spec.actions.map((a) => evOf(a, vars));
    const best = bestOf(results.map((r) => r.ev));
    const top = results[best[0]].ev;
    tree.replaceChildren(h('div', { class: 'evt-root', textContent: spec.决策 || '我的决定' }),
      h('ul', {}, ...spec.actions.map((a, k) => {
        const r = results[k];
        const isBest = best.includes(k);
        return h('li', { class: isBest ? 'evt-best' : '' },
          h('div', { class: 'evt-act' }, dot(k), h('span', { textContent: a.name }),
            h('strong', { class: tone(r.ev), textContent: `EV ${signed(r.ev)}` }),
            isBest ? h('em', { textContent: best.length > 1 ? '并列最高' : '最高' }) : h('small', { textContent: `少 ${num(top - r.ev)}` })),
          h('ul', {}, ...r.outs.map((o) => h('li', { class: 'evt-out' },
            h('span', { textContent: o.label }), h('span', { class: 'muted', textContent: `${num(o.p, 1)}%` }),
            h('span', { textContent: `→ ${signed(o.v)}` })))));
      })));
    const bad = results.map((r, k) => (r.bad ? `${spec.actions[k].name}：${r.bad}` : '')).filter(Boolean);
    warn.hidden = !bad.length;
    warn.textContent = bad.length ? `${bad.join('；')}（检查块里的概率写法）` : '';
    if (active) {
      chartBox.replaceChildren(chart(spec, vars, results, active));
      read.replaceChildren(...reading(spec, vars, active));
    }
  }
  update();
  return h('fieldset', { class: 'tb-experiment evt' },
    h('legend', { textContent: spec.题目 || '行动 EV 对比' }),
    ...sliders.map((x) => x.row),
    h('div', { class: 'evt-body' }, tree, active ? chartBox : null), warn, active ? read : null,
    spec.注 || spec.出处 ? h('p', { class: 'evt-foot muted' }, spec.注 ? `${spec.注} ` : '', spec.出处 ? sourceLink(spec.出处, chapters) : null) : null);
}
