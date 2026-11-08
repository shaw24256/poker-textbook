import { HANDS, parseRange } from './range-parser.mjs';
import { h, pct } from './dom.mjs';
import { bookHref } from './textbook.mjs';
import { splitSuits } from './suits.mjs';

const SUITS = 'shdc';
const SYMBOLS = '♠♥♦♣';
const RANKS = 'AKQJT98765432';
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const number = (value) => Number(value.toFixed(2)).toString();

function cards(input, count) {
  const text = input.replace(/[♠♥♦♣]/g, (s) => SUITS[SYMBOLS.indexOf(s)]).replace(/\s+/g, '');
  const matches = text.match(/[2-9TJQKA][shdc]/gi) || [];
  const list = matches.map((c) => c[0].toUpperCase() + c[1].toLowerCase());
  ensure(list.length === count && text.length === count * 2 && new Set(list).size === count, '请检查牌数、花色或重复的牌：' + input);
  return list;
}

function fields(source, allowed) {
  const values = {};
  for (const line of source.trim().split(/\r?\n/).filter((l) => l.trim())) {
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    ensure(m && allowed.includes(m[1].trim()), '无法识别这一行：' + line);
    const key = m[1].trim();
    ensure(!(key in values), '重复字段：' + key);
    values[key] = m[2].trim();
  }
  return values;
}

function boardRow(list) {
  return h('span', { class: 'act-cards' }, ...list.map(([rank, suit]) =>
    h('span', { class: 'fl-card hs-' + suit }, h('b', {}, rank), SYMBOLS[SUITS.indexOf(suit)])));
}
const inline = (text) => splitSuits(text).map((p) => p.suit ? h('span', { class: p.suit }, p.text) : p.text);

function handClass(a, b) {
  if (a[0] === b[0]) return a[0] + b[0];
  const ranks = RANKS.indexOf(a[0]) < RANKS.indexOf(b[0]) ? a[0] + b[0] : b[0] + a[0];
  return ranks + (a[1] === b[1] ? 's' : 'o');
}

const deck = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
const allCombos = deck.flatMap((a, i) => deck.slice(i + 1).map((b) => ({ a, b, key: handClass(a, b) })));

// 通用解析器会把 AsKs 压成 1/4 个 AKs。阻挡要保留具体花色，因此按项展开再应用死牌。
function rangeWeights(range) {
  const weights = new Map();
  for (const item of range.trim().split(/[,，\s]+/)) {
    ensure(item.split(':').length <= 2 && !item.endsWith(':'), '无效范围项：' + item);
    const types = parseRange(item);
    const [raw, w] = item.split(':');
    if (/^[2-9TJQKA][shdc][2-9TJQKA][shdc]$/i.test(raw)) {
      const [a, b] = cards(raw, 2);
      const combo = allCombos.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
      const weight = !w ? 1 : w.endsWith('%') ? Number(w.slice(0,-1)) / 100 : Number(w);
      weights.set(combo, weight);
    } else {
      for (const combo of allCombos) if (combo.key in types) weights.set(combo, types[combo.key]);
    }
  }
  return weights;
}

export function parseBlockers(source) {
  const f = fields(source, ['公共牌', '价值', '诈唬', '候选', '尺度']);
  ensure(['公共牌', '价值', '诈唬', '候选', '尺度'].every((key) => f[key]), '需填写公共牌、价值、诈唬、候选和尺度。');
  const board = cards(f.公共牌, 5);
  const heroes = f.候选.split(/[,，/]/).map((s) => cards(s, 2));
  ensure(heroes.every((hero) => !hero.some((c) => board.includes(c))), '候选手牌与公共牌重复。');
  const sizes = f.尺度.split(/[,，\s]+/).map((s) => Number(s.replace(/%$/, '')));
  ensure(sizes.every((v) => Number.isFinite(v) && v > 0), '下注尺度要填正的底池百分比。');
  const value = rangeWeights(f.价值), bluff = rangeWeights(f.诈唬);
  const range = [];
  for (const combo of allCombos) {
    if (board.includes(combo.a) || board.includes(combo.b)) continue;
    const v = value.get(combo) || 0, b = bluff.get(combo) || 0;
    ensure(!(v && b), '价值和诈唬范围重叠：' + combo.a + combo.b);
    if (v || b) range.push({ ...combo, value: v, bluff: b });
  }
  ensure(range.length, '公共牌移除后，下注范围为空。');
  return { board, heroes, sizes, range, value: f.价值, bluff: f.诈唬 };
}

export function blockerResult(range, hero, bet, bluffWeight) {
  const groups = new Map();
  let value = 0, bluff = 0;
  for (const c of range) {
    const cell = groups.get(c.key) || { before: 0, after: 0, value: 0, bluff: 0, valueLost: 0, bluffLost: 0 };
    const weight = c.value || c.bluff;
    cell.before += weight;
    cell.value += c.value;
    cell.bluff += c.bluff;
    if (!hero.includes(c.a) && !hero.includes(c.b)) {
      cell.after += weight;
      value += c.value;
      bluff += c.bluff * bluffWeight;
    } else {
      cell.valueLost += c.value;
      cell.bluffLost += c.bluff;
    }
    groups.set(c.key, cell);
  }
  const share = value + bluff > 0 ? bluff / (value + bluff) : null;
  return { groups, value, bluff, share, need: bet / (100 + 2 * bet), ev: share == null ? null : share * (100 + 2 * bet) - bet };
}

