# 项目框架

“AIGC黑客松——温大校园通”是一个面向温州大学学生的浏览器应用。应用将每日提醒、课表、作业、课外计划、失物招领和校园问答放在同一入口；首页的校园 AI 助手把自然语言请求转换为可核对的查询或操作。

## 目录

```text
.
├─ campus-hub/                 网页应用
│  ├─ index.html               登录入口
│  ├─ home.html                首页与全局 AI 助手
│  ├─ plan.html                今日规划
│  ├─ schedule.html            课表
│  ├─ homework.html            作业
│  ├─ lost.html                失物招领
│  ├─ qa.html                  校园问答
│  ├─ me.html                  个人资料与数据管理
│  ├─ assets/
│  │  ├─ css/                  视觉样式与响应式布局
│  │  ├─ img/                  页面图片
│  │  ├─ js/                   页面逻辑、数据层、规划与 AI 客户端
│  │  └─ vendor/pdfjs/         本地 PDF 文字提取
│  ├─ tools/                   本地 Node 服务、AI 请求与开发工具
│  ├─ tests/                   逻辑、界面、PDF、AI 和引用检查
│  └─ sample/                  演示及测试样本
├─ roadshow/                   演示文稿、讲稿和截图
├─ package.json                本地启动与测试命令
└─ README.md                   项目介绍和使用方法
```

## 运行与数据流

网页采用原生 HTML、CSS 和 JavaScript；`campus-hub/tools/serve.js` 仅在本机 `127.0.0.1` 提供页面和 AI 请求入口。应用运行不需要构建步骤。天气由浏览器请求多个数据源并使用缓存兜底；课表 PDF 在浏览器本机解析，用户核对后才写入。

`assets/js/store.js` 管理浏览器本地数据，并按学号隔离账号。`planner.js` 汇合课程、作业、课外安排和时间信息，供首页提醒与今日规划使用。`notices.js` 管理用户确认的课程调整；课表及规划读取同一份调整后的数据。

AI 流程是“输入 → 识别 → 校验 → 用户确认 → 写入”：`assets/js/assistant.js` 收集当前请求及所需的少量上下文，常用查询由浏览器直接处理；复杂请求由 `tools/assistant.js` 经 DeepSeek 识别。模型只能提出 `assistant-actions.js` 白名单中的动作。涉及修改、删除的动作会先展示核对卡，确认时再次校验并执行；失败时回滚。明确的“今天调到明天”还会按当前日期和学期起始日核对教学周。

## 密钥与公开仓库

DeepSeek 密钥不写进前端、源码或 Git。Windows 用户可运行 `campus-hub/tools/set-deepseek-key.ps1` 配置自己的有效密钥；它经当前用户 DPAPI 加密后保存在仓库外的 `%LOCALAPPDATA%/CampusHub/deepseek.dpapi`。没有密钥时页面、课表、规划和本机数据功能仍可使用，AI 请求会提示配置密钥。本仓库的 `.gitignore` 排除本地密钥、`.env`、依赖目录和临时文件。

## 验证

在仓库根目录运行 `npm install`，再运行 `npm run test:syntax`、`npm test` 和 `npm run test:ai`。应用本身没有第三方运行时 npm 依赖；`npm install` 主要提供测试工具。
