#!/usr/bin/env node
// 范围图：把一段范围文本画成 13×13 的手牌格子（SVG，可选 PNG），样式参照 GTO Wizard。给项目里的 Claude agent 在对话里向用户展示范围用。
// 组合数、各行动占比都由这里精确计算（对子 6、同花 4、杂色 12，全部 1,326 组合）。
//
// ===== 维护状态和接续（2026-11-01，“数据与工具开发”）=====
//   已确认：agent 估计的范围一律写 `来源: 示意`（图上标“无 solver 依据”，不显示格子数字）；solver 数据（GTO Wizard、HRC）才写具体来源。
//   位置：回归测试 `node --test 工具/test_range.mjs`（11 个，2026-11-01 全过），其中 `工具/fixtures/range_gw_screenshot.txt` 是 2026-10-10 用户发的 GTO Wizard 截图逐格测色录入的范围（占比和截图差约 0.2 个百分点）；
//         输出默认在 `工具/输出/`（不进 git）。`--png` 需要本机 Chrome。
//   待验证：样式只参照了 GTO Wizard 的一张截图；换了别的 solver 的截图风格时，格式和配色没有核对过。
//
// ===== 用法 =====
//   node 工具/range.mjs <范围文件>|- [--out 文件.svg] [--png]
//   范围文件用 - 表示从 stdin 读，agent 一般这样用：
//     node 工具/range.mjs - <<'EOF'
//     标题: CO open（对手，常规 reg）
//     来源: 示意
//     可信度: 中
//     Raise: 22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, ATo+, KTo+, QTo+, JTo
//     EOF
//   --out   输出路径，默认 工具/输出/range_<标题>.svg（同名覆盖）
//   --png   同时用本机 Chrome 无头模式导出 2 倍清晰度的 PNG（同名 .png）
//   输出：生成的文件路径、范围内总组合数、各行动的组合数和占比。把图发给用户用 SendUserFile（display: render）。
//
// ===== 范围文件格式 =====
//   每行 “键: 值”，空行和 # 开头的行忽略。键是下面的保留字，其余的键都当作行动名（按出现顺序画，格子里从左到右、顶部从左到右同序）。
//   标题 / title       图的标题
//   说明 / note        标题下的一行小字（可选）
//   来源 / source      solver 数据写 GTO Wizard、HRC 等；agent 自己估计的写“示意”。示意图会标明“无 solver 依据”，并且不显示格子数字
//   可信度 / confidence 示意图的可信度（高 / 中 / 低），可选
//   格子数字 / numbers 格子右下角的数字，如 “AA 5.77, AKs 3.58” 或 “AA:5.77”（EV、频率、组合数都行，原样显示）
//   剩余 / rest        没分配给任何行动的部分叫什么，默认 Fold（灰色）。写“无”则留空（只画一个范围、没有弃牌概念时用）
//   <行动名>: <范围>   如 “Allin 11bb: 22+, A2s+”。同一行动可以写多行，会合并。行动名后加 [#rrggbb] 可指定颜色
//   默认配色同 GTO Wizard：fold 灰、call/check 绿、raise/bet/3bet 橙、allin/jam/push 红；其它名字和重复的颜色依次取蓝、紫、青、黄、粉。
//
// ===== 范围写法 =====
//   逗号或空格分隔，每项后面可加 :权重（0—1，或写百分比 50%），不写就是 1。同一行动里后写的覆盖先写的。
//   AA  AKs  AKo  AK（同花 + 杂色）     22+  A2s+  KTo+  K9+     TT-66  A5s-A2s  K9o-K6o
//   具体组合 AsKs、AhKd：按组合数折算成这类手牌的一部分（AsKs:1 = AKs 的 1/4）。GTO Wizard / HRC / Pio 复制的 “AA:1,AKs:0.5,...” 可以直接用。
//   一手牌在各行动的权重合计不能超过 1；四舍五入造成的略超（≤ 1.01）按比例缩回 1，超得更多报错。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = 'AKQJT98765432';
const TOTAL = 1326;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 13×13 格子：对角线是对子，右上是同花，左下是杂色
export const HANDS = [];
for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++)
  HANDS.push(i === j ? R[i] + R[j] : i < j ? R[i] + R[j] + 's' : R[j] + R[i] + 'o');
export const combos = (h) => (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12);

const rank = (c) => {
  const k = R.indexOf(c);
  if (k < 0) throw new Error(`不认识的点数：${c}`);
  return k;
};

