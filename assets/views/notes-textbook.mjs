// 胡萝卜整理版教材：教材目录（按章、按主题、格式问题清单）、章视图、主题视图。只读；格式见 Poker/交接_胡萝卜整理版教材.md，解析和校验在 lib/textbook.mjs。
// 内容只写一份（每章一个 教材/<章 id>.md），主题页由章文件里的概念标签和 概念索引.md 自动拼。
import { mountTextbookInteractions } from '../lib/textbook-interactions.mjs';
import { conceptButton } from '../lib/textbook-reference.mjs';
import { h } from '../lib/dom.mjs';
import { loadDoc, loadDocs, renderMarkdown } from '../lib/docs.mjs';
import { docSetOf } from '../lib/article.mjs';
import { fourColorSuits } from '../lib/suits.mjs';
import { mountAnnotations } from '../lib/annotate.mjs';
import { setPageKeys } from '../lib/keys.mjs';
import { PILOT, mountChapterReader } from './chapter-pilot.mjs';
import { loadToc } from './notes-handouts.mjs';
import { loadMyHands, myHandsSection } from './my-hands.mjs';
import { handsForChapter, handsForTopic } from '../lib/my-hands.mjs';
import {
  CONCEPTS_DOC, MARK_RE, TOPICS_DOC, bookHref, chapterLabel, checkChapter, cnNum, evalCalc, findConcept, findConceptLoose,
  parseCalc, parseChapter, parseConcepts, parseTopicGuides, resolveMark, studyPath, studySection, tagsOf, textHref, textPath, topicHref,
} from '../lib/textbook.mjs';

const getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); });
const ONLY_LEARNED = 'public-tb-only-learned';
const LAST_READING = 'public-tb-last-reading';
function lastReading() {
  try { return JSON.parse(localStorage.getItem(LAST_READING)) ?? {}; } catch { return {}; }
}
const TOPIC_KINDS = ['要点', '总表', '小工具', '牌例', '剥削提示'];   // 主题页“按章”里放的；两面单独一节

// 公共数据：章（书的顺序）、目录标题、概念索引、主题导语、文件清单
async function loadBase() {
  const [all, toc, cdoc, tdoc, docs] = await Promise.all([
    getJson('/api/handouts'), loadToc(), loadDoc(CONCEPTS_DOC), loadDoc(TOPICS_DOC).catch(() => null), loadDocs(),
  ]);
  const chapters = all.filter((c) => !c.cover);
  for (const c of chapters) c.title = toc.find((t) => t.key === `${c.grade}年级${c.no}`)?.title ?? c.name;
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const concepts = parseConcepts(cdoc.body);
  const guides = tdoc ? parseTopicGuides(tdoc.body) : new Map();
  const ctx = { chapter: null, chapters, hasText: (id) => !!byId.get(id)?.text, concepts };
  return { chapters, covers: all.filter((c) => c.cover), byId, concepts, guides, docs, docSet: docSetOf(docs), ctx };
}

// 全部章文件（目录页、主题页要）：[{ c, doc, parsed }]
async function loadTexts(base) {
  const withText = base.chapters.filter((c) => c.text);
  const docs = await Promise.all(withText.map((c) => loadDoc(c.text).catch(() => null)));
  return withText.map((c, i) => docs[i] && { c, doc: docs[i], parsed: parseChapter(docs[i].body) }).filter(Boolean);
}

const fullName = (c) => `${chapterLabel(c)} · ${c.title}`;
const learnedOf = (doc) => (doc?.fm?.learned ? String(doc.fm.learned) : '');

// ---------- Markdown + 行内标记 ----------

// 渲染好的 HTML 里，把 [p6]、[[概念]] 这些换成链接 / 小标签；出错的标红，悬停写原因
function decorate(root, ctx) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.includes('[') && !n.parentElement.closest('code, pre, a')) hits.push(n);
  }
  for (const n of hits) {
    const text = n.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MARK_RE)) {
      frag.append(text.slice(last, m.index));
      const mark = resolveMark(m, ctx);
      frag.append(mark.kind === 'concept' && !mark.error ? conceptButton(m[1], ctx) : markEl(mark));
      last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.append(text.slice(last));
    n.replaceWith(frag);
  }
  fourColorSuits(root);
}

