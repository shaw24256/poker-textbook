// 浏览器里加载 工具/range.mjs 用的空壳：它顶部 import 了 node:fs 等（命令行功能用），网页只用它的解析和统计函数。
// index.html 的 import map 把 node:* 指到这里。
const none = () => '';
export const readFileSync = none, writeFileSync = none, mkdirSync = none;
export const dirname = none, join = none, resolve = none;
export const fileURLToPath = none, pathToFileURL = () => ({ href: '' });
export const spawnSync = none;
