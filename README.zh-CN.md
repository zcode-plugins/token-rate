# Token 脉冲（Token Pulse）

[English](README.md) | 简体中文

[ZCode](https://zhipu-ai.github.io/ZCode/) 会话的实时 Token 速率与用量监视器。

[![CI](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml/badge.svg)](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ZCode Plugin](https://img.shields.io/badge/ZCode-plugin-7c3aed)](.zcode-plugin/plugin.json)
[![Version](https://img.shields.io/badge/version-0.3.3-green)](CHANGELOG.md)

Token 脉冲读取 ZCode 的本地会话记录（`~/.zcode/cli/rollout/model-io-session_*.jsonl`，其中记载了每次模型调用的 token 用量与耗时），并将其转化为实时指标：

- **生成速率** —— 输出 token ÷ 模型调用耗时，不含工具执行间隙，即"模型此刻写得多快"。
- **吞吐** —— 滑动窗口（默认 10 分钟）内按墙钟时间计算的每秒 token 数，含工具间隙。
- **累计用量** —— 输入（含缓存命中率与新增 token）、输出（含思考 token）、合计、调用次数与会话时长。

## 功能特性

- **回复尾部的速率行** —— `UserPromptSubmit` hook 随每条消息注入最新统计，由 agent 在每轮回复结尾追加一行摘要；默认极简样式（`[token-rate] ⚡24.7 tok/s · 入 1.30M / 出 7.8k`），可切换完整统计或整体关闭，见下方[插件设置](#插件设置)。
- **`token_rate` MCP 工具** —— 按需输出当前会话或任一历史会话的完整报告；`list: true` 枚举历史会话。
- **`/token-rate` 斜杠命令** —— 一键获取版式统一的完整报告。
- **插件设置** —— 注入开关、详细速率行开关、吞吐窗口均可在客户端插件详情页的 **Advanced** 表单中配置，无需手改文件。
- **中英双语输出** —— 输出语言由插件设置 `language` 决定：`auto`（默认）跟随 ZCode 界面语言（`~/.zcode/cli/config.json` 的 `ui.locale`，回退顺序为 `LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE` 与系统 locale）；`zh` / `en` 强制指定语言。`TOKEN_RATE_LANG` 优先级最高。
- **默认不影响会话** —— hook 任何错误都静默跳过，绝不阻塞会话。

> 说明：ZCode 客户端目前没有应用内状态栏扩展点（无 `statusLine` 配置、无扩展宿主、插件 UI 字段"记录但不执行"），因此本插件只提供会话内入口，也不提供常驻屏幕的悬浮窗。

## 环境要求

- ZCode 桌面客户端
- `PATH` 中有 Node.js ≥ 18（MCP 服务器与 hook 通过 `node` 启动）

## 安装

**从本仓库安装（GitHub 市场源）** —— 仓库根目录含 `marketplace.json`，可直接作为插件市场添加：

1. 打开 **插件市场 → 添加 → 添加插件市场**；
2. 粘贴 `https://github.com/zcode-plugins/token-rate`；
3. 在 **个人** 中找到 **Token 脉冲**，点击 **安装**。

**本地开发** —— 克隆仓库后，把包含开发用 `marketplace.json` 的上级目录作为市场添加，再从那里安装。后续更新流程：源码改动并在清单与市场目录中同步版本号后，到 **插件市场 → 齿轮 → 市场源** 刷新该市场，再回到 **个人 → Token 脉冲 → 详情 → 更新**。注意源码修改不会热更新——刷新市场只更新目录，已安装的插件还需单独点一次"更新"。

## 使用

| 入口 | 效果 |
| --- | --- |
| 正常发送消息 | 每轮回复结尾出现速率行：`[token-rate] ⚡24.7 tok/s · 入 1.30M / 出 7.8k` |
| `/token-rate` | 完整报告：生成速率 / 吞吐 / 累计用量 / 会话信息 |
| `/token-rate list` | 枚举历史会话 |
| `/token-rate <会话ID>` | 查看指定会话 |

也可以直接问"现在多快"——注入的统计让 agent 能立即作答。

## 插件设置

打开 **设置 → 插件管理 → 已安装 → Token 脉冲 → 详情 → Advanced**，设置以下配置（保存即生效，持久化在 `~/.zcode/cli/config.json` 的 `plugins.options`，无需手改文件）：

| 配置项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `inject_line` | 开关 | 开 | 是否每轮注入速率行；关闭后 MCP 工具与 `/token-rate` 命令不受影响 |
| `detailed_line` | 开关 | 关 | 开 = 完整统计（速率/吞吐/累计/时长）；关 = 极简一行 |
| `window_minutes` | 数字 | `10` | 吞吐统计的滑动窗口（分钟），同时作为 MCP 工具的默认窗口 |
| `language` | 文本 | `auto` | `auto` = 跟随 ZCode 界面语言；`zh` / `en` = 强制中文 / 英文 |

ZCode 的插件设置表单没有下拉控件——清单 schema 只接受 `string`、`number`、`boolean`、`directory`、`file`，分别渲染为文本/数字输入框和开关。因此两态选项统一做成开关；三态的 `language` 只能保留文本输入。旧版 `line_style` 键（`compact`/`detailed`）若已保存仍会生效。

高级用法：环境变量 `TOKEN_RATE_INJECT`、`TOKEN_RATE_STYLE`、`TOKEN_RATE_WINDOW`、`TOKEN_RATE_LANG` 可临时覆盖上述设置（优先级最高）。

## 指标口径

| 指标 | 定义 |
| --- | --- |
| 生成速率（tok/s） | `Σ 输出 token ÷ Σ 模型调用耗时`。"最近"取最近 5 次；"峰值"仅统计耗时 ≥ 2 秒的调用 |
| 吞吐（tok/s） | 窗口内（默认 10 分钟）按墙钟时间每秒 token 数，含工具间隙 |
| 缓存命中 | `cacheReadTokens ÷ inputTokens`（`inputTokens` 含缓存读） |
| 输出 | `outputTokens`，其中已包含 `reasoningTokens` |

## 数据来源与隐私

所有指标均来自 `~/.zcode/cli/rollout` 下的本地文件计算。插件**不发起任何网络请求**，数据不出本机；MCP 服务器通过 stdio 本地运行；hook 脚本限时 8 秒，任何失败静默退出。

## 开发

```bash
git clone https://github.com/zcode-plugins/token-rate
cd token-rate
node scripts/smoke-test.mjs   # 22 项检查：语法、MCP 握手、隔离环境下的 hook/CLI 行为、设置加载、语言探测与行样式
```

CI 会在每次 push 与 pull request 上运行同一组冒烟测试（Node 20 / 22 矩阵）。

目录结构、版本与发布约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © zcode-plugins