function markEl(r) {
  const cls = { concept: 'tb-cpt', flag: `tb-flag ${r.text === '待核对' ? 'check' : 'verify'}`, page: 'tb-src', chapter: 'tb-ref', bad: 'tb-src' }[r.kind];
  if (r.error) return h('span', { class: `${cls} tb-bad`, title: r.error, textContent: r.text });
  return r.href ? h('a', { class: cls, href: r.href, textContent: r.text }) : h('span', { class: cls, textContent: r.text });
}

// 一段 Markdown → 一个 div（小工具代码块换成计算框）
function md(text, ctx, base, cls = '') {
  const el = h('div', { class: `prose tb-md ${cls}` });
  el.innerHTML = renderMarkdown(text, base.path, base.docSet);
  for (const code of el.querySelectorAll('pre > code.language-calc')) code.parentElement.replaceWith(calcEl(code.textContent));
  for (const t of el.querySelectorAll('table')) { const w = h('div', { class: 'table-wrap' }); t.replaceWith(w); w.append(t); }
  decorate(el, ctx);
  mountTextbookInteractions(el, ctx.chapters);
  return el;
}

// 一行文字（标题）：去掉外面的 <p>
function inline(text, ctx, base) {
  const el = md(text, ctx, base);
  const p = el.firstElementChild;
  return p?.tagName === 'P' && el.children.length === 1 ? [...p.childNodes] : [...el.childNodes];
}

function calcEl(src) {
  const { lines, vars } = parseCalc(src);
  const outs = [];
  const box = h('div', { class: 'tb-calc' }, ...lines.map((parts) => h('div', {}, ...parts.map((p) => {
    if (p.t === 'text') return p.s;
    if (p.t === 'in') {
      const inp = h('input', { type: 'number', value: String(p.value), step: 'any', 'aria-label': p.name });
      inp.addEventListener('input', () => { vars[p.name] = inp.value === '' ? NaN : Number(inp.value); recalc(); });
      return inp;
    }
    const o = h('b', { class: 'tb-out' });
    outs.push([o, p]);
    return o;
  }))));
  const recalc = () => { for (const [o, p] of outs) { const v = evalCalc(p.expr, vars); o.textContent = v == null ? '—' : v.toFixed(p.dp); } };
  recalc();
  return box;
}

// ---------- 块 ----------

const noTag = (b) => (b.tags.length ? null : h('span', { class: 'tb-bad tb-note', title: '这一块没有概念标签，主题页里不会出现', textContent: '没有概念标签' }));

function pointsEl(blocks, ctx, base, check) {
  return h('ul', { class: 'tb-pts' }, ...blocks.map((b) => h('li', {}, md(b.md, ctx, base), check ? noTag(b) : null)));
}
function tipsEl(blocks, ctx, base, check) {
  return h('div', { class: 'tb-tip' }, h('div', { class: 'tb-box-title', textContent: '剥削提示' }),
    h('ul', {}, ...blocks.map((b) => h('li', {}, md(b.md, ctx, base), check ? noTag(b) : null))));
}
function headed(b, ctx, base, check) {
  return h('div', { class: 'tb-block' }, b.title ? h('h3', { class: 'tb-h3' }, ...inline(b.title, ctx, base)) : null, md(b.md, ctx, base), check ? noTag(b) : null);
}
function caseEl(b, ctx, base, open, check) {
  return h('details', { class: 'tb-case', open }, h('summary', {}, ...inline(b.title ?? '牌例', ctx, base)), md(b.md, ctx, base), check ? noTag(b) : null);
}
function twoEl(b, ctx, base, check) {
  return h('div', { class: 'tb-two' }, b.title ? h('div', { class: 'tb-two-q' }, ...inline(b.title, ctx, base)) : null, md(b.md, ctx, base),
    check ? noTag(b) : null);
}

// 一节的块按种类排出来（章视图和主题页共用）
function sectionBody(title, blocks, ctx, base, check) {
  if (title === '要点') return [pointsEl(blocks, ctx, base, check)];
  if (title === '剥削提示') return [tipsEl(blocks, ctx, base, check)];
  if (title === '牌例') return blocks.map((b, i) => caseEl(b, ctx, base, check && i === 0, check));
  if (title === '两面') return blocks.map((b) => twoEl(b, ctx, base, check));
  return blocks.map((b) => headed(b, ctx, base, check));
}

