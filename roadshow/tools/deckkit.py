#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
deckkit —— 路演/视频 PPT 的共用绘图与动画封装
==========================================================
为什么单独抽出来：这个项目要出两套演示稿（路演稿、WorkBuddy 开发过程视频稿），
绘图代码、配色、以及「点击出场动画」的 OOXML 拼装完全一样，
分成两份迟早会改歪一份。动画格式的说明见 inject() 的注释。

用法（在生成脚本里）：
    from deckkit import Deck
    d = Deck()
    s = d.slide()                  # 新页
    d.title(s, '01 · 问题', '标题')
    card = d.card(s, x, y, w, h, [d.runs(...)])
    d.click(s, [card])             # 这一组内容「点一下出现」
    d.save('xxx.pptx')
"""

import os

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

FONT = '微软雅黑'

# 配色跟着「校园百事通」站点，演示时视觉一致
PRIMARY = '3A5BFF'
PRIMARY_L = 'E8EDFF'
VIOLET = '7A5CFF'
VIOLET_L = 'F0EBFF'
TEXT = '131A2A'
TEXT2 = '45506A'
MUTED = '8892A6'
LINE = 'E1E8F3'
SURF = 'FFFFFF'
SURF2 = 'F4F7FC'
RED = 'F04438'
RED_L = 'FDECEA'
GREEN = '12B76A'
GREEN_L = 'E6F8EF'
YELLOW = 'F79009'
YELLOW_L = 'FEF4E6'
DARK = '16204A'
DARK2 = '23307A'
CODE_BG = '14203C'

SLIDE_W = 13.333
SLIDE_H = 7.5


class Deck:
    def __init__(self, w=SLIDE_W, h=SLIDE_H):
        self.prs = Presentation()
        self.prs.slide_width = Inches(w)
        self.prs.slide_height = Inches(h)
        self.blank = self.prs.slide_layouts[6]
        self.groups = []          # 每页的点击分组：[[shape, ...], ...]

    # ------------------------------------------------ 基础
    def slide(self, bg=SURF):
        s = self.prs.slides.add_slide(self.blank)
        s.background.fill.solid()
        s.background.fill.fore_color.rgb = RGBColor.from_string(bg)
        self.groups.append([])
        return s

    def click(self, *shapes):
        """登记一组「点一下才出现」的内容（顺序即点击顺序）"""
        group = []
        for sh in shapes:
            if isinstance(sh, (list, tuple)):
                group.extend(sh)
            else:
                group.append(sh)
        self.groups[-1].append(group)
        return group

    @staticmethod
    def runs(*items, **kw):
        """一行里的多个片段：runs(("正文", 15, True, TEXT), ("→ 补充", 13, False, RED))"""
        return {'runs': list(items), 'align': kw.get('align', PP_ALIGN.LEFT),
                'line': kw.get('line', 1.15), 'before': kw.get('before', 0)}

    @staticmethod
    def write(shape, paras, anchor=MSO_ANCHOR.MIDDLE, mt=0.06, ml=0.14):
        tf = shape.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        tf.margin_top = tf.margin_bottom = Inches(mt)
        tf.margin_left = tf.margin_right = Inches(ml)
        for i, p in enumerate(paras):
            # 也允许直接给一串 run（写成 [('文字', 15, True, TEXT), ...]），
            # 省得每段都包一层 runs()
            if isinstance(p, (list, tuple)):
                p = {'runs': [p] if isinstance(p[0], str) else list(p)}
            para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            para.alignment = p.get('align', PP_ALIGN.LEFT)
            para.line_spacing = p.get('line', 1.15)
            if p.get('before'):
                para.space_before = Pt(p['before'])
            for r in p['runs']:
                text, size, bold, color = r[0], r[1], r[2], r[3]
                font = r[4] if len(r) > 4 else FONT
                run = para.add_run()
                run.text = text
                run.font.size = Pt(size)
                run.font.bold = bold
                run.font.color.rgb = RGBColor.from_string(color)
                run.font.name = font
        return shape

    def rect(self, slide, x, y, w, h, fill=None, line=None, radius=None,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE):
        sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
        if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
            sh.adjustments[0] = radius
        if fill:
            sh.fill.solid()
            sh.fill.fore_color.rgb = RGBColor.from_string(fill)
        else:
            sh.fill.background()
        if line:
            sh.line.color.rgb = RGBColor.from_string(line)
            sh.line.width = Pt(0.9)
        else:
            sh.line.fill.background()
        sh.shadow.inherit = False
        sh.text_frame.word_wrap = True
        return sh

    def textbox(self, slide, x, y, w, h, paras, anchor=MSO_ANCHOR.TOP):
        tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tb.text_frame.word_wrap = True
        return self.write(tb, paras, anchor=anchor, mt=0.02, ml=0.02)

    def card(self, slide, x, y, w, h, paras, fill=SURF2, line=LINE, radius=0.10,
             anchor=MSO_ANCHOR.MIDDLE):
        sh = self.rect(slide, x, y, w, h, fill=fill, line=line, radius=radius)
        return self.write(sh, paras, anchor=anchor)

    def pill(self, slide, x, y, w, h, text, size=11.5, color=PRIMARY, fill=PRIMARY_L):
        sh = self.rect(slide, x, y, w, h, fill=fill, radius=0.5)
        return self.write(sh, [self.runs((text, size, True, color), align=PP_ALIGN.CENTER)],
                          mt=0.02, ml=0.06)

    def title(self, slide, kicker, title, accent=PRIMARY, title_size=27, top=0.88):
        """页眉：顶部细色条 + 彩色标签 + 大标题"""
        self.rect(slide, 0, 0, SLIDE_W, 0.075, fill=accent, shape=MSO_SHAPE.RECTANGLE)
        self.pill(slide, 0.62, 0.42, 0.62 + 0.105 * len(kicker), 0.34, kicker)
        self.textbox(slide, 0.58, top, 12.2, 0.72,
                     [self.runs((title, title_size, True, TEXT))], anchor=MSO_ANCHOR.TOP)

    def quote(self, slide, x, y, w, h, text, size=16):
        """引用框：用在「我原话是怎么说的」那种地方。
           注意必须是一段三个片段 —— 写成三段会各占一行、把框撑爆。"""
        return self.card(slide, x, y, w, h,
                         [self.runs(('“', size, False, MUTED),
                                    (text, size, True, TEXT),
                                    ('”', size, False, MUTED))],
                         fill=PRIMARY_L, line='CBD7FF')

    def image(self, slide, path, x, y, w=None, h=None, crop_bottom=0.0):
        kw = {}
        if w:
            kw['width'] = Inches(w)
        if h:
            kw['height'] = Inches(h)
        pic = slide.shapes.add_picture(path, Inches(x), Inches(y), **kw)
        if crop_bottom:
            pic.crop_bottom = crop_bottom
        return pic

    def note(self, slide, text):
        slide.notes_slide.notes_text_frame.text = text

    def page_no(self, slide, n, color=MUTED):
        self.textbox(slide, 12.4, 7.02, 0.6, 0.3,
                     [self.runs((str(n), 11, False, color), align=PP_ALIGN.RIGHT)],
                     anchor=MSO_ANCHOR.MIDDLE)

    # ------------------------------------------------ 动画
    def inject(self):
        """把「单击依次出现」写进每页的 <p:timing>（PowerPoint 原生动画格式）

        结构（与 PowerPoint 自己写出来的一致）：
          每个点击组 = 外层 par（cond delay="indefinite"，第一组再带 onBegin→mainSeq）
            → 内层 par
              → 若干 p:par：第一个 nodeType="clickEffect"，同组其余 "withEffect"
                 效果体 = p:set style.visibility=visible
                          （presetID="1" presetClass="entr" = 「出现」）
        注意：p:seq 要 concurrent="1" nextAc="seek" + prevCondLst/nextCondLst；
             <p:timing> 必须是 <p:sld> 的最后一个子元素；
             最容易让 PowerPoint 弹「修复」的是 spid 对不上同页形状 id。
        """
        NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
        total = 0
        for idx, slide in enumerate(self.prs.slides):
            groups = [g for g in (self.groups[idx] if idx < len(self.groups) else []) if g]
            if not groups:
                continue
            ctn = [10]

            def nid():
                ctn[0] += 1
                return ctn[0]

            def eff(shape, node_type):
                return (
                    '<p:par><p:cTn id="%d" presetID="1" presetClass="entr" presetSubtype="0" '
                    'fill="hold" grpId="0" nodeType="%s">'
                    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
                    '<p:set><p:cBhvr><p:cTn id="%d" dur="1" fill="hold">'
                    '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
                    '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
                    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
                    '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
                    '</p:childTnLst></p:cTn></p:par>'
                ) % (nid(), node_type, nid(), shape.shape_id)

            pars = []
            for gi, group in enumerate(groups):
                inner = ''.join(eff(sh, 'clickEffect' if i == 0 else 'withEffect')
                                for i, sh in enumerate(group))
                first_cond = ('<p:cond delay="indefinite"/>'
                              '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>'
                              if gi == 0 else '<p:cond delay="indefinite"/>')
                pars.append(
                    '<p:par><p:cTn id="%d" fill="hold"><p:stCondLst>%s</p:stCondLst>'
                    '<p:childTnLst><p:par><p:cTn id="%d" fill="hold">'
                    '<p:stCondLst><p:cond delay="0"/></p:stCondLst>'
                    '<p:childTnLst>%s</p:childTnLst></p:cTn></p:par>'
                    '</p:childTnLst></p:cTn></p:par>' % (nid(), first_cond, nid(), inner))
                total += len(group)
            xml = (
                '<p:timing xmlns:p="%s"><p:tnLst><p:par>'
                '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
                '<p:childTnLst><p:seq concurrent="1" nextAc="seek">'
                '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>%s</p:childTnLst></p:cTn>'
                '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
                '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
                '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
            ) % (NS_P, ''.join(pars))
            slide._element.append(etree.fromstring(xml))
        return total

    def save(self, path):
        n = self.inject()
        self.prs.save(path)
        print('已生成：' + path)
        print('页数：%d　带动画的形状：%d 个　大小 %.2f MB'
              % (len(self.prs.slides), n, os.path.getsize(path) / 1024 / 1024))
        return path
