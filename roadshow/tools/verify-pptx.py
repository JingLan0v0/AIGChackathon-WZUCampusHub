#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PPTX 自查：把我们手工注入的「单击出场动画」核对一遍
==========================================================
PowerPoint 弹「修复」最常见的三个原因：
  ① 动画引用的形状 id（spid）在同页里不存在
  ② slide XML 里子元素顺序不对（必须 cSld → clrMapOvr → transition → timing）
  ③ XML 本身不合法
这个脚本把三条都查掉，顺便报告每页的点击次数。

用法：python roadshow/tools/verify-pptx.py
"""

import os
import sys
import zipfile

from lxml import etree
from pptx import Presentation
from pptx.oxml.ns import qn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 用法：python verify-pptx.py [某个.pptx]（不给就用路演稿）
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '校园百事通-路演.pptx')
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'

fails = []


def ok(name, cond, extra=''):
    print(('  ✓ ' if cond else '  ✗ ') + name + (('  → ' + str(extra)) if extra and not cond else ''))
    if not cond:
        fails.append(name)


print('文件：' + PATH)
print('大小：%.2f MB' % (os.path.getsize(PATH) / 1024 / 1024))

# ① 包完整性：所有 xml 部件都能解析
z = zipfile.ZipFile(PATH)
bad = z.testzip()
ok('zip 结构完好', bad is None, bad)
xml_parts = [n for n in z.namelist() if n.endswith('.xml') or n.endswith('.rels')]
broken = []
for n in xml_parts:
    try:
        etree.fromstring(z.read(n))
    except Exception as e:
        broken.append(n + ': ' + str(e)[:60])
ok('全部 %d 个 XML 部件可解析' % len(xml_parts), not broken, broken[:3])

# ② 用 python-pptx 重新打开（等于再走一遍正规解析）
prs = Presentation(PATH)
print('\n页数：%d　尺寸：%.2f × %.2f 英寸' % (
    len(prs.slides), prs.slide_width / 914400, prs.slide_height / 914400))
ok('重新打开成功且为 16:9 宽屏', abs(prs.slide_width / prs.slide_height - 16 / 9) < 0.01)

# ③ 逐页核对动画
print('\n— 动画核对 —')
total_clicks = 0
total_eff = 0
for i, slide in enumerate(prs.slides):
    el = slide._element
    # 子元素顺序
    order = [etree.QName(c).localname for c in el]
    idx = {n: order.index(n) for n in order}
    good_order = ('cSld' in idx) and (idx.get('timing', 99) > idx['cSld']) and \
                 (idx.get('clrMapOvr', -1) < idx.get('timing', 99))
    ids = set()
    for sp in el.iter():
        if etree.QName(sp).localname == 'cNvPr' and sp.get('id'):
            ids.add(int(sp.get('id')))
    timing = el.find(qn('p:timing'))
    if timing is None:
        print('  第 %d 页：没有 timing（无动画页）' % (i + 1))
        continue
    spids = [int(e.get('spid')) for e in timing.iter() if etree.QName(e).localname == 'spTgt']
    ghost = [s for s in spids if s not in ids]
    # click 组数 = nodeType="clickEffect" 个数
    clicks = len([e for e in timing.iter()
                  if etree.QName(e).localname == 'cTn' and e.get('nodeType') == 'clickEffect'])
    total_clicks += clicks
    total_eff += len(spids)
    ok('第 %d 页：子元素顺序 / 引用 id 全部存在 / %d 个效果的 spid 合法'
       % (i + 1, len(spids)),
       good_order and not ghost and len(spids) > 0,
       ('顺序=%s' % order) if not good_order else ('幽灵 id=%s' % ghost))
    print('        点击 %d 次（每次出现 %d/%d 个形状）'
          % (clicks, len(spids) // max(clicks, 1), len(spids)))

print('\n合计：%d 页有动画，%d 次点击，%d 个出场效果'
      % (len([1 for s in prs.slides if s._element.find(qn('p:timing')) is not None]),
         total_clicks, total_eff))

# ④ 演讲备注是否都在
n_slides = len(prs.slides)
notes_ok = sum(1 for s in prs.slides if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip())
ok('每页都带演讲备注（%d/%d）' % (notes_ok, n_slides), notes_ok == n_slides, notes_ok)

# ⑤ 图片是否内嵌（真机截图）
imgs = [n for n in z.namelist() if n.startswith('ppt/media/')]
ok('内嵌真实截图 %d 张（至少 1 张）' % len(imgs), len(imgs) >= 1, imgs)

# ⑥ 版面自查：按字宽估算「文字会不会超出形状」
#    没有渲染器时的最接近做法：中文按 1 字宽 = 字号，英文数字按 0.55，空格 0.3
#    行高按 字号 × 行距 × 1.22 估。超框会在放映时压到别的元素上，所以必须查。
print('\n— 版面自查（估算文字是否超框）—')


def est_width(text, size):
    w = 0.0
    for ch in text:
        o = ord(ch)
        if o > 0x2E80:          # CJK / 全角
            w += 1.0
        elif ch == ' ':
            w += 0.30
        else:
            w += 0.55
    return w * size


over = []
for i, slide in enumerate(prs.slides):
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        txt = sh.text_frame.text.strip()
        if not txt:
            continue
        box_w = sh.width / 12720.0
        box_h = sh.height / 12720.0
        tf = sh.text_frame
        usable_w = box_w - (tf.margin_left + tf.margin_right) / 12720.0
        usable_h = box_h - (tf.margin_top + tf.margin_bottom) / 12720.0
        need = 0.0
        for para in tf.paragraphs:
            if not para.runs:
                continue
            size = max([(r.font.size.pt if r.font.size else 12) for r in para.runs])
            ls = para.line_spacing if isinstance(para.line_spacing, float) else 1.15
            w = sum(est_width(r.text, r.font.size.pt if r.font.size else 12) for r in para.runs)
            import math
            lines = max(1, math.ceil(w / max(usable_w, 1) * 1.03))
            need += lines * size * ls * 1.22
            need += (para.space_before.pt if para.space_before else 0)
        if need > usable_h * 1.02:
            over.append('第 %d 页「%s」超框约 %d pt（可用 %d pt）'
                        % (i + 1, txt.replace('\n', ' ')[:18], need - usable_h, usable_h))
if over:
    print('  ⚠ ' + str(len(over)) + ' 处可能超框：')
    for o in over:
        print('     · ' + o)
else:
    print('  ✓ 所有文本框都在框内（估算）')

# ⑦ 图片与文字框不得互相压住（截图边上放图注最容易踩，纯文本检查看不出来）
print('\n— 图片 / 文字重叠检查 —')


def rect_of(sh):
    return (sh.left, sh.top, sh.left + sh.width, sh.top + sh.height)


clash = []
for i, slide in enumerate(prs.slides):
    pics = [rect_of(sh) for sh in slide.shapes if sh.shape_type == 13]
    texts = [(rect_of(sh), sh.text_frame.text.strip()) for sh in slide.shapes
             if sh.has_text_frame and sh.text_frame.text.strip()]
    for (l, t, r, b), txt in texts:
        for (pl, pt, pr, pb) in pics:
            ox = min(r, pr) - max(l, pl)
            oy = min(b, pb) - max(t, pt)
            if ox > 20000 and oy > 20000:        # 约 0.02 英寸以上才算真重叠
                clash.append('第 %d 页「%s」压住图片（重叠 %d×%d EMU）'
                             % (i + 1, txt.replace('\n', ' ')[:16], ox, oy))
if clash:
    print('  ⚠ ' + str(len(clash)) + ' 处重叠：')
    for c in clash:
        print('     · ' + c)
else:
    print('  ✓ 没有文字压在图片上')

print('\n=============== 结论 ===============')
print('✓ 全部通过' if not fails else '✗ 失败项：' + '；'.join(fails))
sys.exit(1 if fails else 0)