// ---------- 左栏 ----------

function navPanel(base, cur) {
  const link = (href, text, on, off) => h('li', {}, h('a', { href, class: `${on ? 'active' : ''}${off ? ' off' : ''}`, textContent: text }));
  const panel = h('div', { class: 'tb-nav' }, h('a', { class: 'toc-top', href: '#/notes/text', textContent: '教材目录' }));
  for (const book of [...new Set(base.chapters.map((c) => c.book))]) {
    panel.append(h('div', { class: 'toc-title', textContent: `${book}册` }), h('ol', { class: 'toc-list' },
      ...base.chapters.filter((c) => c.book === book).map((c) => link(textHref(c.id), `${c.grade}年级 ${c.no} · ${c.title}`, cur === c.id, !c.text))));
  }
  panel.append(h('div', { class: 'toc-title', textContent: '主题' }), h('ol', { class: 'toc-list' },
    ...base.concepts.groups.map((g) => link(topicHref(g.n), `${g.num}、${g.name}`, cur === `topic-${g.n}`))));
  return panel;
}

// ---------- 教材目录 ----------

export async function renderTextIndex(root) {
  const page = h('div', { class: 'reader wide tb' });
  root.append(page);
  let base;
  let texts;
  try { base = await loadBase(); texts = await loadTexts(base); } catch (e) {
    page.append(h('p', { class: 'error', textContent: `读取失败：${e.message}` }));
    return;
  }
  const textOf = new Map(texts.map((t) => [t.c.id, t]));
  page.append(h('h1', { class: 'doc-title', textContent: '胡萝卜教材' }));

  const last = lastReading();
  const resume = textOf.get(last.id)?.c;
  const learnedCount = texts.filter((t) => learnedOf(t.doc)).length;
  const byChapter = h('section', { class: 'card tb-map' }, h('div', { class: 'card-head' },
    h('h2', { textContent: '按章学习' }), h('span', { class: 'muted', textContent: `已学 ${learnedCount} / ${base.chapters.length} 章` })));
  if (resume) byChapter.append(h('p', {}, h('a', {
    href: textHref(resume.id) + (last.section ? '?section=' + encodeURIComponent(last.section) : ''),
    textContent: `继续读 · ${fullName(resume)}${last.section ? ' · ' + last.section : ''}`,
  })));
  for (const grade of new Set(base.chapters.map((c) => c.grade))) {
    const cs = base.chapters.filter((c) => c.grade === grade);
    const count = cs.filter((c) => learnedOf(textOf.get(c.id)?.doc)).length;
    const group = h('details', { class: 'tb-grade', open: resume?.grade === grade },
      h('summary', {}, h('strong', { textContent: grade + '年级' }),
        h('span', { class: 'muted', textContent: `已学 ${count} / ${cs.length}` })));
    group.append(h('div', { class: 'ho-list' }, ...cs.map((c) => {
      const t = textOf.get(c.id);
      const learned = learnedOf(t?.doc);
      return h('div', { class: `ho-row${t ? '' : ' off'}` }, h('span', { class: 'muted', textContent: c.no }),
        t ? h('a', { class: 'ho-name', href: textHref(c.id), textContent: c.title }) : h('span', { class: 'ho-name', textContent: c.title }),
        c.pdf ? h('a', { class: 'tb-ref', href: bookHref(c.id), textContent: '原书' }) : null,
        learned ? h('span', { class: 'tag', textContent: `已学 ${learned.slice(5)}` }) : null);
    })));
    byChapter.append(group);
  }
  byChapter.append(h('div', { class: 'chips' }, ...base.covers.filter((c) => c.pdf).map((c) =>
    h('a', { class: 'tb-ref', href: bookHref(c.id), textContent: c.book + '册封面与目录' }))));
  const byTopic = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { textContent: '按主题' })),
    h('div', { class: 'ho-list' }, ...base.concepts.groups.map((g) => {
      const { chapters, points, learned } = topicCount(g, texts, base);
      return h('div', { class: 'ho-row' }, h('span', { class: 'muted', textContent: g.num }), h('a', { class: 'ho-name', href: topicHref(g.n), textContent: g.name }),
        h('span', { class: 'muted', textContent: chapters ? `已学 ${learned} / ${chapters} 章 · ${points} 条要点` : '还没有内容' }));
    })));
  const jumps = h('div', { class: 'tb-jumps' },
    h('button', { type: 'button', class: 'btn', textContent: '按章阅读', onclick: () => byChapter.scrollIntoView() }),
    h('button', { type: 'button', class: 'btn', textContent: '按主题推演', onclick: () => byTopic.scrollIntoView() }));
  page.append(jumps, h('div', { class: 'tb-index' }, byChapter, byTopic), questionList(base, base.concepts.questions, true));
  const problems = problemsCard(base, texts);
  if (problems) page.append(problems);
}

