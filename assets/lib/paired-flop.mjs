import { h } from './dom.mjs';
import cache from './paired-flop-data.mjs';
import { parseFlopSettings, flopCacheKey, legacyFlop } from './flop-settings.mjs';
import { suitClass } from './suits.mjs';

const pct = (n) => (n * 100).toFixed(1) + '%';

function chart(label, values, sides) {
  return h('div', { class:'fl-chart' }, h('h4', { textContent:label }),
    ...values.map((value, i) => {
      const bar = h('i');
      bar.style.width = pct(value);
      return h('div', { class:'fl-bar-row' }, h('span', { textContent:sides[i].label }),
        h('span', { class:'fl-track', 'aria-hidden':'true' }, bar), h('b', { textContent:pct(value) }));
    }));
}

function panel(board, state, sides) {
  const deck = board.map((face) => h('span', { class:'fl-card ' + suitClass[face[1]], textContent:face }));
  return h('section', { class:'fl-panel', 'aria-label':board.join(' ') },
    h('div', { class:'fl-board' }, ...deck),
    chart('平均摊牌权益', state.sides.map((s) => s.equity), sides),
    chart('权益 ≥ 80% 的强牌占比', state.sides.map((s) => s.strong), sides),
    h('details', {}, h('summary', { textContent:'哪些牌进入强牌区？' }),
      ...state.sides.map((side, i) => h('p', { textContent:sides[i].label + '：' + (side.types.join('、') || '无') })),
      h('small', { textContent:'列出至少有一组花色达标的牌类。' })));
}

export function pairedFlop(source = '') {
  const settings = parseFlopSettings(source.trim() || legacyFlop);
  const { boards, sides, extras, notes } = settings;
  const scores = cache[flopCacheKey(settings)];
  if (!scores) throw Error('牌面或范围已变更，请先运行 node 网站/scripts/build-flop-comparison.mjs 重算权益。');
  const panels = h('div', { class:'fl-panels' });
  const takeaway = h('p', { class:'fl-readout', 'aria-live':'polite' });
  const sample = h('p');
  const checks = extras.map(() => h('input', { type:'checkbox', onchange:render }));
  function render() {
    const mask = checks.reduce((n, input, i) => n + (input.checked ? 1 << i : 0), 0);
    const states = scores.map((results) => results[mask]);
    panels.replaceChildren(...states.map((state, i) => panel(boards[i], state, sides)));
    takeaway.textContent = notes.get(mask) || '';
    takeaway.hidden = !takeaway.textContent;
    sample.textContent = '按当前设定，两副翻牌分别有 ' + states.map((s) => s.pairs.toLocaleString()).join('、') +
      ' 组合法对局。每对双方底牌都枚举 990 种转河组合，平局均分。按合法对局数加权。';
  }
  render();
  return h('section', { class:'fl-lab', 'aria-label':'双方范围对照实验' },
    extras.length ? h('fieldset', { class:'fl-options' },
      h('legend', { textContent:sides[1].label + '翻前额外跟入哪些牌？' }),
      ...extras.map((g, i) => h('label', {}, checks[i], ' ' + g.label + '（' + g.hands.join('、') + '）'))) : null,
    panels, takeaway,
    h('details', { class:'fl-inputs' }, h('summary', { textContent:'查看教学范围与计算口径' }),
      ...sides.map((g, i) => h('p', { textContent:g.label + (i ? '基础：' : '固定：') + g.hands.join('、') + '。' })),
      sample, h('p', { textContent:'每种合法花色组合等权。强牌区取单手对整个对方范围摊牌权益至少 80% 的组合，用来观察范围顶端。门槛是教学设定；下注尺度与频率另需比较行动 EV。' })));
}
