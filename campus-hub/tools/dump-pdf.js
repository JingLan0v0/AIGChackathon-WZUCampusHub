/* ==========================================================
   调试用：把一份 PDF 的文字碎片（含坐标）原样打印出来
   ----------------------------------------------------------
   排查「真实教务导出的课表认不出来」时，第一步就是看
   pdf.js 到底吐出来什么样的碎片。光看识别结果猜不出原因。

   用法：node tools/dump-pdf.js <某个.pdf> [输出.txt]
   ----------------------------------------------------------
   给了输出文件就写文件（Windows 下 shell 重定向会毁掉中文编码，
   所以宁可让 Node 自己写），不给就打屏。
   需要 NODE_PATH 指向装了 pdfjs-dist 的目录。
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

/* 打屏 / 写文件二合一 */
const OUT = process.argv[3] ? [] : null;
function say(s) {
  if (OUT) OUT.push(s);
  else console.log(s);
}

function loadPdfjs() {
  const tries = ['pdfjs-dist/legacy/build/pdf.js', 'pdfjs-dist/build/pdf.js', 'pdfjs-dist'];
  for (let i = 0; i < tries.length; i++) {
    try {
      const L = require(tries[i]);
      if (L && typeof L.getDocument === 'function') return L;
    } catch (e) { /* 试下一个 */ }
  }
  return null;
}

(function main() {
  const file = process.argv[2];
  if (!file) { console.log('用法：node tools/dump-pdf.js <file.pdf> [out.txt]'); process.exit(1); }
  const lib = loadPdfjs();
  if (!lib) { console.log('没找到 pdfjs-dist'); process.exit(1); }

  const data = new Uint8Array(fs.readFileSync(path.resolve(file)));
  /* 有些 PDF（比如教务系统 iText 导出的）用预定义 CMap（UniGB-UCS2-H），
     pdf.js 必须拿到 cmaps 目录才能解字，否则一个碎片都吐不出来。
     用环境变量 PDFJS_CMAP_URL 指过去，方便对比「给 / 不给」的差别。 */
  const opt = { data: data };
  if (process.env.PDFJS_CMAP_URL) {
    opt.cMapUrl = process.env.PDFJS_CMAP_URL;
    opt.cMapPacked = true;
    say('(已启用 cMapUrl = ' + process.env.PDFJS_CMAP_URL + ')');
  } else {
    say('(未提供 cMapUrl)');
  }
  if (process.env.PDFJS_STD_FONTS_URL) opt.standardFontDataUrl = process.env.PDFJS_STD_FONTS_URL;
  opt.verbosity = 1;

  lib.getDocument(opt).promise.then(function (doc) {
    say('页数: ' + doc.numPages);
    let chain = Promise.resolve();
    for (let p = 1; p <= doc.numPages; p++) {
      (function (pn) {
        let vp = null;
        chain = chain.then(function () { return doc.getPage(pn); }).then(function (page) {
          vp = page.getViewport({ scale: 1 });
          say('\n===== 第 ' + pn + ' 页  视口 ' + vp.width.toFixed(1) + ' x ' + vp.height.toFixed(1) + ' =====');
          return page.getTextContent();
        }).then(function (tc) {
          const T = lib.Util.transform.bind(lib.Util);
          say('碎片数: ' + tc.items.length);
          say('items[0] 原始键: ' + Object.keys(tc.items[0] || {}).join(','));
          say('页面 /Rotate 后的视口: ' + vp.width.toFixed(1) + ' x ' + vp.height.toFixed(1));
          say('');
          say('idx  raw_x  raw_y  vx     vy     w      h     | str');
          say('---- ------ ------ ------ ------ ------ ------+------------------');
          tc.items.forEach(function (it, i) {
            const t = it.transform;
            /* 视口变换后的坐标（页面有 /Rotate 时，页面坐标系和看到的坐标系不一样） */
            let vx = NaN, vy = NaN, vh = NaN;
            try {
              const m = T(vp.transform, t);
              vx = m[4]; vy = m[5]; vh = Math.hypot(m[2], m[3]);
            } catch (e) { /* 忽略 */ }
            say(
              String(i).padStart(3) + '  ' +
              t[4].toFixed(1).padStart(6) + ' ' +
              t[5].toFixed(1).padStart(6) + ' ' +
              vx.toFixed(1).padStart(6) + ' ' +
              vy.toFixed(1).padStart(6) + ' ' +
              (it.width || 0).toFixed(1).padStart(6) + ' ' +
              (it.height || 0).toFixed(1).padStart(6) + ' | ' +
              JSON.stringify(it.str)
            );
          });
        });
      })(p);
    }
    return chain;
  }).then(function () {
    say('\n(结束)');
    if (OUT) fs.writeFileSync(path.resolve(process.argv[3]), OUT.join('\n'), 'utf8');
    process.exit(0);
  }, function (e) {
    say('!! 出错: ' + (e && e.message ? e.message : e));
    if (OUT) fs.writeFileSync(path.resolve(process.argv[3]), OUT.join('\n'), 'utf8');
    process.exit(1);
  });
})();
