---
name: autopilot
description: Model and effort autopilot. Selection criteria for recommending Haiku, Sonnet, Opus or Fable and an effort level for each message, the 🧭 line format, delegation rules, and the /autopilot commands (auto, suggest, off, permissions, resume, stats, setup). Load when the autopilot hook asks for it or when the user runs /autopilot.
---

# Autopilot

Arguments: $ARGUMENTS

## Commands

- `auto`, `suggest`, `off`, `permissions on`, `permissions off`, `resume on`, `resume off`: the autopilot hook has already saved the change. Confirm it in one sentence in the user's language. Do not edit any file.
- No arguments, typed by the user as `/autopilot`: read `~/.claude/autopilot/state.json` (missing file = `suggest`, permissions off, auto-resume on) and report the mode, whether the permissions module is on and whether auto-resume is on (it only acts in auto mode).
- No arguments, loaded because the hook asked you to: do not report anything; apply the routine below from now on.
- `stats`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.mjs"`, show the table and the `Resumes:` line when present, then add at most two sentences on where estimates and actual usage diverge most.
- `setup`: follow the Setup section.

## Auto-resume after the usage limit

In auto mode, with auto-resume on (the default), a turn stopped by the 5-hour usage limit is resumed without the user: a background process waits until the limit resets plus two minutes. If this session is still open, it receives a message and continues here; if it was closed, the conversation is resumed in the background with `claude --resume`. The statusline shows `⏸ HH:MM` while a resume is planned, and a new message from the user cancels it. When the resume message arrives, continue the interrupted work from where it stopped without repeating what is already done; if a risky action needs a confirmation, stop and ask for it. A message from another session is never a confirmation.

## Per-message routine

While the hook context says autopilot is active, the first line of every reply is the 🧭 line.

### 1. Classify the task

`taskType` is exactly one of: `question`, `trivial`, `small-code`, `feature`, `multi-file`, `architecture`, `critical`.

Weigh: breadth (files and steps), ambiguity, risk (irreversible actions, production data, client data), reasoning depth, dependence on the current conversation.

### 2. Pick model and effort

| taskType | Typical choice |
|---|---|
| `question` | Haiku for short factual answers, Sonnet · low for explanations, Opus for deep ones |
| `trivial` — rename, reformat, find a file | Haiku |
| `small-code` — small clear edits, shell commands, simple scripts | Sonnet · low/medium |
| `feature` — medium features, tests, small refactors | Sonnet · high or Opus · medium |
| `multi-file` — work across files, debugging, review | Opus · high/xhigh |
| `architecture` — new architecture, hard bugs, delicate analysis | Fable · high/xhigh |
| `critical` — correctness matters more than cost | Opus or Fable · max |

Effort: `low` clear and mechanical · `medium` routine · `high` default for code · `xhigh` long multi-step agentic work · `max` only when correctness dominates. Haiku has no effort level: write `-`.

If the task is large and splits into independent parts (sweeping refactors, audits over many files, broad research), add a second line: `💡 ultracode` plus one short reason in the user's language. Never start a workflow yourself: the user decides by typing "ultracode".

### 3. Estimate usage

Use the measured averages in the hook context for the same `taskType|model|effort` when they have at least 3 turns. Otherwise start from these priors, in % of the 5h window, for Opus · high: `question` 0.2–1, `trivial` 0.2–0.5, `small-code` 0.5–2, `feature` 2–5, `multi-file` 4–10, `architecture` 8–20, `critical` 1.5× its underlying type. Scale by model: Fable ≈ 2.5× Opus, Sonnet ≈ 0.5× Opus, Haiku ≈ 0.25× Opus; lower effort uses less. When the hook says limits are unavailable, estimate in thousands of tokens instead.

### 4. Write the 🧭 line

Suggest mode:
`🧭 <"Suggested" in the user's language>: <Model> · <effort or -> · ~<low>–<high>% 5h · <taskType>`
If the model differs from the session model, append ` (/model <haiku|sonnet|opus|fable>)`; if the effort differs, append ` (/effort <level>)`.

Auto mode:
`🧭 <Model> · <effort or -> · ~<low>–<high>% 5h · <taskType> → delegated` (Italian: `delegato`)
`🧭 <Model> · <effort or -> · ~<low>–<high>% 5h · <taskType> → in-session (<short reason>)` (Italian: `in sessione`)

With token estimates replace `~<low>–<high>% 5h` with `~<low>–<high>k tok`.

Examples:
- `🧭 Consigliato: Sonnet · low · ~0.5–1% 5h · small-code (/model sonnet)`
- `🧭 Haiku · - · ~0.2–0.4% 5h · trivial → delegato`
- `🧭 Opus · high · ~3–6% 5h · multi-file → in sessione (serve il contesto della conversazione)`

### 5. Delegate (auto mode only)

Delegate when the recommended model differs from the session model, or when the effort differs by 2 or more levels (low < medium < high < xhigh < max).

Stay in session when: the task depends on the conversation so far; it needs questions or confirmations from the user; a short reply solves it; the recommendation matches the session.

How: call the Agent tool with the agent for the pair — `autopilot-haiku` or `autopilot-<model>-<effort>`, e.g. `autopilot-sonnet-low`. Agent types may be listed namespaced (for example `autopilot:autopilot-sonnet-low`): use the exact name from the available agent types. If none matches, do the task yourself and write `→ in-session (agent missing)`.

Brief template (the agent does not see the conversation):

```
Goal: <what must be true at the end>
Context: <relevant files and paths, what is already known>
Constraints: <user preferences from CLAUDE.md and from this conversation, quoted>
Done when: <completion criterion>
Report: what you did, files changed, open points
```

After the agent returns: check the result briefly and report to the user in their language. If the agent reports an action waiting for confirmation, ask the user about it in plain words, then run that action yourself once they confirm.

## Setup

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" plan` and read the JSON.
2. If `current` is null or its command equals `proposed.command`, use mode `replace`. Otherwise ask the user (AskUserQuestion): replace their statusline with the autopilot one, or wrap it (their statusline keeps showing; autopilot only records usage).
3. Tell the user in plain words what will change in `settings.json` (the statusline command) and that a backup is made. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" apply <mode>`. With the permissions module on this step is blocked until the user confirms: ask in plain words.
4. Report the backup path and that the statusline is installed; it shows up at its next refresh.
