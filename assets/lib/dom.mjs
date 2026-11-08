// 页面共用的小工具：建元素、数字格式、提示框、ROI 区间小图。

const NS = 'http://www.w3.org/2000/svg';
const MINUS = '−';

export const usd = (v, digits = 0) => {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -digits ? MINUS : ''}$${s}`;
};
export const pct = (v, sign = false, digits = 1) =>
  `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -(digits + 2) ? MINUS : sign && v > 0 ? '+' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
export const int = (v) => v.toLocaleString('en-US');
// “比这更差的比例”的显示：两端写成 <1%、>99%。
export const share = (p) => (p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`);

// 范围输入：两个数字框，空着就是不限。init 是初始值 [lo, hi]。
export function rangeInput(label, onChange, init = [null, null], min = '1') {
  const box = (ph, v) => {
    const i = h('input', { type: 'number', min, step: 'any', inputmode: 'decimal', placeholder: ph, 'aria-label': `${label}${ph}`, value: v ?? '' });
    i.addEventListener('input', () => onChange(read()));
    return i;
  };
  const lo = box('最小', init[0]);
  const hi = box('最大', init[1]);
  const num = (i) => (i.value === '' ? null : Number(i.value));
  const read = () => [num(lo), num(hi)];
  return h('label', { class: 'range' }, label, lo, '–', hi);
}

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const h = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

export const s = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// 提示框：放在 container（position: relative）里，show(x, y, {title, rows}) 的坐标相对 container。
export function tooltip(container) {
  const tip = h('div', { class: 'tooltip', hidden: true });
  container.append(tip);
  return {
    show(x, y, { title, rows }) {
      tip.replaceChildren(h('div', { class: 'tip-title', textContent: title }));
      for (const [k, v] of rows) {
        tip.append(h('div', { class: 'tip-row' }, h('span', { textContent: k }), h('span', { class: 'num', textContent: v })));
      }
      tip.hidden = false;
      const w = container.clientWidth;
      const left = x + 12 + tip.offsetWidth > w ? x - 12 - tip.offsetWidth : x + 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, Math.min(y - tip.offsetHeight / 2, container.clientHeight - tip.offsetHeight))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

// ROI 区间小图：区间线 + 点估计 + 0 刻度。scale = [lo, hi] 时多行共用同一刻度，超出的部分截断。
export function ciBar(roi, ci, scale) {
  const [lo, hi] = scale ?? [Math.min(ci.lo, 0), Math.max(ci.hi, 0)];
  const pad = (hi - lo) * 0.06;
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  const x = (v) => `${((clamp(v) - lo + pad) / (hi - lo + 2 * pad)) * 100}%`;
  const svg = s('svg', { class: 'ci-bar', 'aria-hidden': 'true' });
  svg.append(
    s('line', { class: 'ci-zero', x1: x(0), x2: x(0), y1: 2, y2: 16 }),
    s('line', { class: 'ci-range', x1: x(ci.lo), x2: x(ci.hi), y1: 9, y2: 9 }),
    s('circle', { class: 'ci-point', cx: x(roi), cy: 9, r: 4 }),
  );
  return svg;
}
