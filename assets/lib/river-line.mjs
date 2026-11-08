// 固定同一张河牌，沿转牌过牌线过滤组合，再计算面对河牌下注的跟注收益。
import { h } from './dom.mjs';

const labels = ['空气', '薄价值', '厚价值'];
const format = (number) => Number(number.toFixed(2)).toString();

function readSettings(source) {
  const rows = source.trim().split('\n').map((line) => line.split('|').map((cell) => cell.trim()));
  const groups = labels.map((label) => {
    const row = rows.find((cells) => cells[0] === label);
    if (!row || row.length !== 4 || row.slice(1).some((s) => !/^\d+(?:\.\d+)?$/.test(s))) {
      throw Error('每类手牌需要组合数、转牌过牌率、河牌下注率。');
    }
    const [count, check, bet] = row.slice(1).map(Number);
    if (!Number.isFinite(count) || check > 100 || bet > 100) throw Error('请检查组合数和百分比。');
    return { label, count, check, bet };
  });
  const size = rows.find((cells) => cells[0] === '河牌下注');
  if (rows.length !== 4 || !size || size.length !== 2 || !/^\d+(?:\.\d+)?$/.test(size[1]) || !(+size[1] > 0 && Number.isFinite(+size[1]))) throw Error('请设置一个正数作为河牌下注的底池百分比。');
  return { groups, size: +size[1] };
}

export function riverLine(source) {
  const { groups, size } = readSettings(source);
  const controls = h('div', { class: 'river-line-inputs' });
  const body = h('tbody');
  const feedback = h('p', { class: 'tb-feedback', 'aria-live': 'polite' });
  for (const [i, key, name] of [[0, 'check', '转牌空气随后过牌'], [0, 'bet', '河牌空气诈唬'], [1, 'bet', '河牌中对薄取值']]) {
    const group = groups[i];
    const pct = h('output', {}, group[key] + '%');
    const input = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(group[key]),
      'aria-label': name, oninput: () => {
        group[key] = +input.value;
        pct.textContent = input.value + '%';
        update();
      } });
    controls.append(h('label', {}, h('span', {}, name), pct, input));
  }
  function update() {
    const bets = [];
    body.replaceChildren(...groups.map(({ label, count, check, bet }) => {
      const remaining = count * check / 100;
      const betting = remaining * bet / 100;
      bets.push(betting);
      return h('tr', {}, h('th', { scope: 'row' }, label), ...[count, remaining, betting].map((n) => h('td', {}, format(n))));
    }));
    const total = bets.reduce((a, b) => a + b, 0);
    if (!total) {
      feedback.textContent = '这个设定下河牌无人下注，抓诈者不会面对决定。';
      return;
    }
    const share = bets[0] / total;
    const need = size / (100 + 2 * size);
    const ev = share * (100 + 2 * size) - size;
    const value = h('strong', { class: ev > 0 ? 'act-win' : ev < 0 ? 'act-loss' : '' }, (ev > 0 ? '+' : '') + ev.toFixed(2));
    feedback.replaceChildren('河牌下注范围中，诈唬占 ' + (share * 100).toFixed(1) + '%。面对 B' + size + ' 需赢 ' +
      (need * 100).toFixed(1) + '%；纯抓诈牌跟注 EV 为 ', value, '（弃牌为 0）。');
  }
  update();
  const table = h('table', {}, h('thead', {}, h('tr', {},
    ...['等效组合', '到转牌', '随后过牌', '河牌下注'].map((name) => h('th', { scope: 'col' }, name)))), body);
  return h('fieldset', { class: 'tb-experiment river-line' }, h('legend', {}, '跟踪转牌过牌后的范围'), controls, table, feedback);
}
