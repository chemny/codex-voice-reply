# Voice Reply

中文 | [English](./README.en.md)

Voice Reply 是一个面向 Claude Code 用户、Codex 用户和 Agent 用户的**语音回应** skill。它给你的编码 Agent 装上一张"嘴"：你一发消息，它立刻应一声；它干完活，再用一句话把结果说给你听——让你不用一直盯着屏幕也知道进度。

它支持**按输入类型的即时开场提示**、**模型亲自撰写的结果播报**和**双 Agent 不同音色区分**，也可以一条命令完成安装、跨平台播放、离线秒回。

## 适合谁使用？

这个 skill 适合：

- 经常让 Claude Code / Codex 跑长任务、不想干等屏幕的人
- 同时开多个 Agent、想"听声辨人"知道是谁干完了的人
- 想给自己的 Agent 工作流加一层语音反馈的人

## 它能做什么？

每一轮对话，Voice Reply 在两个时刻发声：

- **开场提示**：你一提交，hook 立刻按你这句话的类型播一句即时回应——提问 →「我看看」、指令 →「好，这就做」、判不准 →「收到」。它在模型读懂你的话之前触发，所以只确认收到、不假装回答。固定词预先合成成 mp3 缓存，离线、不到 1 秒就出声。
- **结果播报**：这一轮结束时，把模型自己写的一句话总结（状态 + 核心信息 + 下一步）念出来。这是"真正的回应"，可以带上真答案（对/错、一个数字、"改好了，记得重启"）。

"说什么"的智能在模型，不在脚本：模型在每轮结尾写一行 `<<voice: ...>>`，hook 只负责把它抠出来念。缺了这行，就退回关键词打分兜底。

## 核心能力

| 能力 | 处理内容 | 输出结果 |
|---|---|---|
| 即时开场提示 | 按输入类型粗判（提问/指令/其它） | 缓存语音，离线、<1 秒、后台不阻塞 |
| 结果播报 | 模型撰写的 `<<voice:>>` 标记，缺失则关键词打分 | 一句话说清状态 + 核心信息 + 下一步 |
| 双 Agent 音色 | Claude 男声、Codex 女声 | 听声辨别是谁在说话 |
| 通用开场规则 | `scripts/opening.mjs` 单一事实源 | 改一处，Claude 和 Codex 同时生效 |

## 平台兼容性

| 平台 | 状态 |
|---|---|
| Claude Code | ✅ 已支持（`~/.claude/settings.json` hooks） |
| Codex | ✅ 已支持（`~/.codex/hooks.json`） |
| OpenClaw | ⚪ 未实测 |

播放层支持 macOS（`afplay`）与 Linux/Windows（`ffplay`/`mpv`/`mpg123`）。

## 安装

```bash
git clone https://github.com/chemny/voice-reply ~/.agents/skills/voice-reply
cd ~/.agents/skills/voice-reply
./setup.sh
```

`setup.sh` 会：创建 Python 虚拟环境并安装 edge-tts、生成两个音色的开场缓存、把默认配置写进 `~/.voice-reply/`，并在**征得你同意后**把 hooks 安全合并进 `~/.claude/settings.json` 和 `~/.codex/hooks.json`（先备份、不覆盖你已有的 hooks）。然后按提示把"播报标记规则"加进你的 Agent 指令文件，并**重启 Agent 会话**。

## 快速开始

安装并重启会话后，随便发一句话：

- 发问题 → 立刻听到「我看看」，答完听到结论（如「对」）。
- 下指令 → 立刻听到「好，这就做」，干完听到「改好了，记得重启」。

手动验证（不依赖 hook）：

```bash
node scripts/speak.mjs done
./test.sh        # 干跑回归检查（无音频、无网络）
```

## 使用示例

```bash
# 念一句话
node scripts/speak.mjs text --text "改好了，记得重启。" --full

# 念一个已有音频文件（跨平台播放器）
node scripts/speak.mjs play --file ~/.voice-reply/cache/opening-question-zh-CN-YunxiNeural.mp3

# 预览将朗读的文本与依赖状态，不出声
node scripts/speak.mjs summary --text "修复了参数解析并通过校验。" --dry-run
```

模型每轮结尾写的播报标记长这样：

```text
<<voice: 改好了，记得重启会话生效>>
```

## 工作原理

| 时刻 | 谁决定说什么 | 你听到 |
|---|---|---|
| 你提交 | hook 按关键词粗判输入类型（`scripts/opening.mjs`，两个 Agent 共用） | 我看看 / 好，这就做 / 收到 |
| Agent 答完 | **模型**写 `<<voice: …>>` 标记 | 真正的结论；缺标记则退回关键词打分 |

hook 脚本本身是"复读机"——只负责播放。播放在后台进行，hook ~200ms 返回，绝不阻塞 Agent。朗读文本硬上限 60 字。

## 仓库结构

```text
voice-reply/
├── scripts/
│   ├── speak.mjs        # 核心：文本 → Edge TTS mp3 → 跨平台播放
│   ├── opening.mjs      # 共享的开场提示规则（两个 Agent 共用）
│   ├── claude-hook.mjs  # Claude Code hook 入口
│   ├── codex-hook.mjs   # Codex hook 入口
│   ├── codex-notify.mjs # Codex notify 兜底
│   └── manage-hooks.mjs # 幂等地安装/卸载 hooks（先备份）
├── setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.en.md / LICENSE / .gitignore
└── agents/openai.yaml
```

运行时数据在 `~/.voice-reply/`：`config.json`（音色/语速/音量）、`hooks.json`（开关与固定文案）、`cache/`（开场缓存）。

## 运行要求

- Node 18+
- Python 3（用于运行 edge-tts，安装在本地 venv）
- 音频播放器：macOS 自带 `afplay`，或 Linux/Windows 上的 `ffplay` / `mpv` / `mpg123`
- 网络（[edge-tts](https://github.com/rany2/edge-tts) 使用微软的语音端点）

开场分类器与默认开场词为**中文**，改其他语言可编辑 `scripts/opening.mjs` 里的正则与短语。

## 协议

[MIT](LICENSE)
