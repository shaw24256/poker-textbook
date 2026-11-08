import { loadDoc } from '../lib/docs.mjs';
export const loadToc = () => loadDoc('资料/胡萝卜扑克学校/目录.md').then(d => [...d.body.matchAll(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*$/gm)].filter(m => /^[一二三四五六七]$/.test(m[1])).map(m => ({key:`${m[1]}年级${m[2]}`,grade:m[1],no:m[2],title:m[3],page:m[4]})));
export const pageUrl = () => ''; export const openZoom = () => {};