function buttons(label, labels, onChange) {
  const group = h('div', { class: 'act-options', role: 'group', 'aria-label': label }, h('span', {}, label));
  const controls = labels.map((nodes, i) => h('button', { class: 'btn', type: 'button', 'aria-pressed': String(!i),
    onclick: () => {
      controls.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
      onChange(i);
    } }, ...nodes));
  group.append(...controls);
  return group;
}

function blockerLab(src) {
  const spec = parseBlockers(src);
  let hero = spec.heroes[0], size = spec.sizes[0], weight = 1;
  const grid = h('div', { class: 'act-grid', role: 'img', 'aria-label': '对手下注范围，13 行 13 列' });
  const removed = h('p', { class: 'act-removed' });
  const totals = h('dl', { class: 'act-results', 'aria-live': 'polite' });
  function render() {
    const r = blockerResult(spec.range, hero, size, weight);
    const hits = [];
    grid.replaceChildren(...HANDS.map((key) => {
      const g = r.groups.get(key);
      if (!g) return h('span', { class: 'act-cell' }, key);
      const role = g.value && g.bluff ? 'mixed' : g.value ? 'value' : 'bluff';
      const kind = { value: '价值', bluff: '诈唬', mixed: '价值和诈唬' }[role];
      const lost = g.before - g.after;
      if (g.valueLost) hits.push(key + ' 价值少 ' + number(g.valueLost));
      if (g.bluffLost) hits.push(key + ' 诈唬少 ' + number(g.bluffLost));
      const cell = h('span', { class: 'act-cell act-' + role + (lost > 1e-8 ? ' act-hit' : ''),
        title: key + ' ' + kind + '，剩余 ' + number(g.after) + ' / ' + number(g.before) }, key, h('small', {}, number(g.after) + '/' + number(g.before)));
      cell.style.setProperty('--strength', (30 + 45 * g.after / g.before) + '%');
      return cell;
    }));
    removed.textContent = hits.length ? '手牌移除的组合：' + hits.join('，') + '。' : '手牌没有移除对手下注范围里的组合。';
    const stats = [['剩余价值组合', number(r.value)], ['诈唬等效组合', number(r.bluff)], ['诈唬占比', r.share == null ? '—' : pct(r.share)],
      ['跟注门槛', pct(r.need)], ['跟注 EV（底池 100）', r.ev == null ? '无可下注组合' : (r.ev > 0 ? '+' : '') + r.ev.toFixed(1)]];
    totals.replaceChildren(...stats.flatMap(([label, val], i) => [h('dt', {}, label),
      h('dd', { class: i === 4 && r.ev != null ? (r.ev > 0 ? 'act-win' : r.ev < 0 ? 'act-loss' : '') : '' }, val)]));
  }
  render();
  return h('section', { class: 'act-lab', 'aria-label': '阻挡范围格' },
    h('header', {}, h('h4', {}, '阻挡范围格'), boardRow(spec.board)),
    h('p', {}, '教学假设：每手候选牌都赢全部诈唬、输给全部价值。固定对手的范围，比较手牌、价格与诈唬频率。'),
    buttons('我的抓诈牌', spec.heroes.map((hand) => [boardRow(hand)]), (i) => { hero = spec.heroes[i]; render(); }),
    buttons('对手下注', spec.sizes.map((s) => [s + '% 池']), (i) => { size = spec.sizes[i]; render(); }),
    buttons('诈唬使用率', [['全部'], ['四分之一']], (i) => { weight = i ? .25 : 1; render(); }),
    h('div', { class: 'act-comparison' },
      h('div', { class: 'act-matrix' }, grid,
        h('div', { class: 'act-legend' }, h('span', { class: 'act-value' }, '价值'), h('span', { class: 'act-bluff' }, '诈唬'),
          '格中为剩余／原有组合，描边表示被手牌移除。')),
      h('div', { class: 'act-summary' }, totals, removed)),
    h('details', {}, h('summary', {}, '查看教学范围'), h('p', {}, '价值：' + spec.value), h('p', {}, '诈唬：' + spec.bluff)));
}

