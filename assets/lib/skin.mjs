// 皮肤（配色）：配色 id 和 MTT 工具台（MTT工具台/web/lib/theme.mjs）的主题一致；选择存在这台浏览器的 localStorage（ow-skin-v1，同源的 /mtt 工具台也读它），不进数据文件。
// 默认“跟随系统”（浅色 / 深色自动切换）；其余六套固定配色，样式在 styles.css 的 :root[data-skin=…]。红色走运、蓝色倒霉等数据颜色不跟皮肤变。
export const SKINS = [
  { id: 'auto', name: '跟随系统', bg: '#f9f9f7', ac: '#1a1a19' },
  { id: 'felt', name: '牌桌·金', bg: '#262626', ac: '#dfa95a' },
  { id: 'teal', name: '薄荷·深青', bg: '#1d3a3e', ac: '#5fd6b3' },
  { id: 'slate', name: '冷灰·蓝', bg: '#222c3a', ac: '#4c8dff' },
  { id: 'paper', name: '纸面·朱红', bg: '#f3f0e8', ac: '#b3261e' },
  { id: 'mist', name: '雾白·蓝', bg: '#eef2f7', ac: '#2458d6' },
  { id: 'sage', name: '浅绿·墨绿', bg: '#eef2ea', ac: '#1f6b4f' },
];
export const DEFAULT_SKIN = 'auto';
export const SKIN_KEY = 'ow-public-skin-v1';

export const skinById = (id) => SKINS.find((s) => s.id === id) ?? SKINS[0];

// 存储可能不存在或者抛错（隐私窗口、屏蔽站点数据），读写都包 try。
export function loadSkin(storage) {
  try {
    const id = storage()?.getItem(SKIN_KEY);
    return SKINS.some((s) => s.id === id) ? id : DEFAULT_SKIN;
  } catch { return DEFAULT_SKIN; }
}

export function saveSkin(storage, id) {
  try { storage()?.setItem(SKIN_KEY, skinById(id).id); } catch {}
}

export function applySkin(root, id) {
  if (id === DEFAULT_SKIN) delete root.dataset.skin;
  else root.dataset.skin = skinById(id).id;
}

// 顶栏按钮 + 弹出的“外观”对话框（一排圆形色板，点一个就换）。
export function mountSkinPicker(button, doc = document, storage = () => localStorage) {
  const dialog = doc.createElement('dialog');
  dialog.className = 'skin-dialog';
  dialog.innerHTML = '<form method="dialog"><div class="skin-head"><h2>外观</h2><button class="btn">关闭</button></div></form><div class="skin-list" role="group" aria-label="配色"></div>';
  const list = dialog.querySelector('.skin-list');
  const mark = (id) => { for (const b of list.children) b.setAttribute('aria-pressed', String(b.dataset.skin === id)); };
  for (const s of SKINS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.skin = s.id;
    b.title = s.name;
    b.setAttribute('aria-label', s.name);
    b.innerHTML = `<i style="--sw-bg: ${s.bg}; --sw-ac: ${s.ac}"></i><span>${s.name}</span>`;
    b.addEventListener('click', () => { applySkin(doc.documentElement, s.id); saveSkin(storage, s.id); mark(s.id); });
    list.append(b);
  }
  doc.body.append(dialog);
  button.addEventListener('click', () => { mark(loadSkin(storage)); dialog.showModal(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
