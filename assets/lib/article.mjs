// 把渲染好的 Markdown 摆成文章：# 标题在最上面，每个 ## 小节一张卡片（页面目录会自动列出来），图片点击放大。
// 没有 ## 的文件（比如 草稿.md 全是 ###）按 ### 分卡片。
import { h } from './dom.mjs';
import { renderMarkdown } from './docs.mjs';

// 返回 { title, cards }：title 是第一个 # 的文字（没有就是 null）。
export function articleParts(body, path, docSet) {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderMarkdown(body, path, docSet);   // renderMarkdown 已经把原始 HTML 转成文字
  const nodes = [...tpl.content.childNodes];
  const level = ['H2', 'H3', 'H4'].find((tag) => nodes.some((n) => n.nodeName === tag));
  let title = null;
  const cards = [];
  let cur = null;
  for (const node of nodes) {
    if (node.nodeName === 'H1' && title == null) { title = node.textContent; continue; }
    if (node.nodeName === level) {
      cur = h('section', { class: 'card prose' }, h('div', { class: 'card-head' }, h('h2', { textContent: node.textContent })));
      cards.push(cur);
      continue;
    }
    if (!cur) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
      cur = h('section', { class: 'card prose intro' });
      cards.push(cur);
    }
    cur.append(node);
  }
  // 宽表格横向滚动
  for (const t of cards.flatMap((c) => [...c.querySelectorAll('table')])) {
    const wrap = h('div', { class: 'table-wrap' });
    t.replaceWith(wrap);
    wrap.append(t);
  }
  return { title, cards };
}

// 点击图片全屏看（正文里的图片，或带 data-full 的图片）；左右键切换上一张、下一张，Esc 或点击关闭。
export function enableLightbox(root) {
  root.addEventListener('click', (ev) => {
    const img = ev.target.closest('.prose img, img[data-full]');
    if (!img) return;
    // 收起的折叠块（比如没点开的答案）里的图片不参与翻图，免得翻到答案。
    const imgs = [...root.querySelectorAll('.prose img, img[data-full]')].filter((x) => !x.closest('details:not([open])'));
    let i = imgs.indexOf(img);
    const big = h('img', { alt: '' });
    const cap = h('div', { class: 'lb-cap' });
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': '查看图片' }, big, cap);
    const show = () => {
      big.src = imgs[i].dataset.full ?? imgs[i].src;   // data-full：缩略图旁边挂的大图（胡萝卜讲义的扫描页）
      big.alt = imgs[i].alt;
      cap.textContent = `${imgs[i].alt ? `${imgs[i].alt} · ` : ''}${i + 1} / ${imgs.length}（← → 切换，Esc 关闭）`;
    };
    const close = () => { box.remove(); removeEventListener('keydown', key); };
    const key = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && i < imgs.length - 1) { i += 1; show(); }
      else if (e.key === 'ArrowLeft' && i > 0) { i -= 1; show(); }
      else return;
      e.preventDefault();
    };
    box.addEventListener('click', close);
    addEventListener('keydown', key);
    show();
    document.body.append(box);
  });
}

export const docSetOf = (docs) => new Set(docs.map((d) => d.path));
