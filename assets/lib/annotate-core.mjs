// 批注的定位（不碰 DOM，可测试）：批注记的是被选中的原文（quote）和前后各一小段（prefix / suffix），不记位置；
// 原文被改过也尽量找回，对不上返回 null。
export const CONTEXT = 30;

// 选中 [start, end) 时要存的东西。
export const contextOf = (text, start, end) => ({ quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT) });

const commonSuffix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1; return n; };
const commonPrefix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n += 1; return n; };

// 在 text 里找 quote：出现多处时选前后文最像的那处；一处都没有返回 null。返回 [start, end)。
export function findAnchor(text, { quote, prefix = '', suffix = '' }) {
  if (!quote) return null;
  let best = null;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    const score = commonSuffix(text.slice(Math.max(0, at - prefix.length), at), prefix) + commonPrefix(text.slice(at + quote.length, at + quote.length + suffix.length), suffix);
    if (!best || score > best.score) best = { at, score };
  }
  return best ? [best.at, best.at + quote.length] : null;
}

// 卡片竖着排：每张想对齐的位置（tops）和高度（heights），不重叠；返回每张的 top。
export function stack(tops, heights, gap = 8) {
  const order = tops.map((t, i) => i).sort((a, b) => tops[a] - tops[b]);
  const out = [];
  let floor = -Infinity;
  for (const i of order) {
    out[i] = Math.max(tops[i], floor);
    floor = out[i] + heights[i] + gap;
  }
  return out;
}
