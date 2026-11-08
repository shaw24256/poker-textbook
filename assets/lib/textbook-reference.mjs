// 教材的概念卡和价格曲线。概念卡直接读概念索引，曲线用下注前的底池作单位。
import { h, s, pct } from './dom.mjs';
import { bookHref, chapterLabel, findConcept, topicHref } from './textbook.mjs';
import { fourColorSuits } from './suits.mjs';

function sourceNodes(source, chapters) {
  const out = [];
  let end = 0;
  // 索引的括号中常有多个讨论点，保留整句，只将明确的章号或书页变成原书链接。
  for (const match of source.matchAll(/(?:[上中下]\s*)?([一二三四五六七])年级\s*(\d{2})(?:\s*p(\d+)(?:[-–—]\d+)?)?/g)) {
    const chapter = chapters.find((c) => c.id.startsWith(match[1] + '年级' + match[2] + '_'));
    if (!chapter) continue;
    const page = Number(match[3]);
    const [start, finish] = chapter.book_pages ?? [];
    if (page && !(start <= page && page <= finish)) continue;
    out.push(source.slice(end, match.index), h('a', {
      href: bookHref(chapter.id, page ? page - start + 1 : 1), title: chapterLabel(chapter) + '原书',
      textContent: match[0],
    }));
    end = match.index + match[0].length;
  }
  return [...out, source.slice(end)];
}

function showCard(button, concept, group, chapters) {
  const close = h('button', { type: 'button', class: 'tb-card-dismiss', textContent: '关闭' });
  const panel = h('section', { id: 'tb-open-concept', popover: 'auto', role: 'dialog', class: 'tb-concept-card', 'aria-label': concept.title },
    h('header', {}, h('strong', { textContent: concept.title }), close),
    h('p', { textContent: concept.what.replaceAll('**', '') }),
    concept.source ? h('div', { class: 'tb-card-source' }, h('b', { textContent: '出处　' }), ...sourceNodes(concept.source, chapters)) : null,
    h('footer', {}, h('a', { href: topicHref(group.n), textContent: '读主题' + group.num }),
      h('a', { href: topicHref(group.n, concept.title), textContent: '看相关章块' })));
  fourColorSuits(panel);
  // 页面同时只保留一张卡，关闭时一起移除滚动监听。
  document.querySelector('.tb-concept-card')?.hidePopover();
  const events = new AbortController();
  const hide = () => panel.hidePopover();
  close.onclick = () => { hide(); button.focus({ preventScroll: true }); };
  panel.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'closed') return;
    events.abort();
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
    queueMicrotask(() => panel.remove());
  });
  const place = () => {
    const box = button.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(gap, Math.min(box.left, innerWidth - panel.offsetWidth - gap));
    const below = box.bottom + gap;
    const top = below + panel.offsetHeight <= innerHeight - gap ? below : Math.max(gap, box.top - gap - panel.offsetHeight);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  };
  document.body.append(panel);
  panel.showPopover({ source: button });
  place();
  close.focus({ preventScroll: true });
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', panel.id);
  window.addEventListener('resize', place, { signal: events.signal });
  window.addEventListener('scroll', place, { capture: true, passive: true, signal: events.signal });
  window.addEventListener('hashchange', hide, { signal: events.signal });
}

export function conceptButton(name, ctx) {
  const { concept, group } = findConcept(ctx.concepts, name);
  const button = h('button', {
    type: 'button', class: 'tb-cpt', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', textContent: '→ ' + name,
  });
  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (button.getAttribute('aria-expanded') === 'true') document.querySelector('.tb-concept-card')?.hidePopover();
    else showCard(button, concept, group, ctx.chapters);
  };
  return button;
}

const curves = [
  { label: '跟注方 · 终局跟注所需权益', color: 'var(--series-1)', calculate: (b) => b / (1 + 2 * b) },
  { label: '下注方 · 纯空气保本所需弃牌率', color: 'var(--series-2)', calculate: (b) => b / (1 + b) },
  { label: '防守方 · 最低防守频率（MDF）', color: 'var(--ink-2)', calculate: (b) => 1 / (1 + b) },
];

export function priceCurve(source) {
  const raw = source.trim() || '75';
  const initial = Number(raw.replace(/%$/, ''));
  if (!/^\d+%?$/.test(raw) || initial < 10 || initial > 400) {
    return h('p', { class: 'tb-bad-text', textContent: '价格曲线的初始尺度应为 10% 至 400% 的整数，如 75%。' });
  }

  const max = 400; // 包含本章讨论的 B400。
  const x = (percent) => 38 + 508 * (percent - 10) / (max - 10);
  const y = (share) => 158 - 143 * share;
  const graph = s('svg', { viewBox: '0 0 560 182', role: 'img', 'aria-label': '跟注门槛、保本弃牌率、最低防守频率随下注尺度的变化' });
  const tick = (left, top, label, anchor) => {
    const text = s('text', { x: left, y: top, 'text-anchor': anchor });
    text.textContent = label;
    graph.append(text);
  };
  for (const level of [0, .25, .5, .75, 1]) {
    graph.append(s('line', { x1: 38, x2: 546, y1: y(level), y2: y(level), stroke: 'var(--grid)' }));
    tick(34, y(level) + 4, level * 100 + '%', 'end');
  }
  for (const b of [10, 75, 150, 200, 300, 400]) tick(x(b), 177, b + '%', b === max ? 'end' : 'middle');
  const marker = s('line', { y1: 15, y2: 158, stroke: 'var(--axis)' });
  graph.append(marker);
  const readings = curves.map(({ label, color, calculate }, index) => {
    const coords = [];
    for (let b = 10; b <= max; b += 2) coords.push(x(b).toFixed(1) + ',' + y(calculate(b / 100)).toFixed(1));
    const line = s('polyline', { points: coords.join(' '), stroke: color, 'stroke-width': 2.5, fill: 'none' });
    if (index === 2) line.setAttribute('stroke-dasharray', '5 4');
    const dot = s('circle', { r: 4, fill: color });
    graph.append(line, dot);
    const output = h('strong');
    const item = h('div', {}, output, h('span', { textContent: label }));
    item.style.borderColor = color;
    return { dot, output, item, calculate };
  });
  const slider = h('input', { type: 'range', min: '10', max: String(max), value: String(initial), step: '1' });
  const value = h('b');
  const update = () => {
    const b = Number(slider.value);
    value.textContent = b + '% 底池';
    slider.setAttribute('aria-valuetext', value.textContent);
    marker.setAttribute('x1', x(b));
    marker.setAttribute('x2', x(b));
    for (const { dot, output, calculate } of readings) {
      const share = calculate(b / 100);
      dot.setAttribute('cx', x(b));
      dot.setAttribute('cy', y(share));
      output.textContent = pct(share);
    }
  };
  slider.oninput = update;
  update();
  return h('div', { class: 'tb-curve' }, graph, h('label', {}, '下注尺度　', value, slider),
    h('div', { class: 'tb-curve-readings' }, ...readings.map((r) => r.item)));
}
