import { renderTextIndex, renderTextChapter, renderTopic } from './assets/views/notes-textbook.mjs';
import { h } from './assets/lib/dom.mjs';
import { mountNav, mountToc } from './assets/lib/toc.mjs';
import { mountSkinPicker } from './assets/lib/skin.mjs';
import { installKeys, setPageKeys } from './assets/lib/keys.mjs';
import { autoSort } from './assets/lib/sortable.mjs';
import { installPublicApi } from './public-api.mjs';

const snapshot=await fetch('./textbook.json').then(r=>{if(!r.ok)throw Error('教材未载入');return r.json();});
installPublicApi(snapshot);
const view=document.getElementById('view');
const search=document.getElementById('search');
let cleanup,sequence=0;
autoSort(view);
mountSkinPicker(document.getElementById('skin'));
installKeys([{id:'notes/text',label:'教材'}]);

// 原书页码保留为文字出处；扫描阅读、私人区域和不在导出范围内的链接不开放。
function removeExcludedLinks(root) {
  const links=[...(root.matches?.('a')?[root]:[]),...(root.querySelectorAll?.('a') || [])];
  for(const link of links) {
    const raw=link.getAttribute('href') || '';
    const allowed=raw.startsWith('#/notes/text') || raw.startsWith('#/notes/topic/') || raw.startsWith('#/search') || /^https?:|^mailto:/.test(raw);
    if(allowed || !raw.startsWith('#/'))continue;
    const reference=h('span',{class:link.className+' public-source-ref',textContent:link.textContent});
    link.replaceWith(reference);
  }
}
new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)removeExcludedLinks(node);
}).observe(document.body,{childList:true,subtree:true});

async function renderSearch(root,query) {
  const term=(query.q || '').trim().toLowerCase();
  const docs=await fetch('/api/docs?body=1').then(r=>r.json());
  const included=new Map(snapshot.chapters.map(c=>[c.text,c]));
  const hits=term ? docs.filter(d=>included.has(d.path) && `${included.get(d.path).name}\n${d.body}`.toLowerCase().includes(term)) : [];
  const page=h('section',{class:'reader public-search'},h('h1',{textContent:term?`搜索“${query.q}”`:'搜索教材'}));
  if(!hits.length)page.append(h('p',{class:'muted',textContent:term?'没有匹配的章节。':'输入关键词查找教材章节。'}));
  for(const doc of hits) {
    const c=included.get(doc.path),at=doc.body.toLowerCase().indexOf(term);
    page.append(h('a',{href:`#/notes/text/${encodeURIComponent(c.id)}?q=${encodeURIComponent(query.q)}`},
      h('strong',{textContent:`${c.grade}年级 ${c.no} · ${c.name}`}),
      h('p',{textContent:doc.body.slice(Math.max(0,at-45),Math.max(0,at-45)+150)})));
  }
  root.append(page);
}
async function route() {
  if(cleanup)cleanup();cleanup=null;setPageKeys(null);
  const turn=++sequence;
  const [raw,qs]=location.hash.replace(/^#\/?/,'').split('?');
  const id=raw || 'notes/text';
  const query=Object.fromEntries(new URLSearchParams(qs));
  if(document.activeElement!==search)search.value=id==='search' ? query.q || '' : '';
  const toc=h('nav',{class:'toc','aria-label':'教材目录'}),content=h('div',{class:'content'});
  view.replaceChildren(h('div',{class:'layout'},toc,content));
  window.scrollTo(0,0);
  try {
    let rendered;
    const match=id.match(/^notes\/text\/(.+)$/),topic=id.match(/^notes\/topic\/(\d+)$/);
    if(match)rendered=await renderTextChapter(content,decodeURIComponent(match[1]),query);
    else if(topic)rendered=await renderTopic(content,topic[1],query);
    else if(id==='search')await renderSearch(content,query);
    else await renderTextIndex(content);
    if(turn!==sequence)return;
    if(rendered?.nav)mountNav(toc,rendered.nav);else mountToc(toc,content);
    removeExcludedLinks(content);
    document.title=`${content.querySelector('h1')?.textContent || '胡萝卜教材'} · Ocean Wave`;
    cleanup=rendered?.onMounted?.();
  } catch(error) {if(turn===sequence)content.append(h('p',{class:'error',textContent:`读取失败：${error.message}`}));}
}
let timer;
search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{location.hash=`#/search?q=${encodeURIComponent(search.value.trim())}`;},250);});
search.addEventListener('keydown',e=>{if(e.key==='Escape')search.blur();});
addEventListener('keydown',e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)){e.preventDefault();search.focus();}});
addEventListener('hashchange',route);
await route();
