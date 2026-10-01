/* ==========================================================
   验证「内联 CMap」这条路真的能走通
   ----------------------------------------------------------
   假设：把 .bcmap 的字节直接喂给 pdf.js 的自定义 CMapReaderFactory，
        pdf.js 能照常解出中文（等价于 cMapUrl 走文件）。
   如果这个假设不成立，file:// 下双击打开就没救。
   所以这里用一个「只从内存拿数据、绝不碰文件」的工厂，
   去解析真实 PDF，看能不能拿到同样的结果。

   用法：node tools/verify-inline-cmap.js <某个.pdf>
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cmaps = require(path.join(ROOT, 'assets/vendor/pdfjs/cmaps-inline.js'));

function loadPdfjs() {
  const tries = ['pdfjs-dist/legacy/build/pdf.js', 'pdfjs-dist/build/pdf.js', 'pdfjs-dist'];
  for (let i = 0; i < tries.length; i++) {
    try { const L = require(tries[i]); if (L && L.getDocument) return L; } catch (e) { }
  }
  return null;
}

/* 只认内存里的数据；没有就失败 —— 故意不提供任何联网 / 读盘兜底，
   这样测出来的就是 file:// 下的真实行为。 */
function InlineOnlyFactory(opt) {
  this.baseUrl = (opt && opt.baseUrl) || '';
  this.isCompressed = !(opt && opt.isCompressed === false);
}
InlineOnlyFactory.prototype.fetch = function (q) {
  const name = q && q.name;
  const bytes = cmaps.decode(name);
  if (!bytes) return Promise.reject(new Error('内联里没有 CMap: ' + name));
  const lib = this._lib;
  let type = 1;                                   /* CMapCompressionType.BINARY */
  try { if (lib && lib.CMapCompressionType) type = lib.CMapCompressionType.BINARY; } catch (e) { }
  return Promise.resolve({ cMapData: bytes, compressionType: type });
};

(function main() {
  const file = process.argv[2];
  const lib = loadPdfjs();
  if (!lib) { console.log('没找到 pdfjs-dist'); process.exit(1); }
  InlineOnlyFactory.prototype._lib = lib;

  const notInlined = {};                          /* 记录内联里没有、被请求过的 CMap */
  const RealFactory = InlineOnlyFactory;
  function Factory(opt) {
    RealFactory.call(this, opt);
  }
  Factory.prototype = Object.create(RealFactory.prototype);
  Factory.prototype.fetch = function (q) {
    if (!cmaps.has(q && q.name)) notInlined[q.name] = 1;
    return RealFactory.prototype.fetch.call(this, q);
  };

  const data = new Uint8Array(fs.readFileSync(path.resolve(file)));
  lib.getDocument({
    data: data,
    cMapUrl: 'assets/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    CMapReaderFactory: Factory,
    verbosity: 0
  }).promise.then(function (doc) {
    console.log('页数 ' + doc.numPages);
    let chain = Promise.resolve(), all = [];
    for (let p = 1; p <= doc.numPages; p++) {
      (function (pn) {
        chain = chain.then(function () { return doc.getPage(pn); })
          .then(function (page) { return page.getTextContent(); })
          .then(function (tc) {
            const t = tc.items.map(function (i) { return i.str; }).join('');
            all.push(t);
            console.log('第 ' + pn + ' 页碎片 ' + tc.items.length + ' 个');
          });
      })(p);
    }
    return chain.then(function () {
      const joined = all.join('');
      console.log('\n请求过但内联里没有的 CMap: ' +
        (Object.keys(notInlined).length ? Object.keys(notInlined).join(', ') : '（无）'));
      console.log('总字数 ' + joined.length);
      console.log('抽样: ' + JSON.stringify(joined.slice(0, 60)));
      console.log('含「学分」: ' + (joined.indexOf('学分') >= 0));
      console.log('含「场地」: ' + (joined.indexOf('场地') >= 0));
      console.log('含「星期一」: ' + (joined.indexOf('星期一') >= 0));
      process.exit(joined.length > 200 ? 0 : 1);
    });
  }).catch(function (e) {
    console.log('!! 失败: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
})();
