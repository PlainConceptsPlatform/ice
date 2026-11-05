/** Ready-made first messages for a new session. Plain English, precise about what the agent may and may not do. */
export type TemplateId = 'report' | 'implement-all' | 'implement-one' | 'new-issue' | 'custom'

export interface TemplateOptions { issue?: number; issueTitle?: string; idea?: string; pre: boolean; pro: boolean }

export const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: 'report', label: 'Open issues and PRs', hint: 'Read-only report: what is open, what is blocked, what to do first.' },
  { id: 'implement-all', label: 'Implement issues and close PRs', hint: 'Merge the healthy PRs and implement every open issue without a PR. Does not deploy.' },
  { id: 'implement-one', label: 'Implement an issue and deploy', hint: 'One issue end to end: branch, tests, PR, merge, then deploy to PRE and/or PRO.' },
  { id: 'new-issue', label: 'New issue and implement', hint: 'Describe what you want: the agent writes the issue, then implements it in a long autonomous loop (build, test, review, harden) and keeps going as long as it finds work.' },
  { id: 'custom', label: 'Custom', hint: 'Write your own message.' },
]

const REPORT = `Give me a status report of the open issues and open pull requests of this repository. This is read-only: do not change, merge, comment on or close anything.

Use the GitHub CLI (\`gh issue list\`, \`gh pr list\`, \`gh pr view\`, \`gh pr checks\`).

For each open pull request report: number and title, author, draft or ready, review decision, CI check status (passing, failing or pending), whether it is mergeable or has conflicts, and the issue it closes (if any).
For each open issue report: number and title, labels, assignee, and whether an open PR already references it.

Then group the result as:
1. PRs that are ready to merge (checks green, no changes requested, no conflicts).
2. PRs that are blocked, with the reason (failing checks, conflicts, changes requested, draft).
3. Issues that have no PR yet.

Finish with the order in which you would handle them and why. Keep it concise.`

const IMPLEMENT_ALL = `Work through the open pull requests and open issues of this repository. Use the GitHub CLI (\`gh\`).

Step 1 - Inventory. List the open PRs and issues first and show me the plan before you change anything.

Step 2 - Pull requests. For each open PR:
- Check CI (\`gh pr checks\`) and review status.
- If checks fail or the branch conflicts with the base branch, fix it on the PR branch when the fix is clear and low risk; otherwise tell me why you stopped.
- Merge it only when all required checks are green and no changes are requested, using the merge method the repository already uses.
- If a PR looks obsolete or superseded, do not close it: list it and tell me why.

Step 3 - Issues. For each open issue that has no PR:
- Branch from the up-to-date default branch as \`<type>/<issue-number>-<short-slug>\`.
- Implement the change with tests, then run the project's build and test commands and fix what fails.
- Open a PR whose description references the issue with \`Closes #<number>\`.
- If the issue is ambiguous or too large, ask me instead of guessing.

Rules: never push directly to the default branch, never force-push shared branches, and do not deploy anything. Finish with a table of what was merged, what was opened and what is still pending.`

export function implementOne(o: TemplateOptions): string {
  const n = o.issue ? `#${o.issue}${o.issueTitle ? ` (${o.issueTitle})` : ''}` : '#<issue number>'
  const num = o.issue ? `#${o.issue}` : '#<issue number>'
  const deploy = deployStep(o, 5)
  return `Implement issue ${n} end to end. Use the GitHub CLI (\`gh\`).

Step 1 - Read ${num} (\`gh issue view ${o.issue ?? '<number>'} --comments\`) and any linked issues or PRs. If the scope is ambiguous, ask me before coding.
Step 2 - Branch from the up-to-date default branch as \`<type>/${o.issue ?? '<number>'}-<short-slug>\`.
Step 3 - Implement the change with tests. Run the project's build and test commands and fix what fails.
Step 4 - Open a PR that references the issue with \`Closes ${num}\`, wait for the required checks to pass, then merge it using the merge method the repository already uses. Never push directly to the default branch.
${deploy}

Finish with a short summary: PR link, merge commit, and the state of each environment.`
}