// 一个范围项（不含权重）→ 手牌类列表
function expand(tok) {
  const m = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)$/);
  const d = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/);
  const suffixes = (s) => (s ? [s] : ['s', 'o']);
  if (m) {
    const [, a, b, s, plus] = m;
    const ia = rank(a), ib = rank(b);
    if (ia === ib) {
      if (s) throw new Error(`对子不能带 s/o：${tok}`);
      return plus ? R.slice(0, ia + 1).split('').map((c) => c + c) : [a + b];
    }
    const [hi, lo] = ia < ib ? [ia, ib] : [ib, ia];
    const out = [];
    for (let k = plus ? hi + 1 : lo; k <= lo; k++) for (const x of suffixes(s)) out.push(R[hi] + R[k] + x);
    return out;
  }
  if (d) {
    const [, a1, b1, s1, a2, b2, s2] = d;
    if (s1 !== s2) throw new Error(`区间两端的 s/o 不一致：${tok}`);
    if (a1 === b1 && a2 === b2) {
      const [x, y] = [rank(a1), rank(a2)].sort((p, q) => p - q);
      return R.slice(x, y + 1).split('').map((c) => c + c);
    }
    if (a1 !== a2 || a1 === b1 || a2 === b2) throw new Error(`区间要么都是对子，要么第一张相同：${tok}`);
    const hi = rank(a1);
    const [x, y] = [rank(b1), rank(b2)].sort((p, q) => p - q);
    if (x <= hi) throw new Error(`区间第二张要比第一张小：${tok}`);
    const out = [];
    for (let k = x; k <= y; k++) for (const s of suffixes(s1)) out.push(R[hi] + R[k] + s);
    return out;
  }
  throw new Error(`看不懂的范围写法：${tok}`);
}

// 具体组合（AsKs）→ [手牌类, 占这类的比例]
function comboClass(tok) {
  const [a, sa, b, sb] = tok;
  if (rank(a) === rank(b)) {
    if (sa === sb) throw new Error(`不存在的组合：${tok}`);
    return [a + b, 1 / 6];
  }
  const [hi, lo] = rank(a) < rank(b) ? [a, b] : [b, a];
  return sa === sb ? [hi + lo + 's', 1 / 4] : [hi + lo + 'o', 1 / 12];
}

function parseWeight(s, tok) {
  const w = s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s);
  if (!Number.isFinite(w) || w < 0 || w > 1) throw new Error(`权重要在 0—1 之间：${tok}`);
  return w;
}

// 范围文本 → { 手牌类: 权重 }
export function parseRange(text) {
  const out = {};
  const comboAcc = {};
  for (const raw of text.split(/[,，\s]+/).filter(Boolean)) {
    const [body, ws] = raw.split(':');
    const w = ws === undefined ? 1 : parseWeight(ws, raw);
    if (/^[2-9tjqka][shdc][2-9tjqka][shdc]$/i.test(body)) {
      const t = body[0].toUpperCase() + body[1].toLowerCase() + body[2].toUpperCase() + body[3].toLowerCase();
      const [h, f] = comboClass(t);
      comboAcc[h] = (comboAcc[h] ?? 0) + w * f;
      out[h] = comboAcc[h];
      continue;
    }
    const norm = body.replace(/[2-9tjqka]/gi, (c) => c.toUpperCase()).replace(/S/g, 's').replace(/O/g, 'o');
    for (const h of expand(norm)) out[h] = w;
  }
  for (const [h, w] of Object.entries(out)) if (w > 1 + 1e-9) throw new Error(`${h} 的具体组合权重合计超过 1`);
  return out;
}

const KEYS = {
  标题: 'title', title: 'title', 说明: 'note', note: 'note', 来源: 'source', source: 'source',
  可信度: 'confidence', confidence: 'confidence', 格子数字: 'numbers', numbers: 'numbers', 剩余: 'rest', rest: 'rest',
};
const PALETTE = ['#3b7dd8', '#8e5bd6', '#17a2a2', '#d4b106', '#d6478b'];
function defaultColor(name) {
  const n = name.toLowerCase();
  if (/fold|弃/.test(n)) return '#9b9b9b';
  if (/all.?in|jam|shove|push|全下/.test(n)) return '#e00000';
  if (/raise|bet|open|[345]b|加注|下注/.test(n)) return '#e8791a';
  if (/call|check|跟|过牌/.test(n)) return '#3b9a35';
  return null;
}

