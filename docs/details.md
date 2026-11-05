# ICE in detail

Reference material that the [README](../README.md) keeps out of the way.

## Driving sessions from ICE

**＋ New session** starts a session that ICE owns. Choose the agent (**Claude Code** or **OpenCode**), the working directory and a first message.

- **Claude Code** runs through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript), using your existing `claude` login and your user and project settings.
- **OpenCode**: ICE starts its **own** `opencode serve` (loopback only, random port, random password kept in memory) and drives it through OpenCode's documented REST API. It uses your last-used model and your OpenCode config, and shares OpenCode's database with your other OpenCode processes; ICE never writes to that database itself. Requires the `opencode` CLI on your `PATH` (or `~/.opencode/bin/opencode`, or `ICE_OPENCODE_BIN`).

In the modal of such a session you get a message box, an *Interrupt* button and, when the agent needs permission or asks a question (`AskUserQuestion`), an **Allow / Deny** or answer panel.

Options in the new-session dialog:

- **Auto-allow** (on by default): accepts permission prompts automatically. It only replaces the prompt: your deny rules and hooks still run first, and `AskUserQuestion` and plan approval (`ExitPlanMode`) always wait for you.
- **Claude in Chrome** (on by default, Claude Code only): gives the session the `claude-in-chrome` tools, as in an interactive terminal (ICE passes `--chrome`). Requires the Claude in Chrome extension signed in. The agent's browser use still goes through permission prompts.

### Reading a conversation

The modal renders messages as Markdown (headings, lists, tables, code blocks, links; raw HTML is never rendered and only `http(s)` and `mailto` links are clickable). **Tool calls and their results are hidden by default**: the **Tools** button in the header shows them, says how many are hidden, and remembers the choice in the browser. Questions the agent asks you (`AskUserQuestion`, plan approval) are never hidden. Claude Code records slash commands as pseudo-XML (`<command-name>`, `<command-args>`, `<local-command-stdout>`): ICE shows `/goal your text` as you typed it, treats the command's output as a (hidden) result and drops the boilerplate caveat; the same applies to the *Latest prompts* list and the session title.

### Images and slash commands

In the message box of a session:

- **Images.** Paste (⌘V / Ctrl+V), drop or pick up to 5 images (PNG, JPEG, GIF, WebP; 5 MB each) and send them with or without text. Larger screenshots are shrunk in the browser first. ICE checks the type, the size and the file signature on the server before passing them on: as image blocks to Claude Code, as `file` parts to OpenCode. The model must accept images (some OpenCode models do not, and say so). Works when sending to a hosted session, when resuming a finished one and in the first message of a new session. Pasting works anywhere in the dialog, not only with the cursor in the box. The transcript shows attached images as a note, not the picture.
- **Slash commands.** Type `/` at the start of the message to get a menu (↑ ↓, Tab or Enter to pick, Esc closes it). The list comes from the live session: for Claude Code your skills, custom commands and plugin commands, plus the few built-ins that work outside a terminal (`/compact`, `/context`, `/goal`, `/rename`); for OpenCode its commands, skills and MCP prompts. Claude Code runs `/name args` natively; for OpenCode, ICE runs a known `/name args` through OpenCode's command API. It appears in the message box, the resume box and the new-session dialog. For a session ICE hosts the list is read from the live process; otherwise ICE reads it for the session's (or the chosen) directory, which for Claude Code starts a throwaway process that is closed at once (no model call, no cost). If the list cannot be read, the menu says why.

### Message templates

Editable before sending (`web/src/templates.ts`). They use the GitHub CLI, so `gh` must be signed in; the issue list comes from `gh issue list` in the chosen directory.

