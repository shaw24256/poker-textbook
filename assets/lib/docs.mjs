// 阅读区的公共部分：读 Markdown（/api/docs、/api/doc），把相对链接换成站内路由，渲染成 HTML。
// 只读：网站不写这些 .md。路径都是相对 Poker/ 的，比如 “记录/session/2026-10-10.md”。
import { Marked } from '../vendor/marked.esm.js';
import { withEntry } from './entry.mjs';

export const loadDocs = () => fetch('/api/docs').then((r) => {
  if (!r.ok) throw new Error(`/api/docs ${r.status}`);
  return r.json();
});
// 带正文的清单：笔记列表、全站搜索用。
export const loadDocsWithBody = () => fetch('/api/docs?body=1').then((r) => {
  if (!r.ok) throw new Error(`/api/docs ${r.status}`);
  return r.json();
});
export const loadDoc = (path) => fetch(`/api/doc?path=${encodeURIComponent(path)}`).then((r) => {
  if (!r.ok) throw new Error(r.status === 404 ? `找不到 ${path}` : `/api/doc ${r.status}`);
  return r.json();
});

// 零散型一周一个文件（这周开始的日期），专注型每次一个（开打那天加 _grind），见 记录/session/流程.md。捕获的是 session 的 id。
export const SESSION_RE = /^记录\/session\/(\d{4}-\d{2}-\d{2}(?:_grind)?)\.md$/;
export const REVIEW_RE = /^记录\/手牌复盘\/(.+)\.md$/;
export const DAILY = '记录/每日.md';
export const PENDING = '记录/手牌复盘/待复盘.md';   // 待复盘的手牌：单独的页面（journal/pending），不算一篇复盘
export const isReview = (path) => REVIEW_RE.test(path) && !path.endsWith('/复盘流程.md') && path !== PENDING;

// 附件（图片、文本）：和 server.py 的 safe_path 一致，只在这几个目录下。
const FILE_DIRS = ['记录', '知识库', '资料'];
const FILE_EXT = /\.(png|jpe?g|gif|webp|svg|txt|py|mjs|json)$/i;
export const fileUrl = (path) => `/files/${path.split('/').map(encodeURIComponent).join('/')}`;
const fileAllowed = (path) => FILE_DIRS.includes(path.split('/')[0]) && FILE_EXT.test(path);

