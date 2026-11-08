// 笔记批注（类似飞书文档）：选中正文一段话 → 写批注；被批的话加底色，电脑上批注卡片排在右边的空位里、和那段话对齐，
// 空位不够（窄屏、手机）时点底色弹出卡片，页面底部另有“批注”一栏列出全部。批注存在 记录/批注/，不改原文（annotations.py）。
// 定位靠被选中的原文和前后文（annotate-core.mjs），原文被改过也尽量找回，对不上的列在“未对上原文”里。
import { h } from './dom.mjs';
import { contextOf, findAnchor, stack } from './annotate-core.mjs';

const SKIP = '.ann-ui, svg, .spot-block, .range-block, script, style, button, select, textarea, input';
const RAIL_ROOM = 320;   // 页面右边至少空这么多像素才排在右边
const ok = (n) => { const p = n.parentElement; return !!p && !!p.closest('.card, .tb .tb-md, .tb .doc-title') && !p.closest(SKIP); };

const send = (body) => fetch('/api/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => { if (!r.ok) throw new Error(`保存失败（${r.status}）`); return r.json(); });

function textNodes(page) {
  const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (ok(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const out = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  return out;
}

// 选区的一端在“正文所有文字连起来”里的位置
function offsetOf(nodes, range, start) {
  const r = range.cloneRange();
  r.collapse(start);
  const [box, inner] = start ? [range.startContainer, range.startOffset] : [range.endContainer, range.endOffset];
  let off = 0;
  for (const n of nodes) {
    if (box === n) return off + inner;
    if (r.comparePoint(n, n.length) <= 0) off += n.length; else return off;
  }
  return off;
}

// 把 [s, e) 这段文字用 <mark> 包起来（跨几个文字节点就包几段），返回这些 mark
function wrap(nodes, s, e, id) {
  const hits = [];
  let c = 0;
  for (const n of nodes) {
    const a = c;
    c += n.length;
    if (c <= s) continue;
    if (a >= e) break;
    hits.push([n, Math.max(s, a) - a, Math.min(e, c) - a]);
  }
  const marks = [];
  for (const [n, from, to] of hits.reverse()) {   // 从后往前切，前面的节点不受影响
    if (to < n.length) n.splitText(to);
    const t = from > 0 ? n.splitText(from) : n;
    const m = h('mark', { class: 'ann' });
    m.dataset.id = id;
    t.replaceWith(m);
    m.append(t);
    marks.unshift(m);
  }
  return marks;
}

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function mountAnnotations(page, path) {
  let items = [];
  try { items = (await fetch(`/api/annotations?path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.json() : { annotations: [] }))).annotations; } catch {}
  page.classList.add('ann-page');
  const rail = h('div', { class: 'ann-rail ann-ui' });
  const list = h('section', { class: 'card ann-ui ann-list' });
  const addBtn = h('button', { type: 'button', class: 'ann-add ann-ui', textContent: '批注', hidden: true });
  const pop = h('div', { class: 'ann-pop ann-ui', hidden: true });
  page.append(rail, list);
  document.body.append(addBtn, pop);
  let marks = new Map();       // id → [mark]
  let orphans = [];
  let railMode = false;
  let draft = null;            // { quote, prefix, suffix, top } 正在写的新批注
  let selection = null;

  const active = () => items.filter((x) => !x.deletedAt);
  const act = async (body) => {
    try { const it = await send({ path, ...body }); const i = items.findIndex((x) => x.id === it.id); if (i < 0) items.push(it); else items[i] = it; draw(); return it; } catch (e) { alert(e.message); return null; }
  };

  function card(it, { editing = false, onDone } = {}) {
    const el = h('div', { class: 'ann-card' });
    el.dataset.id = it.id ?? '';
    el.append(h('div', { class: 'ann-quote', textContent: short(it.quote) }));
    if (editing) {
      const ta = h('textarea', { class: 'ann-input', rows: 3, placeholder: '写批注…', value: it.text ?? '' });
      const save = h('button', { type: 'button', class: 'btn', textContent: '保存' });
      const cancel = h('button', { type: 'button', class: 'btn', textContent: '取消' });
      const done = async () => { if (!ta.value.trim()) return; save.disabled = true; await onDone(ta.value); };
      save.addEventListener('click', done);
      cancel.addEventListener('click', () => onDone(null));
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') onDone(null);
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) done();
        ev.stopPropagation();   // 输入时不触发全站快捷键
      });
      el.append(ta, h('div', { class: 'ann-actions' }, save, cancel));
      setTimeout(() => ta.focus(), 0);
      return el;
    }
    el.append(h('div', { class: 'ann-text', textContent: it.text }),
      h('div', { class: 'ann-meta' }, h('span', { class: 'muted', textContent: `${it.at}${it.editedAt ? '（已编辑）' : ''}` }),
        ...(it.deletedAt ? [btn('恢复', () => act({ op: 'restore', id: it.id }))]
          : [btn('编辑', () => edit(it, el)), btn('删除', () => act({ op: 'delete', id: it.id }))])));
    el.addEventListener('click', (ev) => { if (!ev.target.closest('button')) jump(it.id); });
    return el;
  }
  const btn = (label, fn) => { const b = h('button', { type: 'button', class: 'ann-link', textContent: label }); b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); return b; };
  function edit(it, el) {
    const ed = card(it, { editing: true, onDone: async (text) => { if (text == null) return draw(); await act({ op: 'edit', id: it.id, text }); } });
    el.replaceWith(ed);
    layout();
  }
  const jump = (id) => {
    const m = marks.get(id)?.[0];
    if (!m) return;
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const x of marks.get(id)) { x.classList.add('flash'); setTimeout(() => x.classList.remove('flash'), 1500); }
  };

  function unwrapAll() {
    for (const m of page.querySelectorAll('mark.ann')) m.replaceWith(...m.childNodes);
    for (const c of page.querySelectorAll('.card')) c.normalize();
    marks = new Map();
  }

  function draw() {
    closePop();
    unwrapAll();
    orphans = [];
    for (const it of active()) {
      const nodes = textNodes(page);
      const text = nodes.map((n) => n.nodeValue).join('');
      const at = findAnchor(text, it);
      if (!at) { orphans.push(it); continue; }
      marks.set(it.id, wrap(nodes, at[0], at[1], it.id));
    }
    // 右边的卡片
    railMode = !page.classList.contains('pilot-copy') && innerWidth - page.getBoundingClientRect().right >= RAIL_ROOM;
    rail.replaceChildren(...(railMode ? active().filter((x) => marks.has(x.id)).map((x) => card(x)) : []));
    if (railMode && draft) rail.append(draftCard());
    // 底部一栏
    const deleted = items.filter((x) => x.deletedAt);
    const fold = (title, arr) => (arr.length ? h('details', { class: 'ann-fold' }, h('summary', { textContent: `${title}（${arr.length}）` }), ...arr.map((x) => card(x))) : null);
    list.replaceChildren(...[h('div', { class: 'card-head' }, h('h2', { textContent: `批注（${active().length}）` })),
      active().length || orphans.length || deleted.length ? null : h('p', { class: 'muted', textContent: '选中正文里的一段话，点出现的“批注”，就能写批注。批注不会改原文。' }),
      ...(railMode ? [] : active().filter((x) => marks.has(x.id)).map((x) => card(x))),
      orphans.length ? h('div', {}, h('div', { class: 'muted ann-orphan', textContent: '未对上原文（原文被改过，或这条被页面的筛选藏起来了）' }), ...orphans.map((x) => card(x))) : null,
      fold('已删除', deleted)].filter((node) => node != null));
    layout();
  }

  function layout() {
    rail.hidden = !railMode;
    if (!railMode) return;
    const base = page.getBoundingClientRect().top;
    const cards = [...rail.children];
    const tops = cards.map((c) => (c.classList.contains('draft') ? draft.top : (marks.get(c.dataset.id)?.[0].getBoundingClientRect().top ?? base) - base));
    const pos = stack(tops, cards.map((c) => c.offsetHeight));
    cards.forEach((c, i) => { c.style.top = `${pos[i]}px`; });
  }

  // 新批注
  function draftCard() {
    const c = card({ quote: draft.quote, text: '' }, { editing: true, onDone: async (text) => {
      const d = draft;
      draft = null;
      if (text == null) return draw();
      const it = await act({ op: 'add', quote: d.quote, prefix: d.prefix, suffix: d.suffix, text });
      if (!it) { draft = d; draw(); }
    } });
    c.classList.add('draft');
    return c;
  }
  function closePop() { pop.hidden = true; pop.replaceChildren(); }
  function placePop(rect) {
    pop.hidden = false;
    const w = Math.min(340, innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - w - 8))}px`;
    const below = rect.bottom + 8;
    pop.style.top = `${below + pop.offsetHeight > innerHeight ? Math.max(8, rect.top - pop.offsetHeight - 8) : below}px`;
  }

  // 选中文字 → “批注”按钮
  const readSelection = () => {
    if (page.classList.contains('pilot-editing')) return null;
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!page.contains(range.commonAncestorContainer) || range.commonAncestorContainer.parentElement?.closest('.ann-ui')) return null;
    const nodes = textNodes(page);
    const text = nodes.map((n) => n.nodeValue).join('');
    let s = offsetOf(nodes, range, true);
    let e = offsetOf(nodes, range, false);
    while (s < e && /\s/.test(text[s])) s += 1;
    while (e > s && /\s/.test(text[e - 1])) e -= 1;
    if (e - s < 1 || e - s > 2000) return null;
    return { ...contextOf(text, s, e), rect: range.getBoundingClientRect(), top: range.getBoundingClientRect().top - page.getBoundingClientRect().top };
  };
  let timer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!page.isConnected) return;
      selection = readSelection();
      addBtn.hidden = !selection;
      if (selection) {
        addBtn.style.left = `${Math.max(8, Math.min(selection.rect.right - 20, innerWidth - 70))}px`;
        addBtn.style.top = `${selection.rect.bottom + 6}px`;
      }
    }, 150);
  });
  addBtn.addEventListener('mousedown', (ev) => ev.preventDefault());   // 点按钮不要丢掉选区
  addBtn.addEventListener('click', () => {
    if (!selection) return;
    const { quote, prefix, suffix, top, rect } = selection;
    draft = { quote, prefix, suffix, top };
    addBtn.hidden = true;
    getSelection().removeAllRanges();
    if (railMode) { draw(); rail.querySelector('.draft textarea')?.focus(); return; }
    pop.replaceChildren(draftCard());
    placePop(rect);
    pop.querySelector('textarea')?.focus();
  });

  // 点底色
  page.addEventListener('click', (ev) => {
    const m = ev.target.closest('mark.ann');
    if (!m || page.classList.contains('pilot-editing') || getSelection().toString()) return;
    const it = items.find((x) => x.id === m.dataset.id);
    if (!it) return;
    if (railMode) {
      const c = rail.querySelector(`.ann-card[data-id="${it.id}"]`);
      c?.classList.add('flash');
      setTimeout(() => c?.classList.remove('flash'), 1500);
      return;
    }
    pop.replaceChildren(card(it));
    placePop(m.getBoundingClientRect());
  });
  document.addEventListener('mousedown', (ev) => { if (!pop.hidden && !ev.target.closest('.ann-pop')) { closePop(); draft = null; } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !pop.hidden) { closePop(); draft = null; } });

  const relayout = () => { if (!page.isConnected) return; const was = railMode; railMode = !page.classList.contains('pilot-copy') && innerWidth - page.getBoundingClientRect().right >= RAIL_ROOM; if (was !== railMode) draw(); else layout(); };
  new ResizeObserver(relayout).observe(page);
  addEventListener('resize', relayout);   // 窗口变大变小但页面宽度没变（已到最大宽度）时 ResizeObserver 不会触发
  // 页面换走后清掉挂在 body 上的东西
  new MutationObserver(() => { if (!page.isConnected) { addBtn.remove(); pop.remove(); } }).observe(document.getElementById('view') ?? document.body, { childList: true, subtree: true });
  draw();
  return { redraw: draw, noteAt(element) {
    const nodes = textNodes(page);
    const start = nodes.findIndex((n) => element.contains(n));
    if (start < 0) return;
    const text = nodes.map((n) => n.nodeValue).join('');
    const offset = nodes.slice(0, start).reduce((sum, n) => sum + n.length, 0);
    const length = Math.min(160, nodes.filter((n) => element.contains(n)).reduce((sum, n) => sum + n.length, 0));
    const rect = element.getBoundingClientRect();
    draft = { ...contextOf(text, offset, offset + length), top: rect.top - page.getBoundingClientRect().top };
    pop.replaceChildren(draftCard());
    placePop(rect);
    pop.querySelector('textarea')?.focus();
  } };   // 页面自己换了正文（比如待复习页改筛选）后调用，重新找位置、重新上底色
}
