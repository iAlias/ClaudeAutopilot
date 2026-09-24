<div align="center">

# 🧭 Claude Autopilot

**The right Claude model and effort level for every message — automatically.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://code.claude.com/docs/en/plugins)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](.claude-plugin/plugin.json)
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
- [Auto-resume after the usage limit](#auto-resume-after-the-usage-limit)
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
- **Auto-resume.** In auto mode, work stopped by the 5-hour usage limit picks up again by itself once the limit resets, in the open window or in the background.
- **Plain-language permissions (optional).** Safe actions run without prompts. Risky ones become a one-sentence question, and one "yes" unlocks all the actions waiting in that turn, for 30 minutes.
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
| `hooks/stop-failure.mjs` | Plans a resume when a turn stops at the usage limit |
| `scripts/resumer.mjs` | Waits for the reset and resumes the session |
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
| `/autopilot resume on` \| `off` | Enable or disable auto-resume after the usage limit (on by default, acts in auto mode only) |
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

## Auto-resume after the usage limit

In auto mode, when a turn stops because the 5-hour usage limit is reached, autopilot resumes the work by itself once the limit resets. It is on by default; turn it off with `/autopilot resume off`.

1. The `StopFailure` hook (`hooks/stop-failure.mjs`, matcher `rate_limit`) records the session in `resume.json`, with the reset time taken from the statusline, and starts `scripts/resumer.mjs` as a detached background process.
2. The resumer waits until the reset plus two minutes, checking once a minute. Meanwhile the statusline of that session shows `⏸ HH:MM` with the planned time.
3. At that time:
   - **session still open** → a short Haiku run sends the session a local message, and the session continues in front of you. The message counts as sent only if the run ends with the line `AUTOPILOT_RESUME_SENT`, and the run is stopped after 5 minutes;
   - **session closed** → the conversation is resumed in the background with `claude --resume <id> -p`, in its original folder. This run has no time limit: it runs until Claude is done.
4. The outcome is saved in `resume.json` and `resume.log`, and `/autopilot stats` counts it. A resume whose background process died without finishing is counted as lost.

The resume message asks Claude to continue from where it stopped, without repeating what is already done. It is written in the language of your last message (Italian or English).

Safeguards:

- A resume is planned only for a real 5-hour limit: the statusline reading must be less than 15 minutes old and show the 5-hour window at 95% or more, the weekly limit below 100% and a reset time still to come. Any other stop is only noted in `resume.log`.
- One planned resume per session. A further limit hit only moves the planned time.
- At most two automatic resumes in a row per session. The count starts again when you write to the session.
- If you write to the session before the reset, the planned resume is cancelled.
- Switching to `suggest` or `off`, or running `/autopilot resume off`, cancels a waiting resume at its next check.
- If the weekly limit is still exhausted at the reset, the resume is skipped and recorded. It is also skipped if the resumer wakes up more than 6 hours after the reset, or failed if the session folder no longer exists.
- If the message to an open session is not confirmed, the work is resumed in the background only when the session has been closed in the meantime; otherwise the resume is recorded as failed, so the session never gets the work twice.
- A message from another session never counts as a confirmation of a risky action.

### Permissions in a background resume

Nobody is there to answer, so the background run uses the permission mode the session had. The only exception is `bypassPermissions`, which becomes `default`.

- **Permissions module off:** Claude Code's own prompts cannot be shown in a headless run, so anything that would need your approval is denied.
- **Permissions module on:** safe actions run as usual, and risky ones stay blocked until you confirm them in the session. Claude stops and says what is waiting.

## Permissions module

**Off by default.** Turn it on with `/autopilot permissions on`.

| Category | Examples | What happens |
|---|---|---|
| Safe | reads, searches, builds, tests, local git, edits inside the project | Approved silently |
| Risky | `git push`, discarding uncommitted local changes, recursive or out-of-project deletions, sending data out, global installs, credentials, system settings, running `curl … \| sh` | Blocked. Claude asks you in plain words, and a "yes" approves the actions blocked in that turn for 30 minutes |
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
| `state.json` | Mode, permissions flag, auto-resume flag, wrapped statusline |
| `usage.json` | Latest usage percentages per session |
| `history.jsonl` | One record per turn |
| `permissions.log` | Decisions of the permissions module |
| `resume.json` | Planned and finished resumes per session |
| `resume.log` | One line per resume outcome |

## Privacy

Everything runs locally. Autopilot sends nothing anywhere: no telemetry and no external calls. The only extra model activity comes from the agents it delegates to, which run inside your own Claude Code session, and from auto-resume, which starts `claude` on your machine with your own account.

## Limitations

- Hooks cannot change the model of the main session. Auto mode delegates to agents instead, and delegated agents start without the conversation history, working only from a written brief.
- Haiku, as a session model, tends to ignore the 🧭 line instruction.
- Usage percentages are coarse and shared across all your sessions.
- Auto-resume only works while the PC is on and the resumer process is running. After a reboot, the planned resume is lost and is closed at your next message.
- Auto-resume covers the 5-hour window only. It cannot be tried on demand against a real limit, and its open-window path relies on messages between Claude Code sessions.

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
