// 表格点表头排序：给页面里所有普通表格统一加上（app.mjs 里 autoSort 监听页面变化）。
// 已经有自己排序按钮的表（thead 里有 button.sort，比如逐场列表）、没有表头的、少于 3 行的、标了 data-nosort 的不动。
// 规则：点一下降序（数字、金额）或升序（文字、日期），再点反过来，第三下恢复原来的顺序；空值（— 或空）永远排最后；
// 表里的“合计”行（tr.total、tfoot）不动。有日分组行（tr.day-row，session 的比赛表）的表，表上方有个小切换：
// “全表”（整张表一起排，分组行先藏起来，开赛时间那一格补上日期）和“每天内”（只在每天里面排，天与天的顺序不动）。

const SYMBOLS = /[$¥฿€%×,\s]|BB|个买入|次|场|人/g;

// 单元格文字 → 排序用的值：数字（带 $ ¥ % × 千分位、− 号）、其他文字、空值（null）。
export function cellValue(text) {
  const t = String(text ?? '').trim();
  if (!t || /^[—–-]$/.test(t)) return null;
  const n = t.replace(/[−–]/g, '-').replace(/^\+/, '').replace(SYMBOLS, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  return t;
}

// 比较两个值：数字在前、文字在后（文字之间 localeCompare），空值排最后（不受升降序影响）。
export function compareValues(a, b, desc) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const na = typeof a === 'number';
  const nb = typeof b === 'number';
  let c;
  if (na && nb) c = a - b;
  else if (na !== nb) c = na ? -1 : 1;
  else c = a.localeCompare(b, 'zh-CN', { numeric: true });
  return desc ? -c : c;
}

// 对 items（{ value, row }）排序，返回新数组；稳定排序。
export const sortItems = (items, desc) => items.map((x, i) => [x, i]).sort((p, q) => compareValues(p[0].value, q[0].value, desc) || p[1] - q[1]).map(([x]) => x);

const state = new WeakMap();

function bodyRows(tbody) {
  return [...tbody.rows];
}

const dayLabel = (row) => (row.cells[0]?.textContent.match(/\d+\/\d+/) ?? [''])[0];

const SCOPE_KEY = 'ow-sort-scope-v1';
const loadScope = () => { try { return localStorage.getItem(SCOPE_KEY) === 'day' ? 'day' : 'all'; } catch { return 'all'; } };
const saveScope = (v) => { try { localStorage.setItem(SCOPE_KEY, v); } catch {} };

// 回到原来的顺序：取消藏起来的分组行、去掉开赛时间前补的日期。
function restore(table, st) {
  const tbody = table.tBodies[0];
  for (const r of st.orig) {
    if (r.classList.contains('day-row')) r.hidden = false;
    else if (r.cells[0]?.dataset.time) { r.cells[0].textContent = r.cells[0].dataset.time; delete r.cells[0].dataset.time; }
  }
  tbody.append(...st.orig);
  st.rows = bodyRows(tbody);
}

function apply(table, st, col, desc) {
  const tbody = table.tBodies[0];
  restore(table, st);   // 先还原成原来的顺序（分组行、日期），再按当前范围排
  const rows = [...st.orig];
  const fixed = rows.filter((r) => r.classList.contains('total'));
  const key = (row) => ({ row, value: cellValue(row.cells[col]?.dataset.sort ?? row.cells[col]?.textContent) });
  const hasDays = rows.some((r) => r.classList.contains('day-row'));
  let out;
  if (hasDays && st.scope === 'day') {
    // 每天内：天与天的顺序和分组行不动，每天里面排
    const groups = [];
    let cur = null;
    for (const r of rows) {
      if (r.classList.contains('total')) continue;
      if (r.classList.contains('day-row')) { cur = { head: r, rows: [] }; groups.push(cur); continue; }
      if (!cur) { cur = { head: null, rows: [] }; groups.push(cur); }
      cur.rows.push(r);
    }
    out = [...fixed, ...groups.flatMap((g) => [...(g.head ? [g.head] : []), ...sortItems(g.rows.map(key), desc).map((x) => x.row)])];
  } else {
    // 全表：分组行藏起来，每行开赛时间前补上它所在那天的日期
    let day = '';
    const dayRows = [];
    const items = [];
    for (const r of rows) {
      if (r.classList.contains('total')) continue;
      if (r.classList.contains('day-row')) { day = dayLabel(r); r.hidden = true; dayRows.push(r); continue; }
      if (hasDays && r.cells[0]) { r.cells[0].dataset.time = r.cells[0].textContent; r.cells[0].textContent = `${day} ${r.cells[0].textContent}`.trim(); }
      items.push(r);
    }
    out = [...fixed, ...dayRows, ...sortItems(items.map(key), desc).map((x) => x.row)];
  }
  tbody.append(...out);
  st.rows = bodyRows(tbody);
}

