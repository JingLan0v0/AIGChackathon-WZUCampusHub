/* ==========================================================
   路演稿自查：用 Edge 打开生成的单文件幻灯片，按「点击」推进到指定状态后截图
   ----------------------------------------------------------
   为什么这么做：幻灯片的字号/留白/换行在真实浏览器里才看得出来，
   jsdom 里看不出「字挤出框」这种问题。彩排前跑一遍最稳。
   用法：node roadshow/tools/verify-deck.js
   ========================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const DECK = path.resolve(__dirname, '..', '校园百事通-路演.html');
const OUT = path.resolve(__dirname, '..', 'deck-check');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let s = '';
      res.on('data', d => (s += d));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'edge-deck-check'),
    '--window-size=1200,700', '--allow-file-access-from-files', 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40 && !ver; i++) {
    try { ver = await getJSON('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) { await sleep(500); }
  }
  if (!ver) { console.error('Edge 没起来'); edge.kill(); process.exit(1); }
  const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const waiting = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? w({ __error: m.error.message }) : w(m.result);
    }
  };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Page.enable'); await send('Runtime.enable');

  const base = 'file:///' + DECK.split(path.sep).map(encodeURIComponent).join('/').replace('%3A', ':');
  console.log('打开：' + base);

  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  }
  async function shot(name, clicks) {
    for (let i = 0; i < (clicks || 0); i++) { await ev('document.body.click()'); await sleep(120); }
    await sleep(500);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  ✓ ' + name + '.png');
  }
  async function open(n, clicks) {
    await send('Page.navigate', { url: base + '?p=' + n });
    await sleep(1100);
  }

  /* 每页都过一遍：点满片段检查有无溢出，只存几张关键的 */
  await open(1, 0); await shot('p01-cover', 2);
  await open(2, 0); await shot('p02-pain', 6);
  await open(4, 0); await shot('p04-answer', 3);
  await open(5, 0); await shot('p05-nine', 8);
  await open(6, 0); await shot('p06-nl', 5);
  await open(9, 0); await shot('p09-notice', 4);
  await open(10, 0); await shot('p10-ai', 8);
  await open(12, 0); await shot('p12-edu', 3);
  await open(14, 0); await shot('p14-end', 3);

  /* 逐页检查是否有内容溢出：点满本页片段后量当前页（点多一次会翻页，所以精确点 n 次） */
  const overflow = [];
  for (let p = 1; p <= 14; p++) {
    await open(p, 0);
    await ev('(function(){var s=document.querySelectorAll(".slide")[' + (p - 1) + '];' +
      'var f=s.querySelectorAll(".frag");for(var i=0;i<f.length;i++)f[i].classList.add("on");return f.length})()');
    await sleep(260);
    const info = await ev('(function(){var s=document.querySelectorAll(".slide")[' + (p - 1) + '];' +
      'return {of:s.scrollHeight-s.clientHeight,ch:s.clientHeight}})()');
    if (info.of > 6) {
      const detail = await ev('(function(){var s=document.querySelectorAll(".slide")[' + (p - 1) + '];' +
        'return Array.prototype.map.call(s.children,function(c){return (c.className||c.tagName).slice(0,18)+":"+c.offsetHeight}).join(" | ")})()');
      overflow.push('第 ' + p + ' 页溢出 ' + info.of + 'px → ' + detail);
    }
  }
  console.log(overflow.length ? '⚠ 溢出：' + overflow.join('；') : '✓ 14 页全部无溢出');

  ws.close(); edge.kill();
  console.log('截图目录：' + OUT);
  process.exit(0);
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
