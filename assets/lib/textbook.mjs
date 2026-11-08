// 胡萝卜整理版教材的解析和校验（纯函数，不碰 DOM，node 里能测）。格式见 Poker/交接_胡萝卜整理版教材.md。
// 章文件 记录/读书/胡萝卜扑克学校/教材/<章 id>.md；主题由章文件里的概念标签和 概念索引.md 自动拼。

export const TEXT_DIR = '记录/读书/胡萝卜扑克学校/教材/';
export const TOPICS_DOC = `${TEXT_DIR}主题.md`;
export const CONCEPTS_DOC = '记录/读书/胡萝卜扑克学校/概念索引.md';
export const studyPath = (id) => `记录/读书/胡萝卜扑克学校/${id}.md`;
export const textPath = (id) => `${TEXT_DIR}${id}.md`;
export const textHref = (id) => `#/notes/text/${encodeURIComponent(id)}`;
export const topicHref = (n, c) => `#/notes/topic/${n}${c ? `?c=${encodeURIComponent(c)}` : ''}`;
export const bookHref = (id, p) => `#/notes/book/${encodeURIComponent(id)}${p ? `?p=${p}` : ''}`;   // 带页码时 p=1 也要写，不然阅读页会跳到上次读到的那页

// 固定的二级标题，顺序照写；list = 一个顶层列表项一块，h3 = 一个三级标题一块
export const SECTIONS = [
  ['要点', 'list'], ['总表', 'h3'], ['小工具', 'h3'], ['牌例', 'h3'], ['两面', 'h3'], ['剥削提示', 'list'], ['联系', 'plain'],
];
const SECTION_KIND = Object.fromEntries(SECTIONS);
const NUMS = '一二三四五六七八九十';
export const cnNum = (n) => (n <= 10 ? NUMS[n - 1] : n < 20 ? `十${NUMS[n - 11] ?? ''}` : String(n));

// ---------- 章 ----------

// 章的显示名：上册不加册名（和概念索引的引用写法一致）
export const chapterLabel = (c) => `${c.book === '上' ? '' : `${c.book} `}${c.grade}年级 ${c.no}`;

// 章文件 → { lead, where, pre（开头其余部分）, sections: [{ title, kind, md, blocks: [{ title?, md, tags }] }] }
export function parseChapter(body) {
  const lines = body.replace(/\r/g, '').split('\n');
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    else if (!fence && /^## /.test(l)) heads.push(i);
  });
  const head = lines.slice(0, heads[0] ?? lines.length).join('\n');
  const paras = head.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const leadIdx = paras.findIndex((p) => !p.startsWith('>') && !p.startsWith('#'));
  const whereIdx = paras.findIndex((p) => p.startsWith('>'));
  const out = {
    lead: leadIdx >= 0 ? paras[leadIdx] : null,
    where: whereIdx >= 0 ? paras[whereIdx].replace(/^>\s?/gm, '') : null,
    pre: paras.filter((_, i) => i !== leadIdx && i !== whereIdx).join('\n\n'),
    sections: [],
  };
  heads.forEach((start, k) => {
    const title = lines[start].slice(3).trim();
    const md = lines.slice(start + 1, heads[k + 1] ?? lines.length).join('\n').trim();
    const kind = SECTION_KIND[title] ?? null;
    out.sections.push({ title, kind, md, blocks: kind === 'list' ? listBlocks(md) : kind === 'h3' ? h3Blocks(md) : [] });
  });
  return out;
}

// 顶层列表项：“- ” 开头到下一个顶层 “- ” 或空行后的非缩进行
function listBlocks(md) {
  const blocks = [];
  let cur = null;
  for (const l of md.split('\n')) {
    const m = l.match(/^[-*+] (.*)$/);
    if (m) { cur = [m[1]]; blocks.push(cur); continue; }
    if (cur && (/^\s+\S/.test(l) || !l.trim())) { cur.push(l.replace(/^ {1,4}/, '')); continue; }
    if (l.trim()) { cur = null; blocks.push([l]); }   // 列表外的文字也算一块（会被当成格式问题之外的普通段落显示）
  }
  return blocks.map((b) => { const t = b.join('\n').trim(); return { md: t, tags: tagsOf(t) }; });
}

