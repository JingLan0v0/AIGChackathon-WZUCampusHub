#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
视频演示 PPT 生成器（WorkBuddy 开发过程 · 12 页 · 页内点击逐条展现）
==========================================================
用途：给一段 5 分钟的视频做"画面"，视频里讲的就是这一份 PPT。
内容主线：
    我是谁（不会写代码） → 我的开发环境就是一个对话框 → WorkBuddy 界面
    → 开发流程四步 → 三个真实案例（改课表 / 修 bug / 加功能）
    → 做出来的东西 → 质量怎么保证 → 上线 → 收尾

素材：roadshow/shots/ui/workbuddy-window.png（真实界面截图，已隐去个人信息）
      roadshow/shots/*.png（应用真机截图）

用法：python roadshow/tools/build-pptx-video.py
产物：roadshow/校园百事通-WorkBuddy开发过程.pptx
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from deckkit import (Deck, PRIMARY, PRIMARY_L, VIOLET, VIOLET_L, TEXT, TEXT2, MUTED,
                     LINE, SURF2, RED, RED_L, GREEN, GREEN_L, YELLOW, YELLOW_L,
                     DARK, DARK2, CODE_BG)
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'shots')
UI = os.path.join(SHOTS, 'ui')
OUT = os.path.join(ROOT, '校园百事通-WorkBuddy开发过程.pptx')

d = Deck()
R = d.runs

# ============================================================ 01 封面
s = d.slide(bg=PRIMARY)
d.rect(s, 8.5, -1.3, 6.6, 6.6, fill='4C6BFF', radius=0.35)
d.rect(s, -1.6, 4.3, 7.2, 5.0, fill='3352E8', radius=0.35)
logo = d.rect(s, 0.9, 0.82, 0.92, 0.92, fill='5C79FF', radius=0.28)
d.write(logo, [R(('🎓', 26, False, 'FFFFFF'), align=PP_ALIGN.CENTER)], mt=0.02, ml=0.02)
d.textbox(s, 1.98, 0.92, 9.0, 0.5, [R(('温州大学 · 校园创想家 AI 原生应用黑客松 · 赛道二', 14, True, 'FFFFFF'))])
d.textbox(s, 0.86, 1.95, 11.6, 1.4, [R(('校园百事通', 54, True, 'FFFFFF'))])
d.textbox(s, 0.88, 3.15, 11.4, 0.7, [R(('用 WorkBuddy 从零做出来的校园助手', 22, True, 'EAF0FF'))])
c1 = d.textbox(s, 0.88, 3.95, 11.4, 1.3, [
    R(('我基本不写代码 —— 我把需求说清楚，', 17, False, 'D8E1FF')),
    R(('它把东西做出来。', 17, True, 'FFFFFF'), before=4)])
c2 = d.textbox(s, 0.88, 5.6, 11.4, 1.1, [
    R(('开发过程演示 · 约 5 分钟', 15, True, 'FFFFFF')),
    R(('选手：forey　|　温州大学计算机与人工智能学院', 13, False, 'D8E1FF'), before=5)])
c3 = d.textbox(s, 0.88, 6.55, 11.4, 0.6, [R(('▶ 点击鼠标，本页内容会一条条展开', 12, True, 'FFFFFF'))])
d.click([c1]); d.click([c2]); d.click([c3])
d.note(s, '开场（约 20 秒）：这个作品不是「我先写完代码，再让 AI 润色」，而是我从头到尾没有手写过一行代码——我做的事情是：把需求说清楚，然后验收。'
          '接下来几分钟，我演示我怎么用 WorkBuddy 把这个校园应用做出来。')

# ============================================================ 02 我是谁 + 做了什么
s = d.slide()
d.title(s, '00 · 自我介绍', '先说清楚：我是谁、做了个什么东西')
left = d.card(s, 0.62, 1.85, 6.1, 3.9, [
    R(('🙋 我是谁', 19, True, TEXT)),
    R(('温州大学 · 计算机与人工智能学院 学生', 14, False, TEXT2), before=10),
    R(('编程基础：基本不写代码', 14, False, TEXT2), before=4),
    R(('我的开发方式：把需求说清楚，让 AI 落地', 14, False, TEXT2), before=4),
    R(('我做的事：提需求 · 看效果 · 验收', 14, True, PRIMARY), before=10),
], fill=SURF2, line=LINE, anchor=MSO_ANCHOR.TOP)
right = d.card(s, 6.92, 1.85, 5.8, 3.9, [
    R(('🎓 做了什么', 19, True, TEXT)),
    R(('校园百事通 · 一站式校园助手', 14, False, TEXT2), before=10),
    R(('9 个模块：首页 / 今日规划 / 课表 / 调课通知 / 作业 / 二手 / 失物 / 问答 / 我的', 13, False, TEXT2), before=4),
    R(('已经上线，手机浏览器直接能开', 14, False, TEXT2), before=4),
    R(('参赛赛道：校园生活百事通应用创新型', 14, True, PRIMARY), before=10),
], fill=PRIMARY_L, line='CBD7FF', anchor=MSO_ANCHOR.TOP)
tail = d.textbox(s, 0.62, 6.0, 12.1, 0.7,
                 [R(('一句话概括：我用"说人话"的方式，做完了一个能被同学直接用的产品。', 17, True, TEXT))])
d.click([left]); d.click([right]); d.click([tail])
d.note(s, '（约 25 秒）我是一个普通学生，编程基础很弱。所以我没有办法"手写"这么一个应用。'
          '我的方式是把需求说清楚——说给 WorkBuddy 听。这个作品就是它一步步做出来的：9 个模块、已经上线、手机能开。')

# ============================================================ 03 我的开发环境
s = d.slide()
d.title(s, '01 · 开发方式', '我的"开发环境"，就是一个对话框')
STEPS = [
    ('① 我：说需求', '中文、一句话、带场景——截图给它看、发现毛病直接吐槽，都算需求', PRIMARY, SURF2, LINE),
    ('② WorkBuddy：动手', '读改文件、写新模块、补测试、发布上线，一步一步执行给我看', VIOLET, SURF2, LINE),
    ('③ 我：验收', '打开页面看效果、看测试结果、确认没问题才让它上线', GREEN, GREEN_L, 'BFE9D3'),
]
gs = []
y = 1.82
for t, desc, col, bg, ln in STEPS:
    c = d.card(s, 0.62, y, 9.1, 1.22, [
        R((t, 17, True, TEXT)), R((desc, 13, False, TEXT2), before=4)], fill=bg, line=ln, anchor=MSO_ANCHOR.TOP)
    gs.append(c)
    y += 1.36
tail = d.textbox(s, 0.62, 5.95, 9.1, 1.0, [
    R(('全程没有 IDE、没有手写代码，', 17, False, TEXT2)),
    R(('也没有"复制报错再去搜"', 17, True, PRIMARY), ('。', 17, False, TEXT2))])
d.image(s, os.path.join(SHOTS, '03-nl-parse.png'), 10.05, 1.82, w=2.45, crop_bottom=0.42)
for c in gs:
    d.click([c])
d.click([tail])
d.note(s, '（约 30 秒）这是我的开发环境——就是右边这个对话框。我做的事只有三件：说需求、看效果、验收。'
          '具体怎么改代码、怎么建文件、怎么跑测试，都是它做的。'
          '所以我常开玩笑说：我的技术栈是"中文"。')

# ============================================================ 04 WorkBuddy 界面
s = d.slide()
d.title(s, '02 · 开发界面', 'WorkBuddy 的开发界面长这样')
img = d.image(s, os.path.join(UI, 'workbuddy-window.png'), 0.62, 1.78, w=8.3)
cap = d.textbox(s, 0.62, 6.32, 8.3, 0.5,
                [R(('真实界面截图（左下个人信息已隐去）', 11, False, MUTED))])
b1 = d.card(s, 9.22, 1.78, 3.5, 1.44, [
    R(('左栏：能力入口', 14.5, True, TEXT)),
    R(('任务 / 助理 / 项目 / 专家 / 技能 / 连接器 / 定时任务 / 资料库', 11, False, TEXT2), before=4, line=1.25)],
    anchor=MSO_ANCHOR.TOP)
b2 = d.card(s, 9.22, 3.34, 3.5, 1.44, [
    R(('中间：开发现场', 14.5, True, TEXT)),
    R(('一句句对话就是开发过程：需求、改码、跑测试、发布都发生在这里', 11, False, TEXT2), before=4, line=1.25)],
    anchor=MSO_ANCHOR.TOP)
b3 = d.card(s, 9.22, 4.9, 3.5, 1.44, [
    R(('底部：模型与权限', 14.5, True, TEXT)),
    R(('开启"允许完全访问"后，它才能直接改本机文件、跑命令', 11, False, TEXT2), before=4, line=1.25)],
    anchor=MSO_ANCHOR.TOP)
d.click([img]); d.click([b1]); d.click([b2]); d.click([b3])
d.note(s, '（约 30 秒）这就是 WorkBuddy 的开发界面。左边是它的能力入口：任务、项目、技能、连接器、定时任务这些；'
          '中间是开发现场——我所有的需求、它所有的改动，都在这个对话流里；'
          '底部是模型和权限开关，要点开"允许完全访问"，它才能直接改我电脑上的文件、跑命令。'
          '右边这三个区域，就是我整个开发过程用到的全部界面。')

# ============================================================ 05 开发流程四步
s = d.slide()
d.title(s, '03 · 开发流程', '我就是这么一步步做出来的')
FLOW = [
    ('1', '说需求', '一句话讲清\n要什么、在哪用、给谁看', PRIMARY),
    ('2', '它动手', '改代码 / 建模块 /\n补样式，一条条执行', VIOLET),
    ('3', '自动验证', '改完自己跑测试，\n红了就继续修', YELLOW),
    ('4', '一键上线', '发布成链接，\n手机也能打开', GREEN),
]
gf = []
for i, (num, t, desc, col) in enumerate(FLOW):
    x = 0.62 + i * 3.16
    c = d.card(s, x, 2.3, 2.94, 2.5, [
        R((num, 15, True, 'FFFFFF'), align=PP_ALIGN.LEFT),
        R((t, 19, True, TEXT), before=12),
        R((desc, 12.5, False, TEXT2), before=6, line=1.3)], anchor=MSO_ANCHOR.TOP)
    badge = d.rect(s, x + 0.24, 2.54, 0.46, 0.46, fill=col, radius=0.3)
    d.write(badge, [R((num, 14, True, 'FFFFFF'), align=PP_ALIGN.CENTER)], mt=0.02, ml=0.02)
    gf.append(c)
tail = d.textbox(s, 0.62, 5.15, 12.1, 1.1, [
    R(('一轮下来通常是这样：', 15, False, TEXT2)),
    R(('我说一句话 → 它改 5-10 个文件 → 跑几百项测试 → 我刷新页面验收', 15, True, PRIMARY)),
    R(('。', 15, False, TEXT2))])
d.click(gf[0:1]); d.click(gf[1:2]); d.click(gf[2:3]); d.click(gf[3:4]); d.click([tail])
d.note(s, '（约 25 秒）流程其实就这么四步。重点是第三步：它每次改完都会自己跑一遍测试，'
          '红了就继续修，直到全绿才告诉我"好了"。这一步是它能可靠干活的关键。')

# ============================================================ 06 案例一
s = d.slide()
d.title(s, '04 · 真实案例', '案例一：一句话，换掉一整套作息')
q1 = d.quote(s, 0.62, 1.8, 7.6, 0.68, '将课表的时间改为我给你的图')
items = [
    ('先立规矩', '把作息表抽成"单一数据源"：温大真实 11 节作息只写一处',
     '上午 1-5 节 · 下午从第 6 节 13:30 起 · 晚上整段算第 11 节'),
    ('再一起改', '课表、今日规划、调课通知、课表 PDF 识别、抓取脚本全部跟着改',
     '同一份时间被 8 个页面引用，漏一个就会出现"11:45 开始、14:10 下课"这种怪结果'),
    ('最后验证', '重跑全量测试，确认没把别处改坏', '作息表是全校公共数据，动一次必须验一次'),
]
gs, y = [], 2.62
for tag, t, sub in items:
    c = d.card(s, 0.62, y, 12.1, 0.96, [], anchor=MSO_ANCHOR.MIDDLE)
    pill = d.rect(s, 0.8, y + 0.29, 0.72, 0.38, fill=VIOLET_L, radius=0.45)
    d.write(pill, [R((tag, 10.5, True, VIOLET), align=PP_ALIGN.CENTER)], mt=0.01, ml=0.02)
    d.write(c, [R((t, 14.5, True, TEXT)), R((sub, 11.5, False, MUTED), before=2, line=1.2)], ml=0.92)
    gs.append(c)
    y += 1.06
tail = d.card(s, 0.62, 5.9, 12.1, 0.85, [
    R(('我提的是"改时间"，它交付的是"一套系统不再互相打架"。', 15, True, PRIMARY))],
    fill=PRIMARY_L, line='CBD7FF')
d.click([q1]); d.click([gs[0]]); d.click([gs[1]]); d.click([gs[2]]); d.click([tail])
d.note(s, '（约 35 秒）第一个案例最能说明它的工作方式。我发的需求就是一句话加两张图：把课表时间改成图里的。'
          '它没有只改课表那一页——它先把作息表抽成一个单一数据源，再把所有引用这个时间的地方一起改，'
          '包括今日规划、调课通知、PDF 识别。最后跑一遍测试确认没改坏。'
          '所以我提的是"改时间"，它交付的是"整套系统不打架"。')

# ============================================================ 07 案例二
s = d.slide()
d.title(s, '05 · 真实案例', '案例二：我说"没有天气"，它去找真正的原因')
q2 = d.quote(s, 0.62, 1.8, 7.6, 0.68, '主页依旧显示没有天气')
items2 = [
    ('先定位根因', '不是我猜的"接口挂了"，而是两件事叠加',
     '境外天气源在国内经常连不上；代码里还有个异常没被接住，页面就卡在加载态'),
    ('再改方案', '改成三个天气源并行，国内源优先，谁先回来用谁的', '再加缓存兜底：全挂了也显示上次的数据，而不是一片空白'),
    ('最后钉坑', '补 13 项测试：三源全挂、缓存损坏、时间换算都要有明确表现', '这次的坑，下次改代码时会被测试拦住'),
]
gs, y = [], 2.62
for tag, t, sub in items2:
    c = d.card(s, 0.62, y, 12.1, 0.96, [], anchor=MSO_ANCHOR.MIDDLE)
    pill = d.rect(s, 0.8, y + 0.29, 0.82, 0.38, fill=YELLOW_L, radius=0.45)
    d.write(pill, [R((tag, 10.5, True, YELLOW), align=PP_ALIGN.CENTER)], mt=0.01, ml=0.02)
    d.write(c, [R((t, 14.5, True, TEXT)), R((sub, 11.5, False, MUTED), before=2, line=1.2)], ml=1.0)
    gs.append(c)
    y += 1.06
tail2 = d.card(s, 0.62, 5.9, 12.1, 0.85, [
    R(('我只报了一个现象，它连同类问题一起查——这是我最满意的地方。', 15, True, YELLOW))],
    fill=YELLOW_L, line='F8DFB8')
d.click([q2]); d.click([gs[0]]); d.click([gs[1]]); d.click([gs[2]]); d.click([tail2])
d.note(s, '（约 35 秒）修 bug 更能看出它的价值。我只会说"没有天气"，它没有直接去改天气接口，'
          '而是先找根因：境外源在国内连不上，加上代码里有个异常没接住。改成三源并行加缓存兜底之后，'
          '再补上 13 项测试。我报的是现象，它连同类问题一起查。')

# ============================================================ 08 案例三
s = d.slide()
d.title(s, '06 · 真实案例', '案例三：一句话，长出一个新功能')
q3 = d.quote(s, 0.62, 1.8, 8.4, 0.68, '把请假条生成的功能做进 AI 对话框里')
items3 = [
    ('识别', '先让学生"说人话"：病假 / 事假 / 公假、时间、时段、天数、理由',
     '「明天上午请病假，因为发烧要去校医院」→ 拆成假别 + 上午 + 半天 + 理由'),
    ('生成', '拼出正式请假条正文：抬头、学号、时间、补课承诺、落款，一键复制',
     '不写进日程、不上传服务器，姓名学院没填就留占位，不替学生编'),
    ('验证', '补 18 项测试：11 项解析 + 7 项点击交互，当场跑给我看',
     '顺带修掉两个真 bug：「周六」曾被读成晚上、理由尾巴多一个字'),
]
gs, y = [], 2.62
for tag, t, sub in items3:
    c = d.card(s, 0.62, y, 12.1, 0.96, [], anchor=MSO_ANCHOR.MIDDLE)
    pill = d.rect(s, 0.8, y + 0.29, 0.72, 0.38, fill=PRIMARY_L, radius=0.45)
    d.write(pill, [R((tag, 10.5, True, PRIMARY), align=PP_ALIGN.CENTER)], mt=0.01, ml=0.02)
    d.write(c, [R((t, 14.5, True, TEXT)), R((sub, 11.5, False, MUTED), before=2, line=1.2)], ml=0.92)
    gs.append(c)
    y += 1.06
tail3 = d.card(s, 0.62, 5.9, 12.1, 0.85, [
    R(('从"提需求"到"能用"，就是一次对话的时间。', 15, True, GREEN))],
    fill=GREEN_L, line='BFE9D3')
d.click([q3]); d.click([gs[0]]); d.click([gs[1]]); d.click([gs[2]]); d.click([tail3])
d.note(s, '（约 35 秒）第三个案例是加新功能，也是我昨天刚提的。它做了三件事：识别请假意图、生成正式请假条、'
          '再补 18 项测试。过程里还顺手抓出两个真 bug。这种"提一句就有个能用的功能"的节奏，'
          '是我以前不敢想的。')

# ============================================================ 09 做出来的东西
s = d.slide()
d.title(s, '07 · 成品', '最后做出来的东西：9 个模块 + 会说人话的 AI')
MODS = [
    ('🏠', '首页'), ('🧭', '今日规划'), ('📅', '智能课表'),
    ('🔔', '调课通知'), ('📝', '作业 DDL'), ('🛒', '二手集市'),
    ('🔍', '失物招领'), ('💬', '校园问答'), ('👤', '我的'),
]
cw, ch, gp = 1.62, 0.86, 0.12
gs = []
for i, (ico, name) in enumerate(MODS):
    x = 0.62 + (i % 3) * (cw + gp)
    y = 1.85 + (i // 3) * (ch + gp)
    c = d.card(s, x, y, cw, ch, [R((ico + ' ' + name, 13, True, TEXT), align=PP_ALIGN.CENTER)])
    gs.append(c)
AI = [
    ('说人话', '「明晚 7 点图书馆自习 2 小时」→ 时间地点自动填好'),
    ('会分类', '作业 DDL / 课外计划 / 课表补充 / 请假条，自己判断'),
    ('会解析', '教务调课通知 → 匹配到课表里的那门课'),
    ('会建议', '天气 → 出行建议；课表空档 → 今日该做什么'),
]
ga, y = [], 1.85
for t, sub in AI:
    c = d.card(s, 6.02, y, 6.7, 0.86, [
        R((t, 14, True, TEXT)), R(('　' + sub, 11.5, False, TEXT2))], fill=SURF2, line=LINE)
    ga.append(c)
    y += 0.98
tail = d.textbox(s, 6.02, 5.85, 6.7, 0.9, [
    R(('全部零手写代码完成，', 14, False, TEXT2)),
    R(('零外部依赖', 14, True, PRIMARY), ('：断网也能跑。', 14, False, TEXT2))])
d.click(gs); d.click(ga[0:1]); d.click(ga[1:2]); d.click(ga[2:3]); d.click(ga[3:4]); d.click([tail])
d.note(s, '（约 30 秒）这是最后做出来的东西：九个模块，加上四类 AI 能力。'
          '左边这些页面都是真实可用的——二手、失物、问答这些我同学已经能用了。'
          '右边这四类能力，就是"说人话"背后真正在干活的部分。')

# ============================================================ 10 质量保证
s = d.slide()
d.title(s, '08 · 质量把关', '我不敢交"看起来能跑"的东西')
term = d.card(s, 0.62, 1.85, 7.5, 4.15, [
    R(('$ node tests/logic.test.js', 12.5, False, '7FE3A8'), before=0),
    R(('通过 271 项，失败 0 项', 12.5, False, 'E8EEFF'), before=3),
    R(('$ node tests/ui.test.js', 12.5, False, '7FE3A8'), before=8),
    R(('通过 260 项，失败 0 项', 12.5, False, 'E8EEFF'), before=3),
    R(('$ node tests/pdf.test.js', 12.5, False, '7FE3A8'), before=8),
    R(('通过 63 项，失败 0 项', 12.5, False, 'E8EEFF'), before=3),
    R(('$ node tests/consistency.test.js', 12.5, False, '7FE3A8'), before=8),
    R(('✓ CSS / HTML / JS 三方引用一致', 12.5, False, 'E8EEFF'), before=3),
    R(('$ node --check assets/js/*.js', 12.5, False, '7FE3A8'), before=8),
    R(('✓ 37 个文件，0 个语法错误', 12.5, False, 'E8EEFF'), before=3),
], fill=CODE_BG, line=CODE_BG, anchor=MSO_ANCHOR.TOP)
cap = d.textbox(s, 0.62, 6.1, 7.5, 0.5,
                [R(('每次改完都跑这一套 —— 上面是真实输出', 11.5, False, MUTED))])
q = [
    ('全量测试 594 项', '语法 / 逻辑 / 页面交互 / PDF 识别 / 一致性，一项都不能红'),
    ('一致性检查', 'CSS、HTML、JS 的引用对不上就报错——避免"改了旧文件、页面还是旧的"'),
    ('测试时钟钉死', '把"现在"固定在同一个时刻，周末跑和周三跑结果一致，不然测试靠运气'),
]
gq, y = [], 8.42
for t, sub in q:
    c = d.card(s, 8.42, y, 4.3, 1.28, [
        R((t, 14, True, TEXT)), R((sub, 11, False, TEXT2), before=3, line=1.25)],
        fill=SURF2, line=LINE, anchor=MSO_ANCHOR.TOP)
    gq.append(c)
    y += 1.4
tail10 = d.textbox(s, 8.42, 6.05, 4.3, 0.8, [
    R(('全绿，我才敢发链接。', 14, True, GREEN))])
d.click([term]); d.click([gq[0]]); d.click([gq[1]]); d.click([gq[2]]); d.click([tail10])
d.note(s, '（约 30 秒）这是我最想强调的一页：它写完代码不会直接说"好了"，而是先跑测试。'
          '整套加起来 594 项断言，覆盖逻辑、页面交互、PDF 识别、还有引用一致性。'
          '前两天还发现测试本身有时间依赖——周末跑会红——它把测试里的"现在"钉死在同一个时刻。'
          '全绿之后才让我去验收。')

# ============================================================ 11 上线
s = d.slide()
d.title(s, '09 · 上线', '做完就上线，链接直接能开')
on = [
    ('🚀 一句话发布', '从本地代码到线上链接，它自己完成发布；手机打开也是完整功能'),
    ('🔑 演示账号', '20230427 / wzu@2026 —— 打开链接就能进去看全部模块'),
    ('🏫 真实数据怎么进来', '统一身份认证是网易 SSO + 人机验证，静态页直连不了；改成"同源抓取脚本 + 一键导入"，不碰密码'),
]
go, y = [], 1.9
for t, sub in on:
    c = d.card(s, 0.62, y, 8.6, 1.36, [
        R((t, 15, True, TEXT)), R((sub, 11.5, False, TEXT2), before=4, line=1.25)],
        anchor=MSO_ANCHOR.TOP)
    go.append(c)
    y += 1.5
link = d.card(s, 0.62, 6.42, 8.6, 0.72, [
    R(('campus-hub-57981.app.workbuddy.host', 15, True, PRIMARY), align=PP_ALIGN.LEFT)],
    fill=PRIMARY_L, line='CBD7FF')
d.image(s, os.path.join(SHOTS, '05-schedule.png'), 9.7, 1.9, w=3.0, crop_bottom=0.30)
for c in go:
    d.click([c])
d.click([link])
d.note(s, '（约 25 秒）做完就上线。发布这件事也是一句话——它把本地代码发布成一个链接，手机也能开。'
          '顺便说一下真实数据：学校统一身份认证是网易 SSO 加人机验证，静态页面直连拿不到会话，'
          '所以我们没有硬闯，改成让学生用同源脚本把课表带回来、一键导入——全程不碰密码。')

# ============================================================ 12 收尾
s = d.slide(bg=DARK)
d.rect(s, 8.7, -1.5, 6.4, 6.4, fill=DARK2, radius=0.35)
d.pill(s, 0.9, 0.8, 2.4, 0.34, '一句话总结', color='FFFFFF', fill=DARK2)
big = d.textbox(s, 0.86, 1.45, 11.6, 1.6, [
    R(('一个学生 + 一个对话框', 36, True, 'FFFFFF')),
    R(('= 一套已经上线的校园应用', 26, True, '9DB2FF'), before=8)])
sub = d.textbox(s, 0.9, 3.35, 11.4, 0.9, [
    R(('我没有写代码，我做的是：把需求说清楚、把测试结果看懂、按证据验收。', 15, False, 'C7D2FF')),
    R(('这件事以前需要一个程序员，现在只需要一个对话框。', 15, False, 'C7D2FF'), before=3)])
learn = d.card(s, 0.62, 4.5, 6.1, 1.6, [
    R(('我学到的', 15, True, 'FFFFFF')),
    R(('需求要说清场景 · 改完必须看测试 · 发现问题让它连同类一起查', 12, False, 'D8E1FF'), before=6, line=1.3)],
    fill=DARK2, line='3E4E9E', anchor=MSO_ANCHOR.TOP)
nxt = d.card(s, 6.62, 4.5, 6.1, 1.6, [
    R(('下一步', 15, True, 'FFFFFF')),
    R(('接真实教务接口 · 二手交易闭环 · 校园问答接入学校知识库', 12, False, 'D8E1FF'), before=6, line=1.3)],
    fill=DARK2, line='3E4E9E', anchor=MSO_ANCHOR.TOP)
foot = d.textbox(s, 0.9, 6.3, 11.4, 0.7, [
    R(('🎓 校园百事通　', 15, True, 'FFFFFF'),
         ('campus-hub-57981.app.workbuddy.host', 14, False, '9DB2FF'))])
d.click([sub]); d.click([learn, nxt]); d.click([foot])
d.note(s, '（约 20 秒）最后用一句话收尾：一个学生加一个对话框，等于一套已经上线的校园应用。'
          '我没有写代码，我做的是把需求说清楚、把测试结果看懂、按证据验收。谢谢大家。')

d.save(OUT)