export function parseReplay(source) {
  const names = ['翻牌', '转牌', '河牌'];
  const f = fields(source, [...names, '手牌', '选项', '结论', '出处', 'EV']);
  ensure(['手牌', ...names, '选项', '结论', '出处'].every((key) => f[key]), '请填写手牌、三街、选项、结论及出处。');
  const hero = cards(f.手牌, 2);
  let board = [];
  const streets = names.map((name, i) => {
    const [dealt, action, question, hint, extra] = f[name].split('|').map((s) => s.trim());
    ensure(dealt && action && question && extra == null, name + '格式为 发牌 | 行动 | 问题 | 可选提示。');
    board = [...board, ...cards(dealt, i ? 1 : 3)];
    ensure(new Set([...hero, ...board]).size === hero.length + board.length, '手牌与三街发牌中有重复的牌。');
    return { name, board, action, question, hint };
  });
  const labels = f.选项.split('|').map((s) => s.trim());
  ensure(labels.length >= 2 && labels.every(Boolean) && labels.filter((s) => s.startsWith('*')).length === 1, '用 * 标出一个书例行动。');
  const answer = labels.findIndex((s) => s.startsWith('*'));
  labels[answer] = labels[answer].slice(1).trim();
  ensure(labels[answer], '书例行动缺少文字。');
  const match = f.出处.match(/^([^\s]+)\s+p(\d+)(?:[-–](\d+))?$/);
  ensure(match, '出处示例：一年级10 p152-153。');
  const ev = (f.EV || '').split('|').filter(Boolean).map((item) => {
    const m = item.trim().match(/^(.+?)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
    ensure(m && Number.isFinite(Number(m[2])), 'EV 格式为 行动=数值。');
    return [m[1].trim(), Number(m[2])];
  });
  return { hero, streets, labels, answer, ev, conclusion: f.结论, source: f.出处, chapter: match[1], start: +match[2], end: +(match[3] || match[2]) };
}

function handReplay(src, chapters) {
  const spec = parseReplay(src);
  const chapter = chapters.find((c) => c.id.split('_')[0] === spec.chapter);
  ensure(chapter && spec.start >= chapter.book_pages[0] && spec.end <= chapter.book_pages[1] && spec.start <= spec.end,
    '出处与原书章页范围不符。');
  const ref = h('a', { class: 'tb-src', href: bookHref(chapter.id, spec.start - chapter.book_pages[0] + 1) }, spec.source);
  const bars = h('div', { class: 'act-bars' });
  const max = Math.max(...spec.ev.map(([, v]) => Math.abs(v)), 1);
  for (const [label, v] of spec.ev) {
    const fill = h('i', { class: v < 0 ? 'act-negative' : 'act-positive' });
    fill.style.width = Math.abs(v) / max * 50 + '%';
    bars.append(h('span', {}, label), h('span', { class: 'act-track', 'aria-hidden': 'true' }, fill), h('b', { class: v < 0 ? 'act-loss' : v > 0 ? 'act-win' : '' }, v.toFixed(2)));
  }
  const verdict = h('strong');
  const response = h('div', { hidden: true, class: 'act-answer', 'aria-live': 'polite' },
    verdict, h('p', {}, ...inline(spec.conclusion)), bars, ref);
  const choices = spec.labels.map((label, i) => h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => {
    choices.forEach((b,j) => b.setAttribute('aria-pressed', String(i === j)));
    verdict.textContent = (i === spec.answer ? '答对了。' : '这手牌应选「' + spec.labels[spec.answer] + '」。');
    response.hidden = false;
  } }, label));
  const streetCards = spec.streets.map((s, i) => h('section', { class: 'act-street', hidden: i !== 0, tabIndex: -1 },
    h('h4', {}, s.name), boardRow(s.board), h('p', {}, ...inline(s.action)), h('p', { class: 'act-question' }, ...inline(s.question)),
    s.hint ? h('details', {}, h('summary', {}, '看书例提示'), h('p', {}, ...inline(s.hint))) : null,
    i === 2 ? h('div', { class: 'act-options' }, ...choices) : null, i === 2 ? response : null));
  let shown = 1;
  const next = h('button', { class: 'btn', type: 'button', textContent: '发转牌', onclick: () => {
    if (shown < streetCards.length) {
      const section = streetCards[shown++];
      section.hidden = false;
      next.textContent = shown === 2 ? '发河牌' : '从翻牌重看';
      section.focus({ preventScroll: true });
    } else {
      shown = 1;
      streetCards.forEach((section, i) => {
        section.hidden = i > 0;
        section.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
      });
      response.hidden = true;
      choices.forEach((b) => b.setAttribute('aria-pressed', 'false'));
      next.textContent = '发转牌';
      streetCards[0].focus();
    }
  } });
  return h('section', { class: 'act-lab', 'aria-label': '逐街牌例回放' },
    h('header', {}, h('h4', {}, '我的手牌'), boardRow(spec.hero)), ...streetCards, next);
}

export function mountTextbookActivities(el, chapters) {
  for (const code of el.querySelectorAll('pre > code.language-blockers, pre > code.language-hand')) {
    try {
      const node = code.classList.contains('language-hand') ? handReplay(code.textContent, chapters) : blockerLab(code.textContent);
      code.parentElement.replaceWith(node);
    } catch (error) {
      const fallback = h('details', { class: 'act-error' }, h('summary', {}, '互动题格式有误：' + error.message));
      code.parentElement.replaceWith(fallback);
      fallback.append(h('pre', {}, code));
    }
  }
}