function topicCount(g, texts, base) {
  let chapters = 0;
  let learned = 0;
  let points = 0;
  for (const t of texts) {
    const hit = t.parsed.sections.filter((s) => TOPIC_KINDS.includes(s.title) || s.title === '两面').flatMap((s) => s.blocks.map((b) => [s.title, b])).filter(([, b]) => inGroup(b, g, base));
    if (hit.length) { chapters += 1; if (learnedOf(t.doc)) learned += 1; }
    points += hit.filter(([k]) => k === '要点').length;
  }
  return { chapters, points, learned };
}
const inGroup = (b, g, base) => b.tags.some((t) => findConcept(base.concepts, t)?.group === g);

// 格式问题清单：哪章、哪条、什么问题（“胡萝卜教材网页”对话靠它验收）
function problemsCard(base, texts) {
  const rows = [];
  for (const t of texts) for (const p of checkChapter(t.doc, t.parsed, { ...base.ctx, chapter: t.c })) rows.push([t.c, p.msg, p.at]);
  const known = new Set(base.chapters.map((c) => c.id));
  for (const d of base.docs) {
    const m = d.path.match(/^记录\/读书\/胡萝卜扑克学校\/教材\/(.+)\.md$/);
    if (m && m[1] !== '主题' && !known.has(m[1])) rows.push([null, `文件名对不上任何一章：${m[1]}.md（要和章 PDF 同名）`, '']);
  }
  const groupTitles = new Set(base.concepts.groups.map((g) => g.title));
  for (const name of base.guides.keys()) if (!groupTitles.has(name)) rows.push([null, `主题.md 的“## ${name}”对不上概念索引的组名`, '']);
  for (const g of base.concepts.groups) if (!base.guides.get(g.title)?.intro) rows.push([null, `主题.md 里没有“## ${g.title}”的导语`, '']);
  if (!rows.length) return null;
  const card = h('section', { class: 'card tb-problems' }, h('div', { class: 'card-head' }, h('h2', { textContent: `格式问题（${rows.length}）` })));
  card.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { textContent: '章' }), h('th', { textContent: '问题' }), h('th', { textContent: '在哪' }))),
    h('tbody', {}, ...rows.map(([c, msg, at]) => h('tr', {},
      h('td', { class: 'nw' }, c ? h('a', { href: textHref(c.id), textContent: chapterLabel(c) }) : '—'),
      h('td', { class: 'tb-bad-text', textContent: msg }), h('td', { class: 'muted', textContent: at })))))));
  return card;
}

// ---------- 章视图 ----------

