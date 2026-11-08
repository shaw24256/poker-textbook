// 构建脚本和页面共用同一份题目解析，范围变化后须重新穷举。
const RANKS = 'AKQJT98765432';
const classPattern = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/;

function range(source) {
  const hands = source.split(/[,，\s]+/).filter(Boolean);
  if (!hands.length || new Set(hands).size !== hands.length) throw Error('请列出不重复的手牌类');
  for (const hand of hands) {
    const m = classPattern.exec(hand);
    if (!m || (m[1] === m[2] ? m[3] : !m[3] || RANKS.indexOf(m[1]) > RANKS.indexOf(m[2]))) {
      throw Error('请按 AA、AKs、AKo 的格式写手牌类：' + hand);
    }
  }
  return hands;
}

export function parseFlopSettings(source) {
  const boards = [], sides = [], extras = [], notes = new Map();
  for (const line of source.trim().split(/\n/)) {
    if (!line.trim()) continue;
    const fields = line.split('|').map((s) => s.trim());
    if (fields.length > 3) throw Error('每行最多三项：' + line);
    const [key, value, more] = fields;
    if (key === '翻牌' && value && more === undefined) {
      const cards = value.replace(/\s/g, '').match(/[2-9TJQKA][♠♥♦♣]/g) || [];
      if (cards.length !== 3 || new Set(cards).size !== 3 || cards.join('') !== value.replace(/\s/g, '')) throw Error('翻牌需要三张不同的牌');
      boards.push(cards);
    } else if ((key === '范围' || key === '额外') && value && more) {
      (key === '范围' ? sides : extras).push({ label:value, hands:range(more) });
    } else if (key === '解读' && /^\d+$/.test(value) && more) {
      notes.set(Number(value), more);
    } else throw Error('无法识别配对翻牌参数：' + line);
  }
  if (boards.length !== 2 || sides.length !== 2 || extras.length > 3) {
    throw Error('请写两行翻牌、两行范围，第二个范围最多可加三组额外手牌');
  }
  const pool = [sides[1], ...extras].flatMap((group) => group.hands);
  if (new Set(pool).size !== pool.length) throw Error('跟入范围与额外手牌之间有重复牌类');
  if ([...notes.keys()].some((mask) => mask >= 2 ** extras.length)) throw Error('解读没有对应的选项组合');
  return { boards, sides, extras, notes };
}

export function flopCacheKey({ boards, sides, extras }) {
  return JSON.stringify([boards, sides.map((g) => g.hands), extras.map((g) => g.hands)]);
}

// 旧教材里的空代码块沿用当时的 J22 / JJ2 示例。
export const legacyFlop = `翻牌 | J♠2♦2♣
翻牌 | J♠J♦2♣
范围 | 枪口 | AA KK QQ JJ TT 99 AKs AKo AQs AJs KQs KJs QJs JTs
范围 | 大盲 | TT 99 88 77 66 55 44 33 22 AQs AJs KQs KJs QJs JTs T9s 98s 87s 76s 65s 54s
额外 | 杂色 Jx | KJo QJo JTo
额外 | 同花 2x | A2s K2s Q2s 32s
解读 | 0 | 基础范围下，两副翻牌都是枪口在两项比较中领先。加入大盲的杂色 Jx，看看哪副牌面上的两项比较开始指向不同玩家。
解读 | 1 | 在 J–J–2 上，枪口平均权益仍然领先，大盲进入强牌区的比例却已超过枪口。新增的 Jx 给大盲带来三条，也让枪口的超对跌出 80% 门槛。
解读 | 2 | 同一批同花 2x，在 J–2–2 上变成三条，在 J–J–2 上主要是两对。在后一副牌面，大盲多跟进一些牌，反而稀释了自己强牌区的占比。
解读 | 3 | 两组牌都加入后，比较 J–J–2 上的两行数字：Jx 帮大盲增加强牌，2x 稀释了这些强牌的占比，大盲的强牌占比仍然领先。`;
