// 快捷键（只在电脑上有用，数量故意少）：
//   1 – 5    顶栏（本周 / 记录 / 战绩 / 笔记 / 工具台，就是从左到右的顺序；工具台是整页跳转）
//   ← →      当前页的“上一个 / 下一个”：本周页翻周、session 详情翻 session、看板选了“按周”时翻周（页面自己用 setPageKeys 登记）
//   /        搜索（在 app.mjs）      ?  弹出这张说明
// 在输入框、下拉框里不触发；带 Cmd / Ctrl / Alt 的不管（留给浏览器）。

import { h } from './dom.mjs';

let page = null;   // { left, right, hint }：当前页登记的 ← → 动作，路由切换时由 app.mjs 清掉
export const setPageKeys = (k) => { page = k; };

const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;

function help(sections) {
  if (document.querySelector('.keys-help')) return;
  const rows = [
    [`1 – ${sections.length}`, sections.map((s, i) => `${i + 1} ${s.label}`).join(' · ')],
    ['← →', page?.hint ?? '当前页没有可翻的（本周、session 详情、看板按周时可用）'],
    ['/', '搜索'],
    ['?', '这张说明'],
  ];
  const box = h('div', { class: 'keys-help', role: 'dialog', 'aria-label': '快捷键' },
    h('div', { class: 'keys-card' }, h('h2', { textContent: '快捷键' }),
      h('table', {}, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', { textContent: k })), h('td', { textContent: v })))))));
  const close = () => { box.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); } };
  box.addEventListener('click', close);
  addEventListener('keydown', onKey, true);
  document.body.append(box);
}

export function installKeys(sections) {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing() || document.querySelector('.lightbox')) return;
    if (/^[1-9]$/.test(e.key) && sections[Number(e.key) - 1]) {
      e.preventDefault();
      const s = sections[Number(e.key) - 1];
      if (s.href) location.href = s.href; else location.hash = `#/${s.id}`;
    } else if (e.key === '?') {
      e.preventDefault();
      help(sections);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && page) {
      const act = e.key === 'ArrowLeft' ? page.left : page.right;
      if (act) { e.preventDefault(); act(); }
    }
  });
}
