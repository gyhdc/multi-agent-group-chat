# Multi-Agent Group Chat

Local-first multi-role discussion workspace for structured debate, critique, and collaborative reasoning.

- 中文说明: [跳转到简体中文](#简体中文)
- English Guide: [Jump to English](#english)

---

## 简体中文

### 项目简介

`Multi-Agent Group Chat` 是一个本地优先的多角色群聊讨论网站（暂时支持windows一键启动脚本）。你可以像搭建一个研究讨论群一样，为每个角色配置身份、目标、行为准则、发言风格和模型接入方式，让他们围绕同一议题进行短句、连续、对立但有依据的讨论。

它特别适合以下场景：

- 审稿人 vs 导师
- 方法论学者 vs 领域专家
- 多角色研究组会 / 课题论证
- 需求评审 / 方案攻防 / 假设校验
- 用户在讨论中途插入新证据、新数据、新约束

系统会保留完整聊天记录，并由记录员角色生成阶段纪要与最终结论。

### 核心特性

- 本地运行，不依赖云端数据库
- 群聊式时间线展示，聊天记录是主视图
- 支持 `中文 / English` UI 切换
- 支持每个房间独立设置讨论语言、研究方向、自动播放间隔
- 支持自定义角色设定，也支持内置学术角色模板
- 支持 `mock`、`openai-compatible`、`custom-http`、`codex-cli`即API接入和本地Agent接入
- 支持保存和复用 Provider Presets
- 支持对任意历史消息发起定向回复
- 支持用户在讨论中途插话，后续角色会优先考虑该证据
- 支持记录员输出 checkpoint 和 final conclusion，并可保存重点结论

### 适合的讨论风格

这个项目并非“几个人设陪聊”。目标是让不同角色围绕同一研究目标进行更像真实学术讨论的攻防，最后完善课题的科学性，可行性：

- 每个角色有明确目标和不可轻易退让的边界
- 发言强调证据标准、评估标准、失败模式和评审风险
- 用户新提供的观点或证据拥有更高优先级
- 记录员会明确说明“用户证据是否改变了判断”

### 快速开始

#### 环境要求

- Node.js 18+
- npm
- Python 3
  - 仅在运行 `npm run smoke` 时需要

#### 安装依赖

```bash
npm install
```

#### 开发模式

```bash
npm run dev
```

默认启动后：

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:3030`

#### 构建

```bash
npm run build
```

#### 冒烟测试

```bash
npm run smoke
```

#### Windows 一键启动

- 双击 `start-local-chat.bat`
- 停止时双击 `stop-local-chat.bat`

也可以直接运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-chat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local-chat.ps1
```

### 使用方式

#### 1. 新建讨论房间

在房间中配置：

- `Title`
- `Topic`
- `Objective`
- `Discussion Language`
- `Research Direction`
- `Research Direction Note`
- `Max Rounds`
- `Auto Play Delay (seconds)`

#### 2. 配置角色

你可以为每个角色设置：

- `Role Template`
- `Name`
- `Persona`
- `Goal`
- `Strategy`
- `Voice Style`
- `Accent Color`
- `Provider Preset`

内置模板包括：

- Reviewer
- Advisor
- Methodologist
- Domain Expert
- Experimentalist
- Statistician
- Industry Skeptic
- Recorder

#### 3. 配置模型或本地 Agent

在 `Provider Presets` 中可以配置并复用接入方式。

支持的 provider：

- `mock`
  - 仅用于离线演示和界面测试
- `openai-compatible`
  - 适用于 OpenAI、Ollama、vLLM 或其他兼容 `/v1/chat/completions` 的服务
- `custom-http`
  - 适用于你自己的本地 agent bridge 或 HTTP 服务
- `codex-cli`
  - 适用于直接调用本地 Codex CLI

你可以在 `Provider Presets` 面板点击 `Guide` 按钮查看接入教程。

#### 4. 开始讨论

支持三种推进方式：

- `Start Fresh`
- `Step`
- `Auto Play`

`Auto Play` 会按照房间设置的时间间隔逐条弹出下一条消息，模拟真实群聊节奏。

#### 5. 用户中途参与

讨论运行中，用户可以：

- 在输入框中插入新的证据、数据、约束或观点
- 点击任意历史消息的 `Reply` 发起定向回复

后续角色会优先处理最新用户证据，并在必要时直接回复相关消息。

#### 6. 纪要与结论

记录员会输出：

- Checkpoint
- Final Conclusion

关键纪要支持：

- 展开查看
- 保存为重点结论

### 本地 Agent / 大模型接入说明

#### OpenAI-Compatible

最小配置：

- `Endpoint`
- `Model`
- `API Key`（如果服务需要）

例如：

- OpenAI
- Ollama 的 OpenAI 兼容接口
- vLLM 服务

#### Custom HTTP

如果你已经有自己的本地 agent 服务，推荐使用 `custom-http`。

后端会向你的 endpoint 发送：

- 房间信息
- 角色信息
- prompt payload

你的服务返回：

```json
{ "content": "下一条简短发言" }
```

也可以返回：

```json
{ "content": "下一条简短发言", "replyToMessageId": "message-id" }
```

协议详见：

- [docs/provider-contract.md](./docs/provider-contract.md)

#### Codex CLI

如果你想让某个角色直接调用本地 Codex：

- 方式 1：
  - `Command = codex`
- 方式 2：
  - `Command = npx`
  - `Launcher Args = -y @openai/codex`

适用场景：

- 你希望角色直接通过本地 CLI 执行
- 你不想自己写 HTTP bridge

#### 如何选择

- 你已经有本地 agent 服务: 用 `custom-http`
- 你希望直接调用本地 Codex CLI: 用 `codex-cli`
- 你要接 OpenAI / Ollama / vLLM: 用 `openai-compatible`
- 你只是想先演示界面和流程: 用 `mock`

推荐链路：

```text
群聊角色 -> 项目后端 provider adapter -> custom HTTP bridge 或 Codex CLI -> 本地 agent / 大模型
```

### 研究方向支持

当前内置研究方向：

- General Research
- AI / Machine Learning
- Computer Vision
- NLP / LLM
- Robotics / Systems
- Biomedical / Health
- Civil / Geotechnical
- Social Science / Policy

研究方向会影响角色的系统 prompt，使讨论更贴近该领域的证据标准、评估维度和常见失败模式。

### 项目结构

```text
backend/                 Express + orchestration server
frontend/                React + Vite web app
docs/design.md           设计说明
docs/provider-contract.md custom-http 协议
scripts/                 Windows-first local scripts
tests/smoke_test.py      Playwright 冒烟测试
data/                    本地 JSON 存储（运行时生成）
```

### 本地数据与 Git 说明

- `data/*.json` 是运行时数据，不应提交到版本库
- `output/`、`tmp/` 等运行结果默认应被忽略
- Provider API Key 建议只保存在本地，不要提交到 GitHub
- 建议使用功能分支进行后续开发

### 当前定位

这是一个本地优先、研究讨论导向的原型产品，重点是：

- 更强的角色讨论质量
- 更清晰的聊天主视图
- 更方便的本地 agent / 模型接入

如果你准备二次开发，推荐优先扩展：

- 更多角色模板
- 用户自定义研究方向库
- 更强的本地 agent bridge
- 更丰富的总结与导出能力

---

## English

### Overview

`Multi-Agent Group Chat` is a local-first discussion workspace where multiple AI roles debate the same topic in a group-chat style interface.

Each role can have its own:

- identity
- goal
- principles
- speaking style
- model or local agent connection

The app is designed for structured, evidence-driven discussion rather than loose roleplay. It works especially well for:

- reviewer vs advisor scenarios
- proposal defense and idea refinement
- research group simulations
- requirement review and adversarial discussion
- injecting new user evidence in the middle of an ongoing debate

A dedicated recorder role keeps checkpoint notes and a final conclusion.

### Key Features

- local-first architecture
- transcript-first chat UI
- manual `中文 / English` UI switch
- per-room discussion language, research direction, and auto-play delay
- custom roles plus built-in academic role templates
- reusable provider presets
- targeted reply to any previous message in the timeline
- live user intervention during a running discussion
- recorder-generated checkpoints and final conclusions
- support for `mock`, `openai-compatible`, `custom-http`, and `codex-cli`

### Discussion Philosophy

This project is not meant to produce shallow “character cosplay”.

Instead, it pushes each role to:

- defend a clear objective
- argue with evidence standards and evaluation criteria
- react to the strongest unresolved objection
- prioritize newly injected user evidence
- help the room converge on a sharper final judgment

### Quick Start

#### Requirements

- Node.js 18+
- npm
- Python 3
  - only required for `npm run smoke`

#### Install

```bash
npm install
```

#### Run in Development

```bash
npm run dev
```

Default local endpoints:

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:3030`

#### Build

```bash
npm run build
```

#### Smoke Test

```bash
npm run smoke
```

#### One-Click Startup on Windows

- Double-click `start-local-chat.bat`
- Double-click `stop-local-chat.bat` to stop it

Or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-chat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local-chat.ps1
```

### Usage Flow

#### 1. Create a Room

Each room can define:

- `Title`
- `Topic`
- `Objective`
- `Discussion Language`
- `Research Direction`
- `Research Direction Note`
- `Max Rounds`
- `Auto Play Delay (seconds)`

#### 2. Configure Roles

Each role can define:

- `Role Template`
- `Name`
- `Persona`
- `Goal`
- `Strategy`
- `Voice Style`
- `Accent Color`
- `Provider Preset`

Built-in role templates:

- Reviewer
- Advisor
- Methodologist
- Domain Expert
- Experimentalist
- Statistician
- Industry Skeptic
- Recorder

#### 3. Connect a Model or Local Agent

The `Provider Presets` panel lets you save and reuse model or agent connection settings.

Supported providers:

- `mock`
  - offline demo mode
- `openai-compatible`
  - any `/v1/chat/completions` compatible endpoint
- `custom-http`
  - your own local agent bridge or HTTP service
- `codex-cli`
  - direct local Codex CLI execution

Use the `Guide` button in the `Provider Presets` panel for connection instructions.

#### 4. Run the Discussion

Available controls:

- `Start Fresh`
- `Step`
- `Auto Play`

`Auto Play` reveals one new message at a time using the per-room delay, which makes the discussion feel closer to a real group chat.

#### 5. Intervene as the User

While the room is running, the user can:

- inject new evidence, constraints, or data
- reply to a specific previous message

Subsequent participants are prompted to prioritize that newest user evidence first.

#### 6. Review Notes and Final Verdict

The recorder role produces:

- checkpoints
- final conclusion

Important notes can be expanded and saved.

### Connecting Local Agents and Models

#### OpenAI-Compatible

Minimum setup:

- `Endpoint`
- `Model`
- `API Key` if required

Useful for:

- OpenAI
- Ollama OpenAI-compatible endpoints
- vLLM
- similar model servers

#### Custom HTTP

Use `custom-http` if you already have a local agent bridge or your own HTTP-based orchestration service.

The backend sends:

- room context
- role configuration
- prompt payload

Your service can return:

```json
{ "content": "The next short message." }
```

Or:

```json
{ "content": "The next short message.", "replyToMessageId": "message-id" }
```

Contract details:

- [docs/provider-contract.md](./docs/provider-contract.md)

#### Codex CLI

Use `codex-cli` when a role should directly call a local Codex installation.

Typical setup:

- Option 1:
  - `Command = codex`
- Option 2:
  - `Command = npx`
  - `Launcher Args = -y @openai/codex`

Best when:

- you want direct local CLI execution
- you do not want to build a custom HTTP bridge

#### Which Provider Should You Choose?

- Already have a local agent server: use `custom-http`
- Want to call Codex locally: use `codex-cli`
- Want OpenAI / Ollama / vLLM compatibility: use `openai-compatible`
- Want an offline demo: use `mock`

Recommended flow:

```text
chat role -> backend provider adapter -> custom HTTP bridge or Codex CLI -> local agent / model
```

### Research Direction Profiles

Built-in directions:

- General Research
- AI / Machine Learning
- Computer Vision
- NLP / LLM
- Robotics / Systems
- Biomedical / Health
- Civil / Geotechnical
- Social Science / Policy

The selected research direction shapes the prompting strategy so the debate uses more domain-appropriate evaluation criteria, evidence standards, and failure modes.

### Project Structure

```text
backend/                  Express + orchestration server
frontend/                 React + Vite web app
docs/design.md            design notes
docs/provider-contract.md custom HTTP bridge contract
scripts/                  Windows-first local scripts
tests/smoke_test.py       Playwright smoke test
data/                     runtime-generated local JSON storage
```

### Local Data and Git Notes

- `data/*.json` contains runtime state and should not be committed
- `output/` and `tmp/` should remain ignored
- keep provider API keys local
- use feature branches for further development

### Project Positioning

This repository is intended as a practical, local-first product prototype focused on:

- stronger multi-role discussion quality
- transcript-first interaction
- local agent and model integration

Good next extensions would be:

- more role templates
- user-defined research direction libraries
- stronger local agent bridges
- richer export and summary workflows