// 按浏览历史条目保存；从目录重新点进同一章仍从头读。
const chapterPlaces = new Map();
function chapterHistory(page, id, section) {
  const hash = location.hash;
  let key = history.state?.tbEntry;
  if (!key || history.state?.tbHash !== hash) {
    key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    history.replaceState({ ...history.state, tbEntry: key, tbHash: hash }, '');
  }
  const place = chapterPlaces.get(key);
  const cases = [...page.querySelectorAll('details.tb-case')];
  const inputs = [...page.querySelectorAll('.tb-calc input')];
  const headings = [...page.querySelectorAll('h2.tb-sec')];
  if (place) {
    for (const [i, el] of cases.entries()) el.open = place.open.includes(i);
    for (const [i, el] of inputs.entries()) {
      if (place.values[i] == null) continue;
      el.value = place.values[i];
      el.dispatchEvent(new Event('input'));
    }
    window.scrollTo(0, place.y);
  } else if (section) {
    headings.find((el) => el.textContent === section)?.scrollIntoView();
  }
  let y = window.scrollY;
  let recorded;
  const onScroll = () => {
    if (location.hash !== hash) return;
    y = window.scrollY;
    const current = headings.filter((el) => el.getBoundingClientRect().top < innerHeight / 3).at(-1)?.textContent ?? '';
    if (recorded === current) return;
    recorded = current;
    try { localStorage.setItem(LAST_READING, JSON.stringify({ id, section: current })); } catch {}
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  // 点击跳走时 scroll 事件可能还在排队。
  page.addEventListener('click', onScroll, true);
  return () => {
    window.removeEventListener('scroll', onScroll);
    page.removeEventListener('click', onScroll, true);
    chapterPlaces.set(key, { y, open: cases.flatMap((el, i) => el.open ? [i] : []), values: inputs.map((el) => el.value) });
    if (chapterPlaces.size > 32) chapterPlaces.delete(chapterPlaces.keys().next().value);
  };
}

function learnedControl(id, date) {
  const button = h('button', { type: 'button', class: 'btn' });
  const status = h('span', { class: 'muted', role: 'status' });
  function show() {
    status.textContent = date ? '已学 ' + date : '';
    status.hidden = !date;
    button.textContent = date ? '撤销已学' : '标为已学';
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      const response = await fetch('/api/textbook/learned', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, marked: !date, previous: date }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      date = result.learned;
      show();
    } catch (error) {
      status.hidden = false;
      status.textContent = error instanceof TypeError || error instanceof SyntaxError
        ? '无法保存，请检查网站连接后重试。' : error.message;
    } finally {
      button.disabled = false;
    }
  };
  show();
  return [status, button];
}

export async function renderTextChapter(root, id, query = {}) {
  const page = h('div', { class: 'reader tb' });
  root.append(page);
  let base;
  try { base = await loadBase(); } catch (e) {
    page.append(h('p', { class: 'error', textContent: `读取失败：${e.message}` }));
    return;
  }
  const c = base.byId.get(id);
  if (!c) { page.append(h('p', { class: 'error', textContent: `没有这一章：${id}` })); return { nav: navPanel(base, null) }; }
  const i = base.chapters.indexOf(c);
  const prev = base.chapters[i - 1];
  const next = base.chapters[i + 1];
  setPageKeys({ hint: '上一章 / 下一章', left: prev ? () => { location.hash = textHref(prev.id); } : null, right: next ? () => { location.hash = textHref(next.id); } : null });
  const ctx = { ...base.ctx, chapter: c };
  const b = { path: c.text ?? textPath(c.id), docSet: base.docSet };
  const [doc, study] = await Promise.all([c.text ? loadDoc(c.text).catch(() => null) : null, c.study ? loadDoc(c.study).catch(() => null) : null]);
  const pilot = id === PILOT && !!doc;
  const compare = !!doc && c.pdf;
  let points = [];
  if (compare) page.classList.add('chapter-copy');
  if (pilot) page.classList.add('pilot-copy');
  const links = h('div', { class: 'chips doc-links' },
    c.study ? h('a', { class: 'chip', href: `#/notes/handout/${encodeURIComponent(c.id)}`, textContent: pilot ? '章学习记录' : '章页' }) : null,
    ...(doc ? learnedControl(c.id, learnedOf(doc)) : []));
  page.append(h('div', { class: 'tb-kicker', textContent: `${c.book}册 · ${c.grade}年级 ${c.no}${c.book_pages ? ` · 原书 p${c.book_pages[0]}–${c.book_pages[1]}` : ''}` }),
    h('h1', { class: 'doc-title', textContent: c.title }), links);
  if (!doc) {
    page.append(h('p', { class: 'empty', textContent: '这一章还没有整理版。' }));
  } else {
    const p = parseChapter(doc.body);
    if (p.lead) page.append(md(p.lead, ctx, b, 'tb-lead'));
    if (p.where) page.append(pilot ? h('details', { class: 'pilot-related' }, h('summary', { textContent: '本章与哪些概念相连' }), md(p.where, ctx, b)) : md(p.where, ctx, b, 'tb-where'));
    if (p.pre) page.append(md(p.pre, ctx, b));
    for (const s of p.sections) {
      if (pilot && s.title === '要点') points = s.blocks;
      page.append(h('h2', { class: 'tb-sec', textContent: s.title }));
      if (!s.kind) { page.append(h('p', { class: 'tb-bad tb-note', title: '固定的二级标题见交接文档', textContent: '认不出的二级标题，照普通 Markdown 显示' }), md(s.md, ctx, b)); continue; }
      if (s.kind === 'plain') { page.append(md(s.md, ctx, b)); continue; }
      page.append(...sectionBody(s.title, s.blocks, ctx, b, true));
    }
  }
  // 我的手牌：待复盘 / 复盘里“对照”标了这一章的概念或这一章的手（没有就不显示）
  const mine = await loadMyHands().catch(() => []);
  const mineEl = myHandsSection(handsForChapter(mine, base.concepts, c.id, doc ? tagsOf(doc.body) : []), base.concepts);
  if (mineEl) page.append(mineEl);
  if (doc?.fm?.checked) page.append(h('p', { class: 'tb-checked muted', textContent: `核对：${doc.fm.checked}` }));
  page.append(h('div', { class: 'tb-pager' },
    prev ? h('a', { class: 'btn', href: textHref(prev.id), textContent: `← ${fullName(prev)}` }) : h('span'),
    next ? h('a', { class: 'btn', href: textHref(next.id), textContent: `${fullName(next)} →` }) : h('span')));
  let annotations;
  if (doc) { try { annotations = await mountAnnotations(page, c.text); } catch (e) { console.error('批注加载失败', e); } }
  return { nav: navPanel(base, c.id), onMounted() {
    const unmount = compare && mountChapterReader(root, page, c, annotations, points, (text) => md(text, ctx, b));
    const leave = chapterHistory(page, id, query.section);
    return () => { leave(); if (unmount) unmount(); };
  } };
}