function h3Blocks(md) {
  const blocks = [];
  let cur = null;
  let fence = false;
  for (const l of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(/^### (.*)$/);
    if (m) { cur = { title: m[1].trim(), lines: [] }; blocks.push(cur); continue; }
    if (!cur) { if (l.trim()) { cur = { title: null, lines: [] }; blocks.push(cur); } else continue; }
    cur.lines.push(l);
  }
  return blocks.map((b) => { const t = b.lines.join('\n').trim(); return { title: b.title, md: t, tags: tagsOf(`${b.title ?? ''}\n${t}`) }; });
}

export const tagsOf = (text) => [...String(text).matchAll(/\[\[([^[\]]+?)\]\]/g)].map((m) => m[1].trim());

// ---------- 行内标记 ----------

// 依次：概念标签、待核对 / 待验证、本章页码、别的章（可带页码）、写得像标记但认不出的
export const MARK_RE = /\[\[([^[\]]+?)\]\]|\[(待核对|待验证)\]|\[p(\d+)(?:[-–](\d+))?\]|\[([一二三四五六七]年级\d{2})(?:\s+p(\d+)(?:[-–](\d+))?)?\]|\[((?:p\s*\d|[一二三四五六七]年级)[^\]]*)\]/g;

// ctx: { chapter（本章，可为 null）, chapters（全部章，书的顺序）, hasText(id), concepts（parseConcepts 的结果） }
// → { kind: 'concept' | 'flag' | 'page' | 'chapter' | 'bad', text, href?, error? }
export function resolveMark(m, ctx) {
  const [raw, concept, flag, p1, p2, ref, rp1, rp2, bad] = m;
  if (concept != null) {
    const c = findConcept(ctx.concepts, concept);
    return c ? { kind: 'concept', text: `→ ${concept}`, href: topicHref(c.group.n, c.concept.title) }
      : { kind: 'concept', text: `→ ${concept}`, error: `概念名对不上概念索引里的标题：${concept}` };
  }
  if (flag) return { kind: 'flag', text: flag };
  if (p1) {
    if (!ctx.chapter) return { kind: 'page', text: pageText(p1, p2), error: '这里没有“本章”，页码要写成 [三年级03 p40]' };
    return pageMark(ctx.chapter, Number(p1), p2 && Number(p2), pageText(p1, p2));
  }
  if (ref) {
    const c = ctx.chapters.find((x) => x.id.startsWith(`${ref}_`));
    if (!c) return { kind: 'chapter', text: raw.slice(1, -1), error: `找不到这一章：${ref}` };
    if (rp1) return pageMark(c, Number(rp1), rp2 && Number(rp2), `${chapterLabel(c)} ${pageText(rp1, rp2)}`);
    return { kind: 'chapter', text: chapterLabel(c), href: ctx.hasText(c.id) ? textHref(c.id) : bookHref(c.id) };
  }
  return { kind: 'bad', text: raw, error: `写法认不出：${raw}（页码写 [p6]、[p6-7]，别的章写 [三年级03] 或 [三年级03 p40]）` };
}

const pageText = (a, b) => `p${a}${b ? `–${b}` : ''}`;

function pageMark(c, a, b, text) {
  const [s, e] = c.book_pages ?? [];
  const kind = 'page';
  if (s == null) return { kind, text, error: `${chapterLabel(c)} 没有页码范围` };
  if (b != null && b < a) return { kind, text, error: `页码范围倒过来了：${text}` };
  for (const p of [a, b ?? a]) if (p < s || p > e) return { kind, text, error: `p${p} 不在 ${chapterLabel(c)} 的范围（p${s}–${e}）里` };
  return { kind, text, href: bookHref(c.id, a - s + 1) };
}

// 一段文字里所有标记 → [{ index, length, ...resolveMark }]
export function marksIn(text, ctx) {
  return [...String(text).matchAll(MARK_RE)].map((m) => ({ index: m.index, length: m[0].length, ...resolveMark(m, ctx) }));
}

// ---------- 小工具（calc） ----------

const MATH = ['pow', 'sqrt', 'min', 'max', 'log', 'round', 'abs', 'floor', 'ceil', 'exp'];
// 一行 → [{ t: 'text', s } | { t: 'in', name, value } | { t: 'out', expr, dp }]
export function parseCalcLine(line) {
  const parts = [];
  let last = 0;
  for (const m of line.matchAll(/\{\s*(?:=\s*([^{}]+?)(?:\s*:\s*(\d+))?|([A-Za-z_]\w*)\s*=\s*(-?[\d.]+))\s*\}/g)) {
    if (m.index > last) parts.push({ t: 'text', s: line.slice(last, m.index) });
    parts.push(m[1] != null ? { t: 'out', expr: m[1].trim(), dp: m[2] != null ? Number(m[2]) : 1 } : { t: 'in', name: m[3], value: Number(m[4]) });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ t: 'text', s: line.slice(last) });
  return parts;
}

