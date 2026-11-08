// ```ev-tree 代码块：几个行动并排比 EV（设计见 设计_EV对比树和我的手牌.md 第一节）。这里是纯计算，node 里能测；画面在 ev-tree-view.mjs。
// 组件只做算术：概率和收益都由块里写明，不替书补频率。
import { evalCalc } from './textbook.mjs';

const VAR = /^([A-Za-z_]\w*)\s*=\s*(-?[\d.]+)$/;
const OUT = /^(.+?)\s+(其余|[^→]+?%)?\s*→\s*(.+)$/;

// 源码 → { 题目, 注, 出处, 决策, vars: [{ name, value, label, min, max }], actions: [{ name, outcomes: [{ label, prob（表达式，null = 其余）, pay }] }] }
// 写错就抛错，错误信息直接显示在页面上
export function parseEvTree(src) {
  const spec = { vars: [], actions: [] };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!m) throw new Error(`ev-tree 认不出这一行：${line}`);
    const key = m[1].trim();
    const val = m[2].trim();
    if (key === '变量') {
      const [def = '', label = '', range = ''] = val.split('|').map((s) => s.trim());
      const d = def.match(VAR);
      const r = range.match(/^(-?[\d.]+)\s*[-–~]\s*(-?[\d.]+)$/);
      if (!d || !label || !r) throw new Error(`变量要写成 名字 = 默认值 | 显示名 | 最小-最大：${val}`);
      const [min, max] = [Number(r[1]), Number(r[2])];
      if (!(min < max) || +d[2] < min || +d[2] > max) throw new Error(`变量的范围不对（默认值要在最小和最大之间）：${val}`);
      spec.vars.push({ name: d[1], value: Number(d[2]), label, min, max });
    } else if (key === '行动') {
      const [name, ...outs] = val.split('|').map((s) => s.trim());
      if (!name || !outs.length) throw new Error(`行动要写成 名字 | 结果 概率 → 收益 | …：${val}`);
      const outcomes = outs.map((o) => {
        const p = o.match(OUT);
        if (!p) throw new Error(`结果要写成 名称 概率% → 收益（只有一个结果时可以不写概率）：${o}`);
        return { label: p[1].trim(), prob: p[2] == null ? (outs.length === 1 ? '100' : null) : p[2] === '其余' ? null : p[2].replace(/%$/, '').trim(), pay: p[3].trim() };
      });
      if (outcomes.filter((o) => o.prob == null).length > 1) throw new Error(`一个行动里只能有一个“其余”：${val}`);
      spec.actions.push({ name, outcomes });
    } else if (['题目', '注', '出处', '决策'].includes(key)) spec[key] = val;
    else throw new Error(`ev-tree 不认识的字段：${key}（能写 题目 / 变量 / 行动 / 注 / 出处 / 决策）`);
  }
  if (spec.actions.length < 2 || spec.actions.length > 4) throw new Error('ev-tree 要写 2–4 个行动');
  if (spec.vars.length > 4) throw new Error('ev-tree 最多 4 个变量');
  const values = varValues(spec);
  for (const a of spec.actions) {
    for (const o of a.outcomes) {
      for (const e of [o.prob, o.pay]) if (e != null && evalCalc(e, values) == null) throw new Error(`算不出来（变量名写错了？）：${e}`);
    }
  }
  return spec;
}

export const varValues = (spec) => Object.fromEntries(spec.vars.map((v) => [v.name, v.value]));

// 一个行动在当前变量下：各结果的概率（%）和收益、EV；概率不在 0–100 或加起来不是 100 时 bad 写原因
export function evOf(action, vars) {
  let left = 100;
  const outs = action.outcomes.map((o) => {
    const p = o.prob == null ? null : evalCalc(o.prob, vars);
    if (p != null) left -= p;
    return { label: o.label, p, v: evalCalc(o.pay, vars) ?? NaN };
  });
  for (const o of outs) if (o.p == null) o.p = left;
  const total = outs.reduce((s, o) => s + o.p, 0);
  const bad = outs.some((o) => o.p < -1e-9 || o.p > 100 + 1e-9) ? '有概率不在 0–100% 之间'
    : Math.abs(total - 100) > 1e-6 ? `概率加起来是 ${round(total, 2)}%，不是 100%` : '';
  return { outs, ev: outs.reduce((s, o) => s + o.p / 100 * o.v, 0), bad };
}

const EPS = 1e-9;
export const bestOf = (evs) => {
  const top = Math.max(...evs);
  return evs.map((e, k) => (e > top - EPS ? k : -1)).filter((k) => k >= 0);
};

// 只改变量 x：横轴上每段 EV 最高的行动（并列的点不单独成段），和每个行动 EV 由负转正的位置
// → { segs: [{ best, from, to }]（相邻两段的分界取中点），zeros: [[x…]…] }
export function scanEvTree(spec, vars, x, steps = 2000) {
  const segs = [];
  const zeros = spec.actions.map(() => []);
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const xv = x.min + (x.max - x.min) * i / steps;
    const evs = spec.actions.map((a) => evOf(a, { ...vars, [x.name]: xv }).ev);
    if (prev) evs.forEach((e, k) => { if (prev[k] < 0 && e >= 0) zeros[k].push(xv); });
    prev = evs;
    const best = bestOf(evs);
    if (best.length > 1) continue;
    const last = segs.at(-1);
    if (last && last.best === best[0]) last.to = xv;
    else segs.push({ best: best[0], from: xv, to: xv });
  }
  for (let i = 1; i < segs.length; i++) {
    const mid = (segs[i - 1].to + segs[i].from) / 2;
    segs[i - 1].to = mid;
    segs[i].from = mid;
  }
  if (segs.length) { segs[0].from = x.min; segs.at(-1).to = x.max; }
  return { segs, zeros };
}

export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