function mark(table, col, desc) {
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    th.setAttribute('aria-sort', i === col ? (desc ? 'descending' : 'ascending') : 'none');
    th.dataset.arrow = i === col ? (desc ? ' ↓' : ' ↑') : '';
  });
}

// 有日分组行的表上方的小切换：排序范围 全表 / 每天内。
function scopeBar(table, st) {
  const wrap = table.closest('.table-wrap') ?? table;
  if (wrap.previousElementSibling?.classList.contains('sort-scope')) wrap.previousElementSibling.remove();
  const bar = document.createElement('div');
  bar.className = 'sort-scope';
  bar.innerHTML = '<span class="muted">点表头排序：</span><div class="segmented" role="group" aria-label="排序范围"><button type="button" data-v="all">全表</button><button type="button" data-v="day">每天内</button></div>';
  const paint = () => { for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === st.scope)); };
  bar.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v || v === st.scope) return;
    st.scope = v;
    saveScope(v);
    paint();
    if (st.col !== null) apply(table, st, st.col, st.desc);
  });
  paint();
  wrap.before(bar);
}

export function enhance(table) {
  if (state.has(table) || !table.tHead?.rows[0] || table.dataset.nosort !== undefined) return;
  if (table.tHead.querySelector('button.sort')) return;
  const tbody = table.tBodies[0];
  if (!tbody || tbody.rows.length < 3) return;
  const st = { col: null, desc: false, rows: null, orig: null, cycle: 0, scope: loadScope() };
  state.set(table, st);
  table.classList.add('sortable');
  if (tbody.querySelector('tr.day-row')) scopeBar(table, st);
  [...table.tHead.rows[0].cells].forEach((th, col) => {
    th.classList.add('sort-th');
    th.tabIndex = 0;
    const go = () => {
      if (st.col === col && st.cycle >= 2) {   // 第三下：恢复原来的顺序
        restore(table, st);
        st.col = null;
        st.cycle = 0;
        mark(table, -1, false);
        return;
      }
      if (st.col === null) st.orig = bodyRows(tbody);
      const numeric = [...tbody.rows].slice(0, 6).some((r) => typeof cellValue(r.cells[col]?.dataset.sort ?? r.cells[col]?.textContent) === 'number');
      st.desc = st.col === col ? !st.desc : numeric;   // 数字先降序，文字和日期先升序
      st.cycle = st.col === col ? st.cycle + 1 : 1;
      st.col = col;
      apply(table, st, col, st.desc);
      mark(table, col, st.desc);
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// 表被页面重新渲染（换了行）时，旧的排序箭头作废。
function refresh(table) {
  const st = state.get(table);
  if (!st || st.col === null) return;
  const rows = bodyRows(table.tBodies[0]);
  if (rows.length === st.rows.length && rows.every((r, i) => r === st.rows[i])) return;
  st.col = null;
  st.cycle = 0;
  if (table.tHead?.rows[0]) mark(table, -1, false);
}

// 页面重画表（比如筛选）时想保留排序：重画前 getSort(旧表)，新表放进页面后 setSort(新表, 刚才的结果)。
// getSort：表没加排序（行太少等）返回 undefined，没排过序返回 null，否则 { col, desc, cycle }。
export function getSort(table) {
  const st = table && state.get(table);
  return st ? (st.col === null ? null : { col: st.col, desc: st.desc, cycle: st.cycle }) : undefined;
}

export function setSort(table, sort) {
  enhance(table);
  const st = state.get(table);
  if (!st || !sort) return;
  st.orig = bodyRows(table.tBodies[0]);
  Object.assign(st, sort);
  apply(table, st, sort.col, sort.desc);
  mark(table, sort.col, sort.desc);
}

export function autoSort(root) {
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'TABLE') enhance(node);
    node.querySelectorAll?.('table').forEach(enhance);
  };
  scan(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach(scan);
      const table = m.target.closest?.('table');
      if (table) { enhance(table); refresh(table); }
    }
  }).observe(root, { childList: true, subtree: true });
}
