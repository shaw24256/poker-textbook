const STATE_KEY = 'ow-public-textbook-state-v1';
const json = (value, status=200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}});
export function installPublicApi(snapshot, storage=()=>localStorage) {
  const realFetch = globalThis.fetch.bind(globalThis);
  const read = () => {
    try {
      const value = JSON.parse(storage().getItem(STATE_KEY) || '{}');
      return {learned:value?.learned && typeof value.learned==='object' ? value.learned : {}, notes:value?.notes && typeof value.notes==='object' ? value.notes : {}};
    } catch { return {learned:{},notes:{}}; }
  };
  const save = state => storage().setItem(STATE_KEY, JSON.stringify(state));
  const ids = new Map(snapshot.chapters.map(c=>[c.text,c.id]));
  const documentOf = (doc, state) => ({...doc, fm:{learned:state.learned[ids.get(doc.path)] || ''}});
  const today = () => {
    const now=new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  };
  globalThis.fetch = async function(input, init={}) {
    const url = new URL(typeof input==='string' || input instanceof URL ? input : input.url, globalThis.location?.href || 'https://example.invalid/');
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method=(init.method || (typeof input==='object' && input.method) || 'GET').toUpperCase();
    const state=read();
    if(method==='GET') {
      if(url.pathname==='/api/handouts')return json(snapshot.chapters);
      if(url.pathname==='/api/doc') {
        const path=url.searchParams.get('path');
        const doc=Object.hasOwn(snapshot.docs,path) ? snapshot.docs[path] : null;
        return doc ? json(documentOf(doc,state)) : json({error:'分享版没有这份文件'},404);
      }
      if(url.pathname==='/api/docs')return json(Object.values(snapshot.docs).map(doc=>{
        const value=documentOf(doc,state);
        if(url.searchParams.get('body')!=='1')delete value.body;
        return value;
      }));
      if(url.pathname==='/api/annotations') {
        const path=url.searchParams.get('path');
        return Object.hasOwn(snapshot.docs,path) ? json({annotations:state.notes[path] || []}) : json({error:'不在分享范围'},404);
      }
      return json({error:'分享版不提供此接口'},404);
    }
    if(method!=='POST')return json({error:'分享版只读'},403);
    let body;
    try {body=JSON.parse(init.body);}catch{return json({error:'请求格式不正确'},400);}
    if(url.pathname==='/api/textbook/learned') {
      if(!snapshot.chapters.some(c=>c.id===body.id))return json({error:'没有这一章'},404);
      const date=body.marked ? today() : '';
      if(date)state.learned[body.id]=date;else delete state.learned[body.id];
      try{save(state);}catch{return json({error:'浏览器未允许保存，请允许站点存储后重试。'},507);}
      return json({learned:date});
    }
    if(url.pathname==='/api/annotations') {
      if(!Object.hasOwn(snapshot.docs,body.path))return json({error:'不在分享范围'},404);
      const notes=state.notes[body.path] ||= [];
      let note=notes.find(n=>n.id===body.id);
      if(body.op==='add') {
        note={id:globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,quote:body.quote || '',prefix:body.prefix || '',suffix:body.suffix || '',text:body.text || '',at:today()};
        notes.push(note);
      } else if(!note)return json({error:'没有这条批注'},404);
      else if(body.op==='edit'){note.text=body.text;note.editedAt=today();}
      else if(body.op==='delete')note.deletedAt=today();
      else if(body.op==='restore')delete note.deletedAt;
      else return json({error:'不支持这个操作'},400);
      try{save(state);}catch{return json({error:'浏览器未允许保存批注。'},507);}
      return json(note);
    }
    return json({error:'分享版不能修改教材正文'},403);
  };
  return ()=>{globalThis.fetch=realFetch;};
}