// 范围文件 → 规格
export function parseSpec(text) {
  const spec = { title: '', note: '', source: '', confidence: '', numbers: {}, rest: 'Fold', actions: [], warnings: [] };
  const byName = new Map();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([^:：]+)[:：](.*)$/);
    if (!m) throw new Error(`这一行没有 “键: 值”：${t}`);
    let key = m[1].trim();
    const val = m[2].trim();
    const field = KEYS[key.toLowerCase()] ?? KEYS[key];
    if (field === 'numbers') {
      for (const [, h, v] of val.matchAll(/([2-9TJQKA]{2}[so]?)\s*[:：\s]\s*(-?[\d.]+%?)/gi)) {
        const norm = h.slice(0, 2).toUpperCase() + h.slice(2).toLowerCase();
        if (!HANDS.includes(norm)) throw new Error(`格子数字里不认识的手牌：${h}`);
        spec.numbers[norm] = v;
      }
    } else if (field) {
      spec[field] = val;
    } else {
      let color = null;
      const c = key.match(/^(.*?)\s*\[(#[0-9a-fA-F]{6})\]$/);
      if (c) [key, color] = [c[1], c[2]];
      if (!byName.has(key)) {
        const a = { name: key, color, freq: {} };
        byName.set(key, a);
        spec.actions.push(a);
      }
      const a = byName.get(key);
      if (color) a.color = color;
      Object.assign(a.freq, parseRange(val));
    }
  }
  if (!spec.actions.length) throw new Error('没有任何行动（比如 “Raise: 22+, A2s+”）');
  if (/^(无|none|-)$/i.test(spec.rest)) spec.rest = '';

  const used = new Set(spec.rest ? [defaultColor(spec.rest) ?? '#9b9b9b'] : []);
  let p = 0;
  for (const a of spec.actions) {
    if (!a.color) {
      a.color = defaultColor(a.name);
      if (!a.color || used.has(a.color)) a.color = PALETTE[p++ % PALETTE.length];
    }
    used.add(a.color);
  }

  // 合计略超 1（四舍五入造成，≤ 1.01）按比例缩回 1；超得更多报错
  const sum = (h) => spec.actions.reduce((s, a) => s + (a.freq[h] ?? 0), 0);
  const over = HANDS.filter((h) => sum(h) > 1.01);
  if (over.length) throw new Error(`这些手牌在各行动的权重合计超过 1：${over.join(' ')}`);
  for (const h of HANDS) {
    const t = sum(h);
    if (t > 1) for (const a of spec.actions) if (a.freq[h]) a.freq[h] /= t;
  }

  spec.sketch = /示意/.test(spec.source);
  if (spec.sketch && Object.keys(spec.numbers).length) {
    spec.warnings.push('来源是“示意”，格子数字不显示');
    spec.numbers = {};
  }
  return spec;
}

export function stats(spec) {
  const acts = spec.actions.map((a) => {
    const c = HANDS.reduce((s, h) => s + (a.freq[h] ?? 0) * combos(h), 0);
    return { name: a.name, color: a.color, combos: c, pct: (c / TOTAL) * 100 };
  });
  const inRange = acts.reduce((s, a) => s + a.combos, 0);
  const rest = spec.rest
    ? { name: spec.rest, color: defaultColor(spec.rest) ?? '#9b9b9b', combos: TOTAL - inRange, pct: ((TOTAL - inRange) / TOTAL) * 100, rest: true }
    : null;
  return { acts, rest, inRange, inRangePct: (inRange / TOTAL) * 100 };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtC = (c) => (Math.abs(c - Math.round(c)) < 0.05 ? Math.round(c).toLocaleString('en-US') : c.toFixed(1));
const fmtP = (p) => p.toFixed(1) + '%';
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111' : '#fff';
}

export function renderSvg(spec) {
  const st = stats(spec);
  const PAD = 16, CW = 72, CH = 56, GW = CW * 13, W = GW + PAD * 2;
  const FONT = `-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif`;
  const EMPTY = '#2b313a';
  const o = [];
  let y = PAD;

  if (spec.title || spec.sketch) {
    y += 24;
    let tx = `<tspan>${esc(spec.title)}</tspan>`;
    if (spec.sketch) tx += `<tspan dx="12" font-size="15" fill="#f2b84b">示意</tspan>`;
    o.push(`<text x="${PAD}" y="${y}" font-size="24" font-weight="600" fill="#e8eaed">${tx}</text>`);
    y += 8;
  }
  if (spec.note) {
    y += 20;
    o.push(`<text x="${PAD}" y="${y}" font-size="15" fill="#9aa0a6">${esc(spec.note)}</text>`);
    y += 4;
  }

  y += 12;
  const btns = [...st.acts, ...(st.rest ? [st.rest] : [])];
  const BG = 8, BH = 50, BW = (GW - BG * (btns.length - 1)) / btns.length;
  btns.forEach((b, k) => {
    const x = PAD + k * (BW + BG);
    const label = `${b.name} (${fmtP(b.pct)})`;
    const fs = Math.min(20, (BW - 16) / Math.max(label.length * 0.55, 1));
    o.push(`<rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="5" fill="${b.color}"/>`);
    o.push(`<text x="${x + BW / 2}" y="${y + BH / 2 + fs * 0.35}" font-size="${fs.toFixed(1)}" text-anchor="middle" fill="${textOn(b.color)}">${esc(label)}</text>`);
  });
  y += BH + 12;

  const base = st.rest ? st.rest.color : EMPTY;
  HANDS.forEach((h, idx) => {
    const x = PAD + (idx % 13) * CW, cy = y + Math.floor(idx / 13) * CH;
    o.push(`<rect x="${x}" y="${cy}" width="${CW}" height="${CH}" fill="${base}"/>`);
    let sx = x, filled = 0;
    for (const a of spec.actions) {
      const f = a.freq[h] ?? 0;
      if (f <= 0) continue;
      o.push(`<rect x="${sx.toFixed(2)}" y="${cy}" width="${(f * CW).toFixed(2)}" height="${CH}" fill="${a.color}"/>`);
      sx += f * CW;
      filled += f;
    }
    const ink = st.rest || filled >= 0.5 ? '#111' : '#c4c8ce';
    o.push(`<text x="${x + 5}" y="${cy + 23}" font-size="21" fill="${ink}">${h}</text>`);
    if (spec.numbers[h] !== undefined)
      o.push(`<text x="${x + CW - 4}" y="${cy + CH - 6}" font-size="14" text-anchor="end" fill="${ink}">${esc(spec.numbers[h])}</text>`);
  });
  for (let k = 0; k <= 13; k++) {
    o.push(`<line x1="${PAD + k * CW}" y1="${y}" x2="${PAD + k * CW}" y2="${y + 13 * CH}" stroke="#4a4f57" stroke-width="1"/>`);
    o.push(`<line x1="${PAD}" y1="${y + k * CH}" x2="${PAD + GW}" y2="${y + k * CH}" stroke="#4a4f57" stroke-width="1"/>`);
  }
  y += 13 * CH;

  y += 26;
  o.push(`<text x="${PAD}" y="${y}" font-size="15" fill="#e8eaed">范围内 ${fmtC(st.inRange)} 组合 · 占全部 1,326 的 ${fmtP(st.inRangePct)}</text>`);
  y += 22;
  const src = spec.sketch
    ? `示意 · 无 solver 依据${spec.confidence ? ' · 可信度 ' + spec.confidence : ''}`
    : spec.source ? `来源：${spec.source}` : '';
  if (src) o.push(`<text x="${PAD}" y="${y}" font-size="14" fill="${spec.sketch ? '#f2b84b' : '#9aa0a6'}">${esc(src)}</text>`);
  y += PAD;

  const H = Math.ceil(y);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">\n` +
      `<rect width="${W}" height="${H}" fill="#12161c"/>\n${o.join('\n')}\n</svg>\n`,
    width: W, height: H, stats: st,
  };
}

