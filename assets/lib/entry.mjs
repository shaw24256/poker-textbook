// 按进场时间划分 session（用户 2026-10-18 定，规则全文在 记录/session/流程.md）：
// - 一场比赛属于哪个 session / 哪个打牌日，看用户的进场时间（手牌里 Hero 在这场的第一手牌时间，账本 entry_time 列），
//   账本没有这列或为空就退回开赛时间 start；
// - 两天赛：Day 2（stage = late）的名次和奖金算回晋级的那个 Day 1 所在的 session（账本 day1_id 指向它）；没晋级的 Day 1 留在自己的 session；
// - 晋级 Day 2 / Stage 2 算进圈：见 stats.mjs 的 isCounted / isItm（战绩看板也用）。
// 只用在记录里的 session / 时间线。
const norm = (t) => String(t).replace('/', '-').replace('T', ' ');
export const entryOf = (r) => norm(r.entry_time || r.start);

const cache = new WeakMap();

// 给每条记录加 entry（归属用的进场时间；Day 2 用它的 Day 1 的）；返回新数组，顺序不变，同一个 rows 只算一次。
export function withEntry(rows) {
  if (cache.has(rows)) return cache.get(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = rows.map((r) => {
    const d1 = r.stage === 'late' && r.day1_id ? byId.get(r.day1_id) : null;
    return { ...r, entry: entryOf(d1 ?? r) };
  });
  cache.set(rows, out);
  return out;
}

// 比赛归哪一天（打牌日）：按进场时间往前推 6 小时（和一周从周一 06:00 开始一致），凌晨进场的算前一天晚上。传 r.entry（或 entryOf(r)）。
export function playDay(start) {
  const d = new Date(`${start.slice(0, 16).replace(' ', 'T')}:00Z`);
  d.setUTCHours(d.getUTCHours() - 6);
  return d.toISOString().slice(0, 10);
}

// 一条记录归哪个打牌日：用加载时挂上的 entry（Day 2 是它的 Day 1 的进场时间），没有就用它自己的进场时间。
export const dayOf = (r) => playDay(r.entry ?? entryOf(r));

// 现在是哪个打牌日（本地时间，凌晨 6 点前算前一天）。
export function playToday() {
  const d = new Date();
  return playDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

// 一个 session 实际打牌的时间：第一场进场 → 最后一场淘汰（账本的 entry_time / exit_time，精确到分钟，用户 2026-10-18 定）。
// 已绑定 Day 1 的后续阶段不算（它们的时间在几天以后）；任何一行没有 exit_time 就不给（避免把还没淘汰的比赛当成已结束），返回 null。
export function playSpan(rows) {
  const own = rows.filter((r) => !(r.stage === 'late' && r.day1_id));
  if (!own.length || own.some((r) => !r.exit_time)) return null;
  const first = own.map(entryOf).sort()[0];
  const last = own.map((r) => norm(r.exit_time)).sort().at(-1);
  return [first, last];
}

// 两个时间（YYYY-MM-DD HH:MM[:SS]）之间隔了多久，写成“2 小时 25 分”“45 分”（四舍五入到分钟）。
export function durationText(from, to) {
  const t = (x) => new Date(`${x.slice(0, 16).replace(' ', 'T')}:00Z`).getTime();
  const min = Math.max(0, Math.round((t(to) - t(from)) / 6e4));
  const h = Math.floor(min / 60);
  return h ? `${h} 小时${min % 60 ? ` ${min % 60} 分` : ''}` : `${min} 分`;
}
