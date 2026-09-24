<div align="center">

# 🧭 Claude Autopilot

**The right Claude model and effort level for every message — automatically.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://code.claude.com/docs/en/plugins)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](.claude-plugin/plugin.json)
[![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)](package.json)

**English** · [Italiano](README.it.md)

</div>

---

Claude Autopilot is a [Claude Code](https://code.claude.com) plugin that reads every message you send and recommends the best model — **Haiku, Sonnet, Opus or Fable** — and **effort level**, together with an estimate of how much of your plan's usage limits the task will take. In auto mode it runs the task on that model for you, with no confirmation needed. An optional permissions module replaces technical approval prompts with plain-language questions.

```
🧭 Suggested: Sonnet · low · ~0.5–1% 5h · small-code (/model sonnet)
```

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Commands](#commands)
- [The 🧭 line](#the--line)
- [Usage-limit tracking](#usage-limit-tracking)
- [Permissions module](#permissions-module)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Uninstall](#uninstall)
- [Development](#development)
- [License](#license)

## Features

- **Per-message recommendation.** The task is classified (`question`, `trivial`, `small-code`, `feature`, `multi-file`, `architecture`, `critical`), then a model and an effort level (`low` → `max`) are chosen for it.
- **Auto mode.** When another model fits better, the task is delegated to one of 16 bundled agents: Haiku, plus Sonnet, Opus and Fable, each at five effort levels. You get the result back in the main session.
- **Usage estimates that learn.** Every turn is measured against the real 5-hour and weekly usage percentages of your Pro/Max plan. Future estimates are calibrated on those measurements.
- **Ultracode hints.** Large tasks that split into independent parts get a suggestion to use ultracode. You always decide whether to type it.
- **Plain-language permissions (optional).** Safe actions run without prompts. Risky ones become a one-sentence question, and your "yes" is valid for that single action only.
- **Statusline.** Shows the model, context, 5h/7d quotas with reset time, and the autopilot mode. It can also wrap your existing statusline.
- **Zero dependencies.** Plain Node.js, 100+ tests, and all data stays on your machine.

## How it works

```
 your message ──► UserPromptSubmit hook ──► injects mode + criteria + measured averages
                                                   │
                         Claude writes the 🧭 line │ (and delegates in auto mode)
                                                   ▼
 statusline ──► records 5h / 7d usage       Stop / SubagentStop hooks ──► history.jsonl
                                                   │
 next message ◄── deltas computed from real usage ─┘   /autopilot stats
```

| Component | Role |
|---|---|
| `hooks/prompt-submit.mjs` | Applies `/autopilot` commands and injects the context for each message |
| `hooks/stop.mjs`, `hooks/subagent-stop.mjs` | Record every turn: recommendation, delegation, usage at start |
| `hooks/pre-tool-use.mjs` | Permissions module (off by default) |
| `skills/autopilot/SKILL.md` | Selection criteria, line format, delegation rules |
| `agents/` | 16 workers with `model` and `effort` preset |
| `statusline/statusline.mjs` | Statusline and usage recorder |

## Requirements

- [Claude Code](https://code.claude.com) with plugin support.
- **Node.js >= 18** on your `PATH`. The hooks are Node scripts.
- A Claude **Pro or Max** plan for estimates in % of your usage limits. Without one, estimates are given in tokens.

## Installation

Inside Claude Code:

```
/plugin marketplace add iAlias/ClaudeAutopilot
/plugin install autopilot@claude-autopilot
```

Then start a new session and run:

```
/autopilot setup
```

Setup installs the autopilot statusline. If you already have one, it asks whether to replace it or wrap it. It backs up `settings.json` and shows you the change before applying it.

## Commands

| Command | Effect |
|---|---|
| `/autopilot suggest` | Recommendation only (default) |
| `/autopilot auto` | Recommendation plus automatic delegation to the chosen model and effort |
| `/autopilot off` | Disable autopilot |
| `/autopilot permissions on` \| `off` | Enable or disable the permissions module |
| `/autopilot stats` | Estimated vs actual usage per model and effort |
| `/autopilot setup` | Install or reinstall the statusline |
| `/autopilot` | Show the current status |

Mode changes are written by the hook itself, never by Claude.

## The 🧭 line

Every reply starts with a single line:

```
🧭 Suggested: Opus · high · ~3–6% 5h · multi-file           (suggest mode)
🧭 Haiku · - · ~0.2–0.4% 5h · trivial → delegated           (auto mode)
🧭 Opus · high · ~4–8% 5h · feature → in-session (needs the conversation context)
```

| Task type | Typical choice |
|---|---|
| `trivial` — rename, reformat, find a file | Haiku |
| `small-code` — small clear edits, shell commands | Sonnet · low/medium |
| `feature` — medium features, tests | Sonnet · high or Opus · medium |
| `multi-file` — cross-file work, debugging, review | Opus · high/xhigh |
| `architecture` — new designs, hard bugs | Fable · high/xhigh |
| `critical` — correctness above cost | Opus or Fable · max |

In auto mode a task is delegated when the recommended model differs from the session model, or when the effort differs by two or more levels. It stays in the session when it depends on the conversation, needs your input, or has a short answer.

## Usage-limit tracking

The statusline records the 5-hour and weekly usage percentages that Claude Code exposes to Pro/Max subscribers. For each turn, autopilot stores the change in those percentages next to its own estimate. `/autopilot stats` compares the two.

- Measurements taken while other Claude Code sessions were active are marked and excluded from calibration.
- Negative changes, caused by a window reset, are discarded.
- Percentages are coarse, so very small tasks may show `<1%`.

## Permissions module

**Off by default.** Turn it on with `/autopilot permissions on`.

| Category | Examples | What happens |
|---|---|---|
| Safe | reads, searches, builds, tests, local git, edits inside the project | Approved silently |
| Risky | `git push`, discarding uncommitted local changes, recursive or out-of-project deletions, sending data out, global installs, credentials, system settings, running `curl … \| sh` | Blocked. Claude asks you in plain words, and a "yes" approves that one action for 10 minutes |
| Other shell commands | anything not matched above | Approved and logged to `permissions.log` |
| Deferred | MCP connectors, web fetches, plan approvals, questions | Left to Claude Code's normal permission prompts |

The module also protects its own settings. Writes to `~/.claude/autopilot/`, `settings.json` or the plugin folder are always risky, and so is running `claude -p`. This way Claude cannot approve its own actions or switch the rules off.

> **Note:** this is a heuristic safety net based on text rules, not a security boundary.

## Configuration

Custom permission rules go in `~/.claude/autopilot/permissions.json`:

```json
{
  "disabledRules": ["rm-recursive"],
  "riskyShell": [
    { "id": "no-docker", "pattern": "\\bdocker\\b", "description": "using docker" }
  ],
  "safeShell": ["^make\\b"]
}
```

Data files, all in `~/.claude/autopilot/`:

| File | Content |
|---|---|
| `state.json` | Mode, permissions flag, wrapped statusline |
| `usage.json` | Latest usage percentages per session |
| `history.jsonl` | One record per turn |
| `permissions.log` | Decisions of the permissions module |

## Privacy

Everything runs locally. Autopilot sends nothing anywhere: no telemetry and no external calls. The only extra model activity comes from the agents it delegates to, which run inside your own Claude Code session.

## Limitations

- Hooks cannot change the model of the main session. Auto mode delegates to agents instead, and delegated agents start without the conversation history, working only from a written brief.
- Haiku, as a session model, tends to ignore the 🧭 line instruction.
- Usage percentages are coarse and shared across all your sessions.

## Uninstall

```
/plugin uninstall autopilot@claude-autopilot
```

Then put back your previous `statusLine` entry in `~/.claude/settings.json`. The backup `settings.json.bak-autopilot-*` shows the old value. Finally, delete `~/.claude/autopilot/`.

## Development

```bash
git clone https://github.com/iAlias/ClaudeAutopilot.git
cd ClaudeAutopilot
npm test                 # node --test, no dependencies
npm run agents           # regenerate agents/*.md
claude plugin validate .
```

Issues and pull requests are welcome.

## License

[MIT](LICENSE) © 2026 Restore
