// 页面目录：左侧固定，列出页面里每个带标题的卡片（.card 里的 h2），点击平滑跳转，滚动时高亮当前模块。
// 窗口太窄时左栏隐藏，换成右下角的“目录”按钮。顶部的筛选条（.filters）固定在页面上方，跳转时要让开它。

import { h } from './dom.mjs';

let current = null; // 当前页面的目录状态；切换页面时替换

// “累计净利（USD）”→“累计净利”，“习惯：星期 × 开赛时间”→“习惯”。
// 带编号的条目（草稿的 “3. 翻前 BvB：…”）冒号后面才是内容，不截。
const labelOf = (title) => (/^\d+\.\s/.test(title) ? title : title.split('：')[0]).replace(/（.*?）/g, '').trim();

const headerBottom = (content) => {
  const filters = content.querySelector('.filters');
  const topbar = document.querySelector('.topbar');
  return (filters ? filters.getBoundingClientRect().bottom : topbar.getBoundingClientRect().bottom) + 12;
};

export function mountToc(nav, content) {
  const cards = [...content.querySelectorAll('.card')].filter((c) => c.querySelector('h2') && !c.closest('[hidden]'));
  nav.replaceChildren();
  nav.closest('.layout')?.classList.toggle('no-toc', cards.length <= 1);   // 只有一节时目录没用，让内容占满整行（用户 2026-11-07）
  if (cards.length <= 1) {
    current = null;
    return;
  }
  const links = [];
  const list = h('ol', { class: 'toc-list' });
  const go = (target) => {
    nav.classList.remove('open');
    if (!target) return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (target.tagName === 'DETAILS') target.open = true;
    const top = target.getBoundingClientRect().top + window.scrollY - headerBottom(content);
    window.scrollTo({ top, behavior: 'smooth' });
  };
  const item = (label, target) => {
    const a = h('a', { href: '#', textContent: label });
    a.addEventListener('click', (ev) => { ev.preventDefault(); go(target); });
    list.append(h('li', {}, a));
    links.push([a, target]);
  };
  item('概览', null);
  cards.forEach((c) => item(labelOf(c.querySelector('h2').textContent), c));

  const toggle = h('button', { type: 'button', class: 'btn toc-toggle', textContent: '目录', 'aria-label': '目录' });
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  const top = h('a', { href: '#', class: 'toc-top', textContent: '↑ 回到顶部' });
  top.addEventListener('click', (ev) => { ev.preventDefault(); go(null); });
  nav.append(toggle, h('div', { class: 'toc-panel' }, h('div', { class: 'toc-title', textContent: '目录' }), list, top));

  current = { content, links };
  spy();
}

// 页面自带的左栏（比如胡萝卜教材的全部章和主题）：和页面目录同一套外观，窄屏时同样收进右下角的“目录”按钮。当前项（.active）滚到看得见的地方。
export function mountNav(nav, panel) {
  current = null;
  const toggle = h('button', { type: 'button', class: 'btn toc-toggle', textContent: '目录', 'aria-label': '目录' });
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  nav.replaceChildren(toggle, h('div', { class: 'toc-panel' }, panel));
  const active = panel.querySelector('.active');
  if (active && nav.scrollHeight > nav.clientHeight) nav.scrollTop = active.offsetTop - nav.clientHeight / 3;
}

// 当前模块：顶部已经滚过筛选条下沿的最后一个卡片；滚到页底时是最后一个。
function spy() {
  if (!current) return;
  const line = headerBottom(current.content) + 8;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  let active = current.links[0];
  for (const l of current.links.slice(1)) {
    if (l[1].getBoundingClientRect().top <= line) active = l;
  }
  if (atBottom && window.scrollY > 0) active = current.links.at(-1);
  // 筛选条贴住顶部后加一条底线，和下面滚动的内容分开。
  current.content.querySelector('.filters')?.classList.toggle('stuck', window.scrollY > 0);
  for (const l of current.links) l[0].classList.toggle('active', l === active);
  // 目录比屏幕高时自己会滚动：当前这一节换了，就把它滚到目录栏里看得见的地方。
  if (current.active !== active) {
    current.active = active;
    const nav = active[0].closest('.toc');
    const box = nav.getBoundingClientRect();
    const r = active[0].getBoundingClientRect();
    if (nav.scrollHeight > nav.clientHeight && (r.top < box.top || r.bottom > box.bottom)) {
      nav.scrollTop += r.top - box.top - box.height / 3;
    }
  }
}

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; spy(); });
}, { passive: true });