function deployStep(o: TemplateOptions, step: number): string {
  const envs = [o.pre && 'PRE', o.pro && 'PRO'].filter(Boolean) as string[]
  return !envs.length
    ? `Do not deploy. Stop once the PR is merged and tell me the merge commit.`
    : `Step ${step} - Deploy to ${envs.join(' and ')}. After the merge, find the deployment workflow runs for the merge commit (\`gh run list --commit <sha>\`, \`gh run watch <id>\`).
- Verify that the deployment to PRE succeeded and that its smoke checks or health checks pass. Report the run URL.
${o.pro
  ? `- Only if PRE is healthy, continue to PRO. Production deployments may wait for a manual approval or a protected-environment reviewer: if a run is waiting for approval, stop and tell me; do not approve it yourself unless I explicitly say so.
- Verify PRO the same way and report the run URL.`
  : `- Do NOT promote to PRO. Stop after PRE and tell me when it is ready to promote.`}
- If any run fails, read the logs (\`gh run view <id> --log-failed\`), tell me the cause and propose a fix; do not retry blindly or revert without asking.`
}

export function newIssue(o: TemplateOptions): string {
  const idea = o.idea?.trim() || '<describe what you want>'
  return `I want this built:

"""
${idea}
"""

Work on it as one long, autonomous piece of work. Use the GitHub CLI (\`gh\`). Everything you write (issue, commits, PR, comments, code, docs) is in English.

Step 1 - Understand. Read the repository first (README, CLAUDE.md or similar, structure, build and test commands, recent history) and look for existing issues or PRs that already cover this (\`gh issue list --search\`). Do not duplicate one: if it exists, continue it.

Step 2 - Write the issue. Create it with \`gh issue create\`: a precise title, the problem and the motivation, the proposed behaviour, explicit acceptance criteria as a checklist of testable statements, what is out of scope, and how it will be verified. Be specific enough that someone else could implement it. Print the issue number and URL.

Step 3 - Branch from the up-to-date default branch as \`<type>/<issue-number>-<short-slug>\`. Never push directly to the default branch and never force-push shared branches.

Step 4 - Iterate until it is really finished. Repeat this cycle, as many times as it takes:
  a. Implement the next smallest slice of the acceptance criteria, with tests. Commit it on its own with a clear message.
  b. Run the project's build, linter and full test suite; fix every failure at its root cause.
  c. Exercise the real behaviour (run the app, call the endpoint, drive the UI) instead of trusting the tests alone.
  d. Review your own diff as a skeptical reviewer: bugs, edge cases, error handling, security, performance, naming, dead code, missing docs. Fix what you find.
  e. Re-read the acceptance criteria and tick off only what you have verified. Add anything you discovered along the way as a new item.
Do not stop while an acceptance criterion is unmet, a test fails, or your last review pass still found something. Stop iterating only after two consecutive review passes find nothing to fix. Then go one more round on hardening: edge cases, failure modes, tests that would catch a regression, and documentation that is now stale.

Step 5 - Keep a durable progress log. After each cycle add a short comment on the issue (\`gh issue comment\`): what is done, what is verified, what is left, decisions taken and why. This is your memory: your context will be compacted over a long run, so before you act after a compaction re-read the issue and its comments and continue from there. Do not keep notes in files inside the repository.

Step 6 - Open a PR that references the issue with \`Closes #<number>\`, wait for the required checks and fix any that fail, then merge it using the merge method the repository already uses.
${deployStep(o, 7)}

Work autonomously. Make reasonable decisions yourself and record them in the issue; only stop to ask me when you are truly blocked or a decision is irreversible, outward-facing or changes the scope I described. Do not ask for confirmation between steps. Finish with a short summary: issue and PR links, what was verified and how, what was deliberately left out, and the state of each environment.`
}

export function messageFor(id: TemplateId, o: TemplateOptions): string {
  if (id === 'report') return REPORT
  if (id === 'implement-all') return IMPLEMENT_ALL
  if (id === 'implement-one') return implementOne(o)
  if (id === 'new-issue') return newIssue(o)
  return ''
}