// base 文件里的相对链接 → 相对 Poker/ 的路径；跳出 Poker/ 或是绝对路径时返回 null。
export function resolvePath(base, href) {
  let raw = href.split('#')[0];
  try { raw = decodeURI(raw); } catch {}
  if (!raw || raw.startsWith('/')) return null;
  const parts = base.split('/').slice(0, -1);
  for (const seg of raw.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// 一篇 md 在站内的地址。
export function routeOf(path) {
  if (path === DAILY) return '#/journal';
  if (path === PENDING) return '#/journal/pending';
  let m = path.match(SESSION_RE);
  if (m) return `#/journal/session/${m[1]}`;
  m = path.match(REVIEW_RE);
  if (m && isReview(path)) return `#/journal/review/${encodeURIComponent(m[1])}`;
  m = path.match(/^记录\/读书\/胡萝卜扑克学校\/教材\/(.+)\.md$/);   // 胡萝卜整理版教材：章文件开章视图，主题.md 开教材目录
  if (m) return m[1] === '主题' ? '#/notes/text' : `#/notes/text/${encodeURIComponent(m[1])}`;
  return `#/doc/${encodeURIComponent(path)}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 链接分四种：站内页面（route）、附件（file，新标签页）、外部网址（external）、网站不开放的（dead，显示成灰字）。
export function classifyLink(base, href, docSet) {
  if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'dead', path: href };
  const path = resolvePath(base, href);
  if (path == null) return { kind: 'dead', path: href };
  if (path.endsWith('.md')) return docSet.has(path) ? { kind: 'route', href: routeOf(path), path } : { kind: 'dead', path };
  if (fileAllowed(path)) return { kind: 'file', href: fileUrl(path), path };
  return { kind: 'dead', path };
}

// 原始 HTML 里只放行折叠块：单独成行的 “<details><summary>标题</summary>” 和 “</details>”（前后要空一行，
// 中间的 Markdown 才会照常渲染）。标题按纯文字处理。默认收起，写 <details open> 就是展开。
export function foldTag(raw) {
  const s = raw.trim();
  if (s === '</details>') return '</details>';
  const m = s.match(/^<details( open)?>\s*(?:<summary>([^<]*)<\/summary>)?$/);
  if (!m) return null;
  return `<details class="fold"${m[1] ? ' open' : ''}><summary>${esc(m[2]?.trim() || '展开')}</summary>`;
}

// Markdown → HTML。不渲染 md 里的原始 HTML（当作文字，折叠块除外）；链接和图片按 base 文件的位置解析。
export function renderMarkdown(text, base, docSet) {
  const md = new Marked({ gfm: true });
  let open = 0;   // 还没关上的折叠块
  md.use({
    renderer: {
      html({ text: raw }) {
        const tag = foldTag(raw);
        if (tag === '</details>') {
          if (!open) return esc(raw);   // 前面没有打开的折叠块：结尾标签也当文字
          open -= 1;
          return tag;
        }
        if (tag) open += 1;
        return tag ?? esc(raw);
      },
      // Wendy 复盘卡片的数据块：先留占位，文章摆好后由 spot-view.mjs 画成模块。
      code({ text: src, lang }) {
        const [kind, arg = ''] = (lang ?? '').trim().split(/\s+/);
        if (kind === 'spot') return `<div class="spot-block" data-raw="${esc(src)}"></div>`;
        if (kind === 'range') return `<div class="range-block" data-node="${esc(arg)}"></div>`;
        return false;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const l = classifyLink(base, href, docSet);
        const t = title ? ` title="${esc(title)}"` : '';
        if (l.kind === 'dead') return `<span class="dead-link" title="${esc(l.path)}（网站里打不开）">${inner}</span>`;
        if (l.kind === 'route') return `<a href="${esc(l.href)}"${t}>${inner}</a>`;
        return `<a href="${esc(l.href)}"${t} target="_blank" rel="noopener">${inner}</a>`;
      },
      image({ href, title, text: alt }) {
        const path = resolvePath(base, href);
        if (/^https?:/i.test(href)) return `<img src="${esc(href)}" alt="${esc(alt)}" loading="lazy">`;
        if (path == null || !fileAllowed(path)) return `<span class="dead-link">[图片：${esc(alt || href)}]</span>`;
        return `<img src="${esc(fileUrl(path))}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
      },
    },
  });
  return md.parse(text) + '</details>'.repeat(open);
}

// 每日.md：按 “## 日期（周几）” 分成一天一段。
export function parseDaily(body) {
  const days = [];
  let intro = '';
  for (const chunk of body.split(/^(?=## )/m)) {
    const m = chunk.match(/^## (.*)\n?([\s\S]*)$/);
    const date = m?.[1].match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (date) days.push({ date, heading: m[1].trim(), body: m[2].trim() });
    else intro += chunk;
  }
  return { intro: intro.replace(/^# .*\n/, '').trim(), days };
}

// Session 的统计范围：frontmatter 的 from（含）— to（不含），按进场时间（lib/entry.mjs）；没写就是文件那一天。
export function sessionRange(s) {
  const fm = s.fm ?? {};
  const date = s.date;
  const from = String(fm.from ?? `${date} 00:00`).slice(0, 16);
  const to = String(fm.to ?? `${nextDay(date)} 00:00`).slice(0, 16);
  return [from, to];
}
export function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 属于这个 session 的比赛，按进场时间（lib/entry.mjs，Day 2 跟着晋级的 Day 1）。零散型要扣掉落在任何专注型时间段里的比赛（session/流程.md）。
// 返回的记录带 entry（归属用的进场时间）。
export function sessionRows(rows, s, sessions) {
  const [from, to] = sessionRange(s);
  const inRange = (r, [a, b]) => r.entry.slice(0, 16) >= a && r.entry.slice(0, 16) < b;
  const focus = s.fm?.type === '零散' ? sessions.filter((x) => x !== s && x.fm?.type === '专注').map(sessionRange) : [];
  return withEntry(rows).filter((r) => inRange(r, [from, to]) && !focus.some((f) => inRange(r, f)));
}

const WEEK = '日一二三四五六';
export const weekday = (date) => `周${WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