// 算不出来（报错、NaN、无穷）→ null
export function evalCalc(expr, vars) {
  try {
    const names = Object.keys(vars).filter((k) => !MATH.includes(k));
    // eslint-disable-next-line no-new-func
    const v = new Function(...names, ...MATH, `return (${expr});`)(...names.map((k) => vars[k]), ...MATH.map((k) => Math[k]));
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// 整个代码块：每行解析，返回 { lines, vars（默认值）}
export function parseCalc(src) {
  const lines = src.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map(parseCalcLine);
  const vars = {};
  for (const p of lines.flat()) if (p.t === 'in') vars[p.name] = p.value;
  return { lines, vars };
}

// ---------- 概念索引、主题导语 ----------

// → { groups: [{ n, num, name, title, concepts: [{ title, keys, what, use, where, source, related }] }], questions: [{ q, names }] }
export function parseConcepts(body) {
  const groups = [];
  const questions = [];
  let group = null;
  let concept = null;
  let inQuestions = false;
  for (const l of body.replace(/\r/g, '').split('\n')) {
    let m = l.match(/^## (.+)$/);
    if (m) {
      concept = null;
      inQuestions = m[1].trim() === '从问题找概念';
      const g = m[1].match(/^([一二三四五六七八九十]+)、(.+)$/);
      group = g ? { num: g[1], name: g[2].trim(), title: m[1].trim(), concepts: [] } : null;
      if (group) groups.push(group);
      continue;
    }
    m = l.match(/^### (.+)$/);
    if (m && group) {
      const title = m[1].trim();
      concept = { title, keys: [...new Set([title, title.split(/[（：]/)[0].trim()])], what: '', use: '', where: '', source: '', related: [] };
      group.concepts.push(concept);
      continue;
    }
    m = l.match(/^- \*\*(.+?)\*\*[:：]\s*(.*)$/);
    if (m && concept) {
      const field = { 是什么: 'what', 用来做什么: 'use', 用在哪些场景: 'where', 出处: 'source' }[m[1]];
      if (field) concept[field] = m[2].trim();
      else if (m[1] === '检索词') concept.keys.push(...m[2].split('|').map((key) => key.trim()).filter(Boolean));
      else if (m[1] === '相关') concept.related = splitArrows(m[2]);
      continue;
    }
    m = inQuestions && l.match(/^\d+\.\s+\*\*(.+?)\*\*\s*→\s*(.+)$/);
    if (m) {
      questions.push({ q: m[1].trim(), names: splitArrows(m[2]) });
      continue;
    }
    const note = inQuestions && l.match(/^\s+- (场景|先想|换个条件)：(.+)$/);
    const question = questions.at(-1);
    if (note && question) {
      if (note[1] === '场景') [question.family, question.short] = note[2].split(' / ');
      else question[note[1] === '先想' ? 'think' : 'vary'] = note[2].trim();
    }
  }
  const topics = groups.filter((g) => g.concepts.length);
  topics.forEach((g, i) => { g.n = i + 1; });
  return { groups: topics, questions };
}

const splitArrows = (s) => s.split('→').map((x) => x.trim()).filter(Boolean);

// 章文件里的 [[概念]]：等于标题，或标题第一个“（”“：”之前的部分 → { group, concept } 或 null
export function findConcept(concepts, name) {
  const key = name.trim();
  let hit = null;
  for (const group of concepts?.groups ?? []) {
    for (const concept of group.concepts) {
      if (concept.title === key) return { group, concept };
      if (!concept.keys.includes(key)) continue;
      if (hit) return null;
      hit = { group, concept };
    }
  }
  return hit;
}

// 概念索引自己的“相关”“从问题找概念”写得松一些：再试去掉括号注释、按开头对上
export function findConceptLoose(concepts, name) {
  const hit = findConcept(concepts, name) ?? findConcept(concepts, name.replace(/（[^）]*）\s*$/, ''));
  if (hit) return hit;
  const key = name.replace(/（[^）]*）\s*$/, '').trim();
  if (key.length < 2) return null;
  const matches = (concepts?.groups ?? []).flatMap((group) =>
    group.concepts.filter((concept) => concept.title.startsWith(key)).map((concept) => ({ group, concept })));
  return matches.length === 1 ? matches[0] : null;
}

// 主题导语后可接一道开放题。旧稿只有导语时也能阅读。
export function parseTopicGuides(body) {
  const guides = new Map();
  const sections = body.replace(/\r/g, '').split(/^## /m).slice(1);
  for (const section of sections) {
    const [title, ...lines] = section.trimEnd().split('\n');
    const firstHeading = lines.findIndex((line) => line.startsWith('### '));
    const exercise = lines.findIndex((line) => line.startsWith('### 自测｜'));
    const questionAt = exercise >= 0 ? exercise : firstHeading;
    const intro = (firstHeading < 0 ? lines : lines.slice(0, firstHeading)).join('\n').trim();
    const lessonLines = exercise > firstHeading ? lines.slice(firstHeading, exercise) : [];
    const hasMap = lessonLines[0] === '### 复习图';
    let lessonStart = 0;
    if (hasMap) {
      const next = lessonLines.findIndex((line, i) => i > 0 && line.startsWith('### '));
      lessonStart = next < 0 ? lessonLines.length : next;
    }
    const lesson = lessonLines.slice(lessonStart).join('\n').trim();
    guides.set(title.trim(), {
      intro,
      ...(hasMap ? { reviewMap: lessonLines.slice(1, lessonStart).join('\n').trim() } : {}),
      ...(lesson ? { lesson } : {}),
      question: questionAt < 0 ? '' : lines[questionAt].slice(4).trim(),
      answer: questionAt < 0 ? '' : lines.slice(questionAt + 1).join('\n').trim(),
    });
  }
  return guides;
}

export function parseTopicIntros(body) {
  return new Map([...parseTopicGuides(body)].map(([title, guide]) => [title, guide.intro]));
}

// 学习记录：标题含“学习记录”的那一节（到下一个同级或更高的标题）
export function studySection(body) {
  const lines = body.replace(/\r/g, '').split('\n');
  const i = lines.findIndex((l) => /^#{2,3} .*学习记录/.test(l));
  if (i < 0) return null;
  const level = lines[i].match(/^#+/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(lines[j].match(/^(#+) /)?.[1].length <= level)) j += 1;
  const md = lines.slice(i + 1, j).join('\n').trim();
  return md || null;
}

// ---------- 校验（目录页底部的问题清单） ----------

// → [{ msg, at }]，at 是出问题的那段文字（截短）
export function checkChapter(doc, parsed, ctx) {
  const out = [];
  const at = (s) => String(s).replace(/\s+/g, ' ').slice(0, 40);
  if (doc.fm_error) out.push({ msg: '开头的 frontmatter 格式不对', at: '---' });
  let order = -1;
  for (const s of parsed.sections) {
    if (!s.kind) { out.push({ msg: `认不出的二级标题：## ${s.title}`, at: s.title }); continue; }
    const k = SECTIONS.findIndex(([t]) => t === s.title);
    if (k < order) out.push({ msg: `## ${s.title} 的位置不对，顺序应是 ${SECTIONS.map(([t]) => t).join(' → ')}`, at: s.title });
    order = Math.max(order, k);
    if (s.kind === 'plain') continue;
    for (const b of s.blocks) {
      if (!b.tags.length) out.push({ msg: `${s.title}：这一块没有概念标签，主题页里不会出现`, at: b.title ?? b.md });
      for (const m of b.md.matchAll(/```calc\n([\s\S]*?)```/g)) {
        const { lines, vars } = parseCalc(m[1]);
        for (const p of lines.flat()) if (p.t === 'out' && evalCalc(p.expr, vars) == null) out.push({ msg: `小工具算不出来：{= ${p.expr}}`, at: b.title ?? '' });
      }
    }
  }
  const text = [parsed.lead, parsed.where, parsed.pre, ...parsed.sections.map((s) => s.md)].filter(Boolean).join('\n')
    .replace(/```[\s\S]*?```/g, (c) => (c.startsWith('```calc') ? c : ''))   // 普通代码块里的方括号不算标记
    .replace(/`[^`\n]*`/g, '');
  for (const mk of marksIn(text, ctx)) {
    if (mk.error) out.push({ msg: mk.error, at: at(text.slice(Math.max(0, mk.index - 16), mk.index + mk.length)) });
  }
  return out;
}
