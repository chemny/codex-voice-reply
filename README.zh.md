# Codex Voice Reply

[English](./README.md) | 中文

**和你的 AI 用语音双向沟通——不用再盯着屏幕等。**

Codex Voice Reply 让编码 Agent 不只是"干完报一句结论"：你一发话它立刻应声；它干完一件事，会把**这一步需要你拍板的选择**说给你听；你回一句，它接着往下做。一来一回，像在对话——眼睛解放了，方向盘还在你手里。

支持 **Claude Code 和 Codex**，并提供 **OpenClaw / Hermes 实验性适配**；支持**中英文（安装时选定并锁定，也可选按消息自动切换）**、即时开场提示、决策优先的结果播报、不同运行时音色；由 Agent 负责安装、跨平台播放、离线秒回。

## 适合谁使用？

这个 skill 适合：

- 经常让 Claude Code / Codex 跑长任务、不想干等屏幕的人
- 同时使用 Claude Code 和 Codex、希望用不同音色区分运行时的人
- 想给自己的 Agent 工作流加一层语音反馈的人

## 它能做什么？

每一轮对话，Codex Voice Reply 在两个时刻发声：

- **开场提示**：你一提交，hook 立刻按你这句话的**语种和类型**播一句即时回应——中文「我看看 / 好，这就做 / 收到」，英文 "Let me look / On it / Got it"。它在模型读懂你的话之前触发，所以只确认收到、不假装回答。固定词预先合成成 mp3 缓存，离线、不到 1 秒就出声。
- **结果播报**：这一轮结束时，把模型写的一句话念出来——可能是结论，**也可能是这一步要你拍板的选择（决策优先）**。你听到就能直接回、接着往下推，把"单向播报"变成"双向对话"。可带真答案（对/错、一个数字、"改好了，记得重启"），并按回答语种自动选中/英文音色。

结束播报只认显式语音标签。主 Agent 在最终回复中生成一个
`<<voice: ...>>` 标签（部分运行时也支持隐藏的 `<!-- voice: ... -->` 形式）
才会授权播放；没有标签就保持静默。

## 核心能力

| 能力 | 它能帮你做什么 |
|---|---|
| 即时开场提示 | 你一提交任务就马上出声回应，让你知道 Agent 已经开始处理。 |
| 结果语音播报 | Agent 完成后只朗读最终 `voice` 标记，避免把长正文或过程状态念出来。 |
| 决策优先提醒 | 如果结果需要你确认、选择或继续拍板，会优先把下一步说清楚。 |
| 中英文语音 | 支持固定中文、固定英文，或根据每条消息自动切换语言。 |
| 运行时声音区分 | Claude Code 和 Codex 使用不同音色，内部子 Agent 则保持静默。 |

## 平台兼容性

| 平台 | 状态 |
|---|---|
| Claude Code | ✅ 已支持（`~/.claude/settings.json` hooks） |
| Codex | ✅ 已支持（`~/.codex/hooks.json`） |
| OpenClaw | 🧪 实验性支持（`adapters/openclaw`） |
| Hermes | 🧪 实验性支持（`adapters/hermes`，`~/.hermes/config.yaml` shell hooks） |

Windows 播放已经实测。macOS（`afplay`）和 Linux（`ffplay`/`mpv`/`mpg123`）
已完成实现支持，但本版本尚未进行真实运行测试。

## 安装

把下面这段话发给你当前使用的 Agent：

```text
帮我安装这个 Skill：
https://github.com/chemny/codex-voice-reply
```

Agent 会判断操作系统、安装依赖、注册可用 Hook、运行自检并验证声音。
Codex 可能会要求你通过 `/hooks` 一次性批准 `UserPromptSubmit` 和 `Stop`。

## 快速开始

安装并重启会话后，随便发一句话：

- 发问题 → 立刻听到「我看看」，答完听到结论（如「对」）。
- 下指令 → 立刻听到「好，这就做」，干完听到「改好了，记得重启」。

安装结束会自动播放测试音，并输出每一项检查结果。

## 使用示例

结果播报只来自最终显式标签。Codex 使用 `<<voice: ...>>`；部分适配器也
支持隐藏的 `<!-- voice: ... -->`。没有标签就不会播放结束语音。

## 工作原理

| 时刻 | 谁决定说什么 | 你听到 |
|---|---|---|
| 你提交 | hook 按关键词粗判输入类型（`scripts/opening.mjs`，两个 Agent 共用） | 我看看 / 好，这就做 / 收到 |
| Agent 答完 | **模型**写 `<<voice: …>>` 标记 | 真正的结论；缺标记则静默 |

### 多 Agent 模式

默认启用 `multiAgentMode: "root-only"`：只有直接面向用户的主 Agent
播报开场和最终结果。主 Agent派发子任务时在消息开头加入
`[voice-silent-subagent]`，子 Agent、并行评审和内部协作事件全部静默，
最后由主 Agent汇总后播报一次。开场事件另有 3 秒去重窗口，用于压制
多个 Agent同时启动时的重复确认音。