// ---------- 主题视图 ----------

function questionList(base, questions, full = false) {
  const familyOf = (q) => q.family || '实战场景';
  const families = [...new Set(questions.map(familyOf))];
  const numberOf = (q) => String(base.concepts.questions.indexOf(q) + 1).padStart(2, '0');
  const hash = location.hash;
  const saved = history.state?.questionDeck;
  const previous = saved?.hash === hash ? saved : null;
  let current = questions.find((q) => q.q === previous?.question) ?? questions[0];
  const deck = h('details', { class: 'qdeck', open: previous?.open ?? full });
  const save = () => {
    if (location.hash === hash && deck.isConnected) history.replaceState({
      ...history.state, questionDeck: { hash, open: deck.open, question: current.q },
    }, '');
  };
  deck.ontoggle = save;

  const art = h('span', { class: 'qd-art', 'aria-hidden': 'true' },
    ...['♠', '♦', '♣'].map((suit) => h('i', {}, h('b', { textContent: suit }))));
  deck.append(h('summary', { class: 'qd-cover' },
    h('span', { class: 'qd-title' }, full ? '实战 ' : '相关实战 ', h('strong', { textContent: questions.length }), ' 问'),
    art, h('span', { class: 'qd-switch', 'aria-hidden': 'true' })));

  const tabs = h('div', { class: 'qd-families', role: 'group', 'aria-label': '选择决策场景' });
  const list = h('div', { class: 'qd-menu', role: 'group', 'aria-label': '选择问题' });
  const mobile = h('select', { class: 'qd-picker', 'aria-label': '选择问题' });
  const card = h('article', { class: 'qd-card', 'aria-live': 'polite' });
  const picker = h('button', { type: 'button', class: 'qd-draw', disabled: questions.length < 2,
    onclick: () => {
      const rest = questions.filter((q) => q !== current);
      if (rest.length) choose(rest[Math.floor(Math.random() * rest.length)]);
    } }, h('span', { class: 'qd-draw-icon', 'aria-hidden': 'true' }), '抽一题');
  deck.append(h('div', { class: 'qd-bar' }, tabs, mobile, picker),
    h('div', { class: 'qd-body' }, list, card));

  for (const family of families) {
    const count = questions.filter((q) => familyOf(q) === family).length;
    tabs.append(h('button', { type: 'button', value: family, onclick: () => choose(questions.find((q) => familyOf(q) === family)) },
      family, h('small', { textContent: count })));
  }
  function renderMenu() {
    list.replaceChildren();
    mobile.replaceChildren();
    for (const q of questions.filter((q) => familyOf(q) === familyOf(current))) {
      const num = numberOf(q);
      list.append(h('button', { type: 'button', value: num, onclick: () => choose(q) },
        h('span', { class: 'qd-num', textContent: num }), q.short || q.q));
      mobile.append(h('option', { value: num, textContent: num + '　' + (q.short || q.q) }));
    }
  }
  mobile.onchange = () => choose(questions.find((q) => numberOf(q) === mobile.value));
  function choose(q) {
    if (!q) return;
    const rebuild = familyOf(q) !== familyOf(current) || !list.childElementCount;
    current = q;
    if (rebuild) renderMenu();
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.value === familyOf(q)));
    for (const button of list.children) button.setAttribute('aria-pressed', String(button.value === numberOf(q)));
    mobile.value = numberOf(q);
    const links = q.names.map((name) => {
      const hit = findConceptLoose(base.concepts, name);
      return h('li', {}, hit ? h('a', { href: topicHref(hit.group.n, hit.concept.title), textContent: name }) : name);
    });
    const content = [
      h('span', { class: 'qd-folio', textContent: familyOf(q) + '　/　' + numberOf(q) }),
      h('h3', { textContent: q.q }),
    ];
    if (q.think) content.push(h('p', { class: 'qd-think', textContent: q.think }));
    if (q.vary) content.push(h('div', { class: 'qd-variation' },
      h('b', { textContent: '换个条件' }), h('p', { textContent: q.vary })));
    content.push(h('details', { class: 'qd-refs' }, h('summary', {}, '查相关概念 ', h('small', { textContent: links.length })),
      h('ol', {}, ...links)));
    card.replaceChildren(...content);
    save();
  }
  choose(current);
  return deck;
}

