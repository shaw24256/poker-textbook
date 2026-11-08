// 教材里的预测题与河牌尺度实验。组件状态只留在当前页。
import { mountTextbookActivities } from './textbook-activities.mjs';
import { priceCurve } from './textbook-reference.mjs';
import { riverLine } from './river-line.mjs';
import { pairedFlop } from './paired-flop.mjs';
import { evTree } from './ev-tree-view.mjs';
import { pageUrl, openZoom } from '../views/notes-handouts.mjs';
import { fourColorSuits } from './suits.mjs';
import { h } from './dom.mjs';

function prediction(source) {
  const [prompt, ...lines] = source.trim().split('\n');
  const choices = lines.map((line) => line.split(' | '));
  if (!prompt || choices.length < 2 || choices.some((parts) => parts.length !== 2 || parts.some((s) => !s.trim()))) return null;
  // 带 * 的选项是书例答案。没有标答案的旧题仍可逐项探索。
  const marked = choices.filter(([label]) => label.startsWith('* '));
  if (marked.length > 1) return null;
  const answer = choices.indexOf(marked[0]);
  const labels = choices.map(([label]) => label.replace(/^\* /, ''));
  const result = h('div', { class: 'tb-feedback', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const buttons = choices.map(([, explanation], index) => h('button', {
    type: 'button', class: 'btn', 'aria-pressed': 'false', textContent: labels[index],
    onclick: () => {
      buttons.forEach((button, i) => {
        button.setAttribute('aria-pressed', String(i === index));
        if (answer < 0) return;
        const state = i === answer ? 'correct' : i === index ? 'wrong' : '';
        button.dataset.answer = state;
        const mark = state === 'correct' ? '✓ ' : state === 'wrong' ? '× ' : '';
        button.textContent = mark + labels[i];
      });
      for (const button of buttons) fourColorSuits(button);
      if (answer < 0) { result.textContent = explanation; fourColorSuits(result); return; }
      const verdict = index === answer ? '答对了。' : '答错了。';
      result.replaceChildren(h('strong', { textContent: verdict + '本题书例的答案是「' + labels[answer] + '」。' }),
        h('div', { textContent: explanation }));
      fourColorSuits(result);
    },
  }));
  const card = h('fieldset', { class: 'tb-experiment' }, h('legend', { textContent: prompt }),
    h('div', { class: 'tb-choices' }, ...buttons), result);
  fourColorSuits(card);
  return card;
}

function riverSizing(source) {
  const lines = (source.trim() || '底池 | 100\n下注 | 50 | 80%\n下注 | 150 | 85%').split(/\n/);
  let pot;
  const sizes = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split('|').map((f) => f.trim());
    const amount = Number(fields[1]);
    if (!(amount > 0 && Number.isFinite(amount))) throw Error('底池和下注必须为正数');
    if (fields[0] === '底池' && fields.length === 2 && pot === undefined) pot = amount;
    else if (fields[0] === '下注' && fields.length === 3 && /^\d+%$/.test(fields[2]) && parseInt(fields[2], 10) <= 100) {
      sizes.push({ amount, fold:parseInt(fields[2], 10) });
    } else throw Error('用“底池 | 数额”和“下注 | 数额 | 弃牌率%”设定河牌实验');
  }
  if (!pot || !sizes.length) throw Error('河牌实验需要底池和至少一种下注尺度');
  const hand = h('select', { 'aria-label': '河牌手牌' },
    h('option', { value: 'air', textContent: '纯空气' }), h('option', { value: 'nuts', textContent: '坚果' }));
  const feedback = h('p', { class: 'tb-feedback', 'aria-live': 'polite' });
  const bets = sizes.map(({ amount, fold }) => {
    const label = '下 ' + amount;
    const pct = h('span');
    const slider = h('input', { type: 'range', min: '0', max: '100', value: String(fold), 'aria-label': label + ' 时的弃牌率' });
    const ev = h('strong');
    const row = h('div', { class: 'tb-price-row' }, h('b', { textContent: label }), pct, slider, ev);
    return { amount, label, pct, slider, ev, row };
  });
  function update() {
    const nuts = hand.value === 'nuts';
    const check = nuts ? pot : 0;
    const options = [{ label: '过牌', value: check }];
    for (const bet of bets) {
      const f = Number(bet.slider.value);
      const called = nuts ? pot + bet.amount : -bet.amount;
      const value = (pot * f + called * (100 - f)) / 100;
      bet.pct.textContent = '对手弃 ' + f + '%';
      bet.ev.textContent = 'EV ' + value.toFixed(1);
      bet.ev.className = value > 0 ? 'pos' : value < 0 ? 'neg' : '';
      options.push({ label: bet.label, value });
    }
    const best = Math.max(...options.map((o) => o.value));
    const winners = options.filter((o) => o.value === best).map((o) => o.label);
    feedback.textContent = '过牌 EV ' + check + '。' + winners.join('、') + (winners.length > 1 ? ' 并列最优' : ' 最优') +
      '，比过牌多赚 ' + (best - check).toFixed(1) + '。';
  }
  hand.onchange = update;
  bets.forEach((bet) => { bet.slider.oninput = update; });
  update();
  return h('fieldset', { class: 'tb-experiment' }, h('legend', { textContent: '河牌底池 ' + pot }),
    h('label', {}, '我的手牌　', hand), ...bets.map((bet) => bet.row), feedback);
}

// 坐标以 900px 宽预览图为基准，放大时仍读整张原页。
function bookFigure(source) {
  const [ref, caption] = source.trim().split('\n');
  const page = ref.split(/\s+/)[1];
  return h('figure', {class:'public-figure'}, h('figcaption', {textContent:caption + ' · 原书 p' + page}));
}

export function mountTextbookInteractions(el, chapters) {
  mountTextbookActivities(el, chapters);
  for (const code of el.querySelectorAll('pre > code.language-price')) code.parentElement.replaceWith(priceCurve(code.textContent));
  for (const [kind, build] of [['paired-flop', pairedFlop], ['river-sizing', riverSizing], ['river-line', riverLine]]) {
    for (const code of el.querySelectorAll('pre > code.language-' + kind)) {
      try { code.parentElement.replaceWith(build(code.textContent)); }
      catch (error) { code.parentElement.replaceWith(h('p', { class:'tb-bad', textContent:error.message })); }
    }
  }
  // 行动 EV 对比树（设计见 网站/设计_EV对比树和我的手牌.md 第一节）；出处要链到原书页，所以要 chapters
  for (const code of el.querySelectorAll('pre > code.language-ev-tree')) {
    try { code.parentElement.replaceWith(evTree(code.textContent, chapters)); }
    catch (error) { code.parentElement.replaceWith(h('p', { class:'tb-bad', textContent:error.message })); }
  }
  for (const code of el.querySelectorAll('pre > code.language-book-figure')) {
    const figure = bookFigure(code.textContent, chapters);
    if (figure) code.parentElement.replaceWith(figure);
  }
  for (const code of el.querySelectorAll('pre > code.language-predict')) {
    const card = prediction(code.textContent);
    if (card) code.parentElement.replaceWith(card);
  }
}