| Template | What the agent is asked to do |
|---|---|
| **Open issues and PRs** | Read-only status report: ready / blocked / no-PR grouping and a suggested order |
| **Implement issues and close PRs** | Merge healthy PRs, implement every open issue without a PR on its own branch, never deploy |
| **Implement an issue and deploy** | One issue end to end (pick it from a list). Tick **PRE** and/or **PRO**; PRO implies PRE, and the agent stops and asks if a production run waits for approval |
| **New issue and implement** | Type what you want in any language. The agent writes the English issue, branches, then loops build → test → run it → self-review → harden until two review passes find nothing. It logs progress as issue comments so the work survives context compaction, opens and merges the PR, and optionally deploys to PRE/PRO |
| **Custom** | Your own message |

### Sessions survive restarts of ICE

Hosted sessions are owned by a separate **host daemon** (`server/hostd.ts`) that ICE starts on demand, detached, and talks to over an owner-only unix socket (`~/.local/state/ice/hostd.sock`, override with `ICE_HOSTD_SOCKET`). Restarting or crashing the web server, or reloading `npm run dev`, leaves running sessions and pending permission requests as they were.

- The daemon exits by itself after 30 idle minutes with no sessions.
- `npm run hostd:stop` stops it explicitly (this ends its sessions; transcripts stay). **After updating ICE, run it once** so the daemon picks up the new code.
- Logs: `~/.local/state/ice/hostd.log`.
- The daemon protocol changes when ICE adds daemon features (images and commands did): an older daemon is detected and ICE asks you to run `npm run hostd:stop` once.

### Resume and hand off

- **Resume a finished session**: open its modal, type a message and press *Resume and send*. ICE continues the same session and transcript through the daemon. It refuses sessions still running in a terminal (two writers on one transcript) and warns that the first turn reloads the whole context and can cost more. For OpenCode, a session counts as busy elsewhere only if it was active in the last minute (OpenCode has no "is a terminal using this?" signal).
- **Continue in terminal**: ICE releases the session (stops its own process, so there is never a second writer) and shows the command to paste into a terminal: `cd <dir> && claude --resume <id> --remote-control` or `opencode --session <id>`. To bring it back to ICE, close it in the terminal and use *Resume and send*.

### Rename

The ✎ next to the name in the modal. For Claude Code, ICE uses the SDK's `renameSession` (it appends the same `custom-title` entry `/rename` writes); for OpenCode, it patches the title through the OpenCode API. The name shows up in the real tool, in the cells and in ⌘K. A Claude session running in a terminal cannot be renamed from ICE (that process would write its old name back): use `/rename` there. Names set with `/rename` are shown instead of the generated title.

### Remote Control indicator

