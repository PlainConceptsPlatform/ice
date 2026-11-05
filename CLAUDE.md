# ICE – repository rules for Claude

ICE is a local, read-only control plane for coding-agent sessions (Claude Code and OpenCode) (see `README.md`). Server: Node + TypeScript. UI: React + Vite.

## Language
- **Everything is in English**: UI text, code, identifiers, comments, commit messages, PRs, docs. No exceptions, even if the user chats in Spanish.

## Layout
- `server/sources/` – one module per agent (`claude.ts` + `claude-parse.ts`, `opencode.ts`). Each returns the common `SessionDetail` from `shared/types.ts`. To support a new agent, add a source here and register it in `sessions.ts`.
- `server/` – `sessions.ts` merges sources (each wrapped so one broken source never breaks the rest), `alerts.ts`, `github.ts` (PR enrichment via `gh`), `flow.ts` (GitHub Actions runs on a session's branch: stage, step, ETA from history; stale-while-revalidate cache so gh never blocks the API), `activity.ts` (8 h idle strip), `pricing.ts`, `attachments.ts` (validation of image attachments and the message shape each agent expects; images are checked by type, size and magic bytes).
- `web/src/` – React UI (`mdparse.ts` is a small safe Markdown parser rendered by `Markdown.tsx`: never use `dangerouslySetInnerHTML`; `transcript-view.ts` decides what the modal hides). `shared/types.ts` – types shared by server and UI (single source of truth for the API contract).

## Commands
- `npm run dev` (API + UI), `npm start` (build + serve), `npm run typecheck` and `npm test` (both must pass before every commit), `npm run build`.
- `ICE_DEMO=1 npm start` serves invented sessions (see Security and privacy).

## Product scope
- **One view: sessions**, shown only as tall cells in a horizontally scrolling strip (`Wall.tsx`; cells reuse `SessionPanel`). There is no list/table view and no pagination. No separate project/sessions split. Project is only a grouping inside the session view. Workflow/flow information belongs inside each session.

## Security and privacy (non-negotiable)
- Bind the server to `127.0.0.1` only. Never expose it on other interfaces.
- POST endpoints can start processes and run tools: they must keep the loopback `Host` check, the same-origin check and the `x-ice: 1` header (see `server/index.ts`). New actions go through `web/src/api.ts` `post()`.
- Transcripts contain sensitive content: never commit session data, fixtures copied from `~/.claude`, or screenshots with real prompts/repo names. Use synthetic data for tests and docs. Take screenshots in demo mode (`ICE_DEMO=1`, `server/demo.ts`: invented sessions, all actions disabled), never from a real wall. **Screenshots are always in the light theme.**
- The MVP is **read-only** regarding sessions: never write to `~/.claude` or the OpenCode DB (open it with `readOnly: true`). ICE never writes to `~/.claude` or the OpenCode DB itself. It writes its own state file (`server/purge.ts`: hiding finished sessions, never deleting them) and it can *host* Claude Code sessions it starts itself (Agent SDK; the processes live in a separate daemon, `server/hostd.ts`, reached through `server/hostclient.ts` over an owner-only unix socket, so they survive ICE restarts): only those can receive messages/permission answers. Hosted sessions auto-allow permission prompts by default (opt out per session); questions and plan approval always wait for the user. It also hosts OpenCode sessions through its own `opencode serve` (`server/opencode-host.ts`, documented REST API; never write to the OpenCode DB directly and never read OpenCode's `service.json` credentials). Renaming goes through the SDK (`renameSession`) or the OpenCode API. Sessions started elsewhere stay read-only. Any other control action (deleting transcripts, typing into other terminals, OpenCode control) needs an explicit design first.
- Image attachments and slash-command lookups go through POST endpoints with the same guards (the lookup can start a short-lived process, so it is never a GET). Bump `HOSTD_PROTOCOL` when the daemon API changes.
- Never commit secrets or `.env`.

## Code conventions
- TypeScript `strict`; no `any` except when parsing untrusted JSONL (keep it local to `parse.ts`).
- Parsing must stay streaming and cached by mtime/size: `~/.claude/projects` can exceed 2 GB. Never read whole transcripts into memory; skip `api-request*` lines.
- Cost = estimate. Prices live only in `server/pricing.ts`; label costs "est." in the UI.
- UI: use CSS variables from `styles.css` for color (both light and dark themes must work); keep keyboard focus and `aria-label`s on controls.
- Cost is `costKnown: false` when no price exists; the UI shows "—", never a fake `$0`.
- Keep `README.md` setup/config tables accurate: anyone must be able to install ICE from them alone.
- Prefer small, dependency-light changes; ask before adding a dependency.

## Testing
- Unit tests use Node's built-in runner (`node:test`, run through `tsx`): files in `test/*.test.ts`, run with `npm test`. No test dependency was added; ask before adding one.
- Put logic that needs testing in pure modules (`server/security.ts`, `web/src/layout.ts`, `web/src/templates.ts`, parsers) rather than inside `index.ts` or React components, and import them from the test.
- Test data is synthetic and built inside the test (temp dirs, generated JSONL, `ICE_STATE_FILE` pointing at a temp file). Never copy real sessions, transcripts or screenshots into `test/`.
- Every behavior change and every bug fix comes with a test. For a bug, write the failing test first, then fix it. Never weaken or delete a test to make it pass; fix the cause. A flaky test is a bug: fix it, do not retry it.
- Cover the failure paths too (malformed input, empty state, security rejections), not only the happy path. UI behavior that cannot be unit-tested is verified in the browser (demo mode, light theme) and noted in the commit or PR.

## SDLC best practices
These apply to every change, whoever makes it.
1. **Start from an issue or a clear problem statement.** State the problem, the acceptance criteria and what is out of scope before coding. Prefer the smallest change that meets them.
2. **Small, reviewable increments.** One concern per commit or PR, imperative messages with a type (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), explaining *why* when it is not obvious. Do not mix refactors with behavior changes.
3. **Tests with the change** (see Testing), then the full gate locally: `npm run typecheck && npm test && npm run build`. CI (`.github/workflows/ci.yml`) runs the same on every push and pull request; a red CI is fixed before anything else, never bypassed.
4. **Review your own diff first**, as a skeptical reviewer would: bugs, edge cases, error handling, security, leftover debug code, stale docs. Security-sensitive areas (POST endpoints, spawning processes, file writes, anything near `~/.claude`) get an explicit second look against the rules above.
5. **Verify the real behavior**, not only the tests: run the app and exercise the change (UI in the browser with `ICE_DEMO=1`, in the light theme; API with `curl` including the `Host`/`x-ice` rejections).
6. **Documentation is part of done.** `README.md` (setup, config table, limitations), `docs/details.md` and this file stay accurate in the same change that alters behavior.
7. **Dependencies are a liability.** Ask first, prefer the standard library, pin through the lockfile (`npm ci` in CI), and look at the license and maintenance before adding one. Never add a dependency for something a few lines can do.
8. **No secrets, no real data, no personal or company-internal information** in code, tests, docs, screenshots, commit messages or history. Commits use a no-reply author address. If something sensitive is committed, rewrite the history before it is shared; do not just delete it in a later commit.
9. **Be honest in reports.** Say what was verified and how, what was not, and what is left. A failing test or a skipped step is reported, not hidden.
10. **Releases.** Semantic versioning in `package.json`; keep a short changelog of user-visible changes; tag the release commit.

## Workflow
- Work on `main` while the project is solo; external contributions come in through pull requests. Small focused commits with imperative messages (`feat:`, `fix:`, `docs:`, `test:`).
- Verify UI changes in the browser (both themes) before reporting them done.
- Keep `README.md` in sync when behavior, config or limitations change.
