// 讲义里的花色按四色显示（♠ 黑、♥ 红、♦ 蓝、♣ 绿，和原书一致）：把文字里的 ♠♥♦♣ 各包进一个带颜色的 span。
export const suitClass = { '♠': 'hs-s', '♥': 'hs-h', '♦': 'hs-d', '♣': 'hs-c' };

// 一段文字切成 [{ text, suit? }]，花色单独一段。
export function splitSuits(text) {
  return String(text).split(/([♠♥♦♣])/).filter(Boolean).map((t) => (suitClass[t] ? { text: t, suit: suitClass[t] } : { text: t }));
}

// 给 root 里的所有文字上色（代码块里的不动）。
export function fourColorSuits(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (/[♠♥♦♣]/.test(n.nodeValue) && !n.parentElement.closest('code, pre, script, style, .hs-s, .hs-h, .hs-d, .hs-c')) hits.push(n);
  }
  for (const n of hits) {
    const frag = document.createDocumentFragment();
    for (const part of splitSuits(n.nodeValue)) {
      if (part.suit) {
        const s = document.createElement('span');
        s.className = part.suit;
        s.textContent = part.text;
        frag.append(s);
      } else frag.append(part.text);
    }
    n.replaceWith(frag);
  }
}