A live Claude Code session that has [Remote Control](https://code.claude.com/docs/en/remote-control) on shows a green broadcast icon in its cell and modal, linking to the session in claude.ai. ICE reads it from the session registry (`bridgeSessionId`), so toggling it in the terminal (`/remote-control`) shows up within seconds.

ICE **cannot switch Remote Control on or off itself**: the Agent SDK has no call for it, the slash command is not available in SDK sessions, and the `remoteControlAtStartup` setting is ignored there (all three checked). Sessions hosted by ICE therefore never have it. To get it on an ICE session, use *Continue in terminal* and its `--remote-control` command.

## What a cell shows

| Panel | Contents |
|---|---|
| **Flow** | Workflow running for the session's branch, its stage (waiting for a runner, running, deploying, waiting for approval), current and next step, time in flow, time queued, **typical vs. elapsed** time, **ETA** (or overrun), iteration number, failed runs, and whether the agent is likely to keep iterating |
| **Session** | Running time, idle time and idle share; the 8-hour working-vs-idle strip (10-minute buckets); then agent working time, turns, errors; tokens, compactions, cost (total and by model) |
| **Pull requests** | Linked PRs and latest prompts |

The **status** answers "what is this session doing?": *Agent working* (no flow involved), *Waiting: runner / approval*, *In flow*, *Deploying*, *Agent + flow* (both at once), *Flow failed*, *Needs you*, *Finished*.

The **Needs your attention** bar (status and project only; hover for the reason, click to jump to the cell) lists live sessions waiting on you, sessions over the cost threshold (`ICE_COST_ALERT`) or compacted repeatedly, flows stuck waiting for a runner (more than 5 minutes) or for approval, and sessions whose latest workflow run **failed** (shown even if the session is no longer live, within the 8 h window, until a newer run succeeds). Sessions with a Claude Code `/goal` show a ◎ Goal chip (press it to unfold the condition; green once met). OpenCode has no goal concept.

### How flow information is computed

- **Which runs belong to a session**: GitHub Actions runs on the session's branch created since the session started (`gh run list --branch`). Sessions on a shared branch such as `main` will also see other people's runs.
- **Stage**: run `waiting` → approval; `queued`/`pending` or a job not yet started → waiting for a runner; otherwise running, or *deploying* if the workflow or job name contains deploy/release/publish/rollout/promote.
- **Typical durations** come from the last 10 successful runs of the same workflow (total) and the last 3 (per job and step), cached for 30 minutes. ETA = typical − elapsed; past the typical duration it is shown as an overrun.
- **"Keeps iterating?"** is a heuristic: likely if the latest run failed, or a run is in progress after earlier failures in this session; unlikely if the latest run passed.
- **Errors** are failed tool calls and API errors. **Idle** is time in the last 8 h that the session existed but the agent was not working (Claude Code: from turn durations; OpenCode: from message timestamps).
- GitHub calls run in the background and are cached, so the first seconds after start show "Reading GitHub…".

### Status per agent

| Status | Claude Code | OpenCode |
|---|---|---|
| Working | live process is `busy` | session updated in the last 60 s |
| Needs you | live process is `idle` | not detectable |
| Running shell | live process is running a shell | not detectable |
| Finished | no live process | everything else |

OpenCode has no registry of live processes, so its statuses are inferred from recent writes. Flow, errors, compactions and idle time work for both agents. Sessions hosted by ICE are always known to be live, for both agents.

### Branch and PR discovery

- **Claude Code**: branch and PR links are recorded in the transcript.
- **OpenCode**: nothing is recorded, so ICE runs `git rev-parse` in the session's folder (current branch, not the branch at the time) and `gh pr view` for it.
- PR state and checks always come from `gh`, cached for 2 minutes.

## GitHub access

ICE reuses your existing GitHub CLI login: **no token or OAuth app of its own**. The top-right of the page shows `GitHub · <user>` when it works, or `GitHub ✕` when it does not.

1. Install the [GitHub CLI](https://cli.github.com) and run `gh auth login` (the default scopes include `repo` and `workflow`).
2. You need **read access to Actions** on the repositories you want to see.
3. **Organizations with SAML SSO**: authorize your token for the organization (`gh auth refresh`, then use *Authorize* next to the token on GitHub). A missing SSO authorization is the most common reason a repo shows no runs; the card says so.
4. Using a fine-grained token instead? Grant read access to *Actions*, *Pull requests* and *Metadata*.
5. **GitHub Enterprise**: `gh auth login --hostname <host>`. Flow lookup currently only recognizes `github.com` remotes.

The repository of each session is discovered from its working directory (`git remote origin`); there is nothing to configure. Only `github.com` repositories are supported for now (Azure Pipelines, GitLab, etc. are not read).

## Local files

ICE writes only under `~/.local/state/ice/`: `purged.json` (hidden session ids), `hostd.sock` (daemon socket) and `hostd.log` (daemon log). The browser keeps the cell layout and your choices (theme, cells per screen, last agent) in `localStorage`.

## Demo mode

`ICE_DEMO=1 npm start` serves 16 invented sessions (fictional projects and repositories) and disables every action. It reads nothing from your machine, which makes it safe for trying ICE without agents and for taking screenshots. Use another port (`ICE_PORT=4318`) if a real ICE is already running.