export async function renderTopic(root, n, query = {}) {
  const page = h('div', { class: 'reader tb' });
  root.append(page);
  let base;
  let texts;
  try { base = await loadBase(); texts = await loadTexts(base); } catch (e) {
    page.append(h('p', { class: 'error', textContent: `读取失败：${e.message}` }));
    return;
  }
  const g = base.concepts.groups[Number(n) - 1];
  if (!g) { page.append(h('p', { class: 'error', textContent: `没有第 ${n} 组主题` })); return { nav: navPanel(base, null) }; }
  const total = base.concepts.groups.length;
  const prev = base.concepts.groups[g.n - 2];
  const next = base.concepts.groups[g.n];
  setPageKeys({ hint: '上一组 / 下一组主题', left: prev ? () => { location.hash = topicHref(prev.n); } : null, right: next ? () => { location.hash = topicHref(next.n); } : null });
  const cbase = { path: CONCEPTS_DOC, docSet: base.docSet };

  const active = g.concepts.find((c) => c.title === query.c) ?? g.concepts.find((c) => c.keys.includes(query.c));
  const matches = active
    ? (block) => block.tags.some((tag) => findConcept(base.concepts, tag)?.concept === active)
    : (block) => inGroup(block, g, base);
  const guide = base.guides.get(g.title);
  const source = { path: TOPICS_DOC, docSet: base.docSet };
  page.append(h('div', { class: 'tb-kicker', textContent: `主题 · ${g.num} / ${cnNum(total)}` }),
    h('h1', { class: 'doc-title', textContent: g.name }));
  if (guide?.reviewMap && !active) {
    page.append(h('section', { class: 'tb-review' }, h('h2', { textContent: '专题复习图' }),
      md(guide.reviewMap, base.ctx, source, 'tb-review-tree')));
  }
  if (guide?.intro) page.append(md(guide.intro, base.ctx, source, 'tb-lead'));
  // 我的手牌放在导语下面（用户 2026-11-08：放底部太靠下）；先占位，读完再填
  const mineSlot = h('div');
  page.append(mineSlot);
  loadMyHands().catch(() => []).then((mine) => { const el = myHandsSection(handsForTopic(mine, base.concepts, g, active ?? null), base.concepts); if (el) mineSlot.replaceWith(el); });
  if (guide?.lesson && !active) page.append(md(guide.lesson, base.ctx, source));
  if (guide?.question && active) page.append(h('a', { class: 'tb-ref', href: topicHref(g.n), textContent: guide.lesson ? '读本专题与自测' : '做本组的推演题' }));
  if (guide?.question && !active) {
    page.append(h('section', { class: 'tb-two' }, h('h2', { class: 'tb-h3', textContent: guide.question }),
      h('details', { class: 'tb-case' }, h('summary', { textContent: '看推演' }), md(guide.answer, base.ctx, source))));
  }

  const qs = base.concepts.questions.filter((q) => q.names.some((name) => findConceptLoose(base.concepts, name)?.group === g));
  if (qs.length) page.append(questionList(base, qs));
  const select = h('select', { 'aria-label': '筛选概念' },
    h('option', { value: '', textContent: '全部概念' }),
    ...g.concepts.map((c) => h('option', { value: c.title, textContent: c.title, selected: c === active })));
  select.onchange = () => { location.hash = topicHref(g.n, select.value); };
  page.append(h('label', { class: 'tb-filter' }, '筛选概念 ', select));

  const definitions = active ? page : h('details', { class: 'tb-case' },
    h('summary', { textContent: `本组概念（${g.concepts.length}）` }));
  if (!active) page.append(definitions);
  for (const c of active ? [active] : g.concepts) {
    const row = (k, v) => (v ? [h('dt', { textContent: k }), h('dd', {}, ...inline(v, base.ctx, cbase))] : []);
    const rel = c.related.map((name) => {
      const hit = findConceptLoose(base.concepts, name);
      return hit ? h('a', { href: topicHref(hit.group.n, hit.concept.title), textContent: name }) : h('span', { textContent: name });
    });
    definitions.append(h('details', { class: 'tb-cc', id: `c-${c.title}`, open: !!active }, h('summary', { textContent: c.title }),
      h('dl', {}, ...row('是什么', c.what), ...row('用来做什么', c.use), ...row('用在哪些场景', c.where),
        ...(rel.length ? [h('dt', { textContent: '相关' }), h('dd', { class: 'tb-rel' }, ...rel.flatMap((a, i) => (i ? [' · ', a] : [a])))] : [])),
      active ? null : h('a', { class: 'tb-ref', href: topicHref(g.n, c.title), textContent: '查看相关章节' })));
  }

  let only = false;
  try { only = localStorage.getItem(ONLY_LEARNED) === '1'; } catch {}
  const toggle = h('input', { type: 'checkbox', checked: only });
  // 相关章节很长，默认收起（用户 2026-11-08）；从“查看相关章节”点进来（筛选了某个概念）时展开
  const sourcesTitle = h('span');
  const sources = h('div');
  page.append(h('details', { class: 'tb-fold', open: !!active }, h('summary', { class: 'tb-sec' }, sourcesTitle),
    h('label', { class: 'tb-only' }, toggle, ' 只看学过的章'), sources));

  function renderSources() {
    const rows = [];
    for (const t of texts) {
      if (toggle.checked && !learnedOf(t.doc)) continue;
      const sections = t.parsed.sections.filter((s) => TOPIC_KINDS.includes(s.title) || s.title === '两面')
        .map((s) => [s.title, s.blocks.filter(matches)]).filter(([, bs]) => bs.length);
      if (!sections.length) continue;
      const details = h('details', { class: 'tb-case' }, h('summary', { textContent: fullName(t.c) }));
      details.addEventListener('toggle', () => {
        if (!details.open || details.childElementCount > 1) return;
        const ctx = { ...base.ctx, chapter: t.c };
        const source = { path: t.doc.path, docSet: base.docSet };
        details.append(h('a', { class: 'tb-ref', href: textHref(t.c.id), textContent: '读完整章' }));
        for (const [title, blocks] of sections) details.append(...sectionBody(title, blocks, ctx, source, false));
      });
      rows.push(details);
    }
    sourcesTitle.textContent = `相关章节（${rows.length}）`;
    sources.replaceChildren(...rows);
    if (!rows.length) sources.append(h('p', { class: 'muted', textContent: toggle.checked
      ? '没有已标为学过的匹配章节。取消筛选可看全部。' : '当前没有章块使用这个概念标签。' }));
  }
  toggle.onchange = () => {
    try { localStorage.setItem(ONLY_LEARNED, toggle.checked ? '1' : '0'); } catch {}
    renderSources();
  };
  renderSources();
  page.append(h('div', { class: 'tb-pager' },
    prev ? h('a', { class: 'btn', href: topicHref(prev.n), textContent: `← ${prev.name}` }) : h('span'),
    next ? h('a', { class: 'btn', href: topicHref(next.n), textContent: `${next.name} →` }) : h('span')));

  return { nav: navPanel(base, `topic-${g.n}`) };
}