function toPng(svgPath, pngPath, w, h) {
  const r = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${w},${h}`, `--screenshot=${pngPath}`, pathToFileURL(svgPath).href,
  ], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('Chrome 导出 PNG 失败：' + (r.stderr || r.error?.message || '').slice(-500));
}

function main(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  let input = null, out = null, png = false;
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--out') out = argv[++k];
    else if (a === '--png') png = true;
    else if (a.startsWith('--')) throw new Error(`不认识的参数：${a}`);
    else input = a;
  }
  if (!input) throw new Error('要给范围文件，或者用 - 从 stdin 读');
  const spec = parseSpec(readFileSync(input === '-' ? 0 : input, 'utf8'));
  const { svg, width, height, stats: st } = renderSvg(spec);

  if (!out) {
    const name = (spec.title || new Date().toISOString().slice(0, 19)).replace(/[\/\\:*?"<>|\s]+/g, '_').slice(0, 60);
    out = join(HERE, '输出', `range_${name}.svg`);
  }
  out = resolve(out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  const files = [out];
  if (png) {
    const p = out.replace(/\.svg$/i, '') + '.png';
    toPng(out, p, width, height);
    files.push(p);
  }

  for (const w of spec.warnings) console.error('注意：' + w);
  console.log('已生成：' + files.join('  '));
  console.log(`范围内 ${fmtC(st.inRange)} 组合（${fmtP(st.inRangePct)}）`);
  for (const a of [...st.acts, ...(st.rest ? [st.rest] : [])])
    console.log(`  ${a.name}${a.rest ? '（剩余）' : ''}  ${fmtC(a.combos)} 组合  ${fmtP(a.pct)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('出错：' + e.message); process.exit(1); }
}
