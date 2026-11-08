// 内容版本放在URL中；已读内容可直接使用本机缓存，存储不可用时仍可在线阅读。
export async function loadPublicJSON(path, options={}) {
  const {
    timeoutMs=12000,
    fetchImpl=globalThis.fetch.bind(globalThis),
    cacheStorage=globalThis.caches,
    baseURL=globalThis.document?.baseURI || 'https://example.invalid/',
  }=options;
  const url=new URL(path,baseURL).href;
  let cache;
  try {
    cache=await cacheStorage?.open('ow-public-textbook-content-v1');
    const cached=await cache?.match(url);
    if(cached){const value=await cached.json();if(value && typeof value==='object')return value;}
  } catch { /* 缓存受限或损坏时继续从网络读取。 */ }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(url,{signal:controller.signal});
    if(!response.ok)throw Error(`教材数据暂时不可用（${response.status}）`);
    const value=await response.clone().json();
    if(!value || typeof value!=='object')throw Error('教材数据格式不正确');
    if(cache)void cache.put(url,response).then(()=>{
      if(new URL(url).pathname.endsWith('/catalog.json')){
        try{globalThis.localStorage?.setItem('ow-public-textbook-catalog-cache',url);}catch{}
      }
    }).catch(()=>{});
    return value;
  } catch(error) {
    if(controller.signal.aborted)throw Error('连接超时，请重新加载；已读过的内容可使用本机缓存。');
    throw error;
  } finally {clearTimeout(timer);}
}