已识别的后台记忆维护提示默认也保持静默，避免内部整理任务触发开场音。

开场和结束采用两套独立规则：开场没有语音标签，由 Hook 判断主/子
Agent并去重；结束时，`<<voice: ...>>` 是“允许直接播给用户”的授权标签，
只有主 Agent完成汇总后可以生成。子 Agent过滤仍保留为第二道保险。

开场语言与结果音色相互独立：`lang` 只锁定开场语言，结果默认通过
`resultLang: "auto"` 根据语音标签内容自动选择中英文音色。`hook.log`
记录事件判断，`playback.log` 记录合成和播放器是否真正成功；两个日志
超过 5 MB 后自动轮转，最多保留三份备份。

Windows 可运行 `powershell -ExecutionPolicy Bypass -File uninstall.ps1` 只移除
Hook并保留数据；增加 `-RemoveData` 时，配置、缓存和日志会移动到带时间戳
的备份目录，而不是直接删除。

hook 脚本本身是"复读机"——只负责播放。播放在后台进行，hook ~200ms 返回，绝不阻塞 Agent。朗读文本硬上限 60 字。

## 仓库结构

```text
codex-voice-reply/
├── scripts/
│   ├── speak.mjs        # 核心：文本 → Edge TTS mp3 → 跨平台播放
│   ├── opening.mjs      # 共享的开场提示规则（两个 Agent 共用）
│   ├── claude-hook.mjs  # Claude Code hook 入口
│   ├── codex-hook.mjs   # Codex hook 入口
│   ├── codex-notify.mjs # Codex notify 兜底
│   ├── manage-hooks.mjs # 幂等地安装/卸载 hooks（先备份）
│   ├── manage-notify.mjs# 添加/移除 Codex notify 兜底
│   └── doctor.mjs       # 检查依赖、Hook、缓存和播放
├── adapters/
│   ├── openclaw/        # OpenClaw hook 适配
│   └── hermes/          # Hermes shell-hook 适配
├── install.sh / install.ps1 / setup.sh
├── uninstall.sh / uninstall.ps1 / test.sh
├── SKILL.md / README.md / README.zh.md / LICENSE / .gitignore
└── agents/openai.yaml
```

运行时数据在 `~/.voice-reply/`：`config.json`（音色/语速/音量）、
`hooks.json`（开关与固定文案）、`cache/`（开场缓存）、`hook.log`
（事件判断）和 `playback.log`（合成及播放器结果）。

## 运行要求

- Node 18+
- Python 3（用于运行 edge-tts，安装在本地 venv）
- 音频播放器：macOS 自带 `afplay`，或 Linux/Windows 上的 `ffplay` / `mpv` / `mpg123`
- 网络（[edge-tts](https://github.com/rany2/edge-tts) 使用微软的语音端点）

内置**中文 + 英文**两套开场词与分类规则。安装时可选择固定中文、固定英文，或按每条消息自动切换。加更多语言可扩展 `scripts/opening.mjs` 的语言包。

## 没声音？

先跑自检,它会逐项告诉你哪一环断了：

```bash
node scripts/doctor.mjs
```

常见原因：

- **装完没重启 agent** —— hook 在会话启动时加载,改完必须重启 Claude Code / Codex。
- **没装播放器**(Linux/Windows)—— 装 `ffplay`(ffmpeg)、`mpv` 或 `mpg123`;macOS 自带 `afplay`。
- **hook 没注册,或命令路径被加了引号** —— 重新运行一键安装命令,会把 hook 写成正确格式。
- **Codex 这个版本不支持 hooks**(部分旧版 / 某些 Windows 构建)—— 用 `notify` 兜底:`node scripts/manage-notify.mjs add "$(pwd)"`,然后重启 Codex。它接管 Codex 的 `notify`(会**保留并链式调用**你原有的 notify),**只在"完成"时播报 voice 标记、没有开场提示**。
- **edge-tts 没装上** —— 重新运行一键安装命令(需要 python3 + 网络)。

## 实验性适配

OpenClaw 和 Hermes 复用 Claude Code / Codex 同一套规则：

- 开场提示：按用户输入粗判语种和类型，播一句即时回应；
- 结果播报：只播显式 `<<voice: ...>>` 标记；
- 缺少标记：保持静默。

OpenClaw 文件在 `adapters/openclaw`。Hermes 文件在 `adapters/hermes`，通过
`~/.hermes/config.yaml` 配置 hook 命令。两者目前标为实验性，等更多安装环境验证事件载荷后再升级为正式支持。

安装流程结尾会自动跑一次 doctor 并播一句测试音,听到就说明声音正常。

## 协议

[Apache License 2.0](LICENSE)
