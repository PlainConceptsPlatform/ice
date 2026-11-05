import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RepoIssue, SessionSummary, SlashCommandInfo } from '../../shared/types'
import { TEMPLATES, messageFor, type TemplateId } from './templates'
import { post } from './api'
import { Composer, strip, type Attached } from './Composer'

/** Start a Claude Code session hosted by ICE: pick a working directory, write the first message. */
export function NewSession({ sessions, onClose, onStarted }: { sessions: SessionSummary[]; onClose: () => void; onStarted: (id: string) => void }) {
  const dirs = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sessions) m.set(s.cwd, Math.max(m.get(s.cwd) ?? 0, s.lastActivity))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd)
  }, [sessions])
  const [cwd, setCwd] = useState(dirs[0] ?? '')
  const [tpl, setTpl] = useState<TemplateId>('report')
  const [issue, setIssue] = useState<number | undefined>()
  const [idea, setIdea] = useState('')
  const [pre, setPre] = useState(true)
  const [pro, setPro] = useState(false)
  const [issues, setIssues] = useState<{ list: RepoIssue[]; error?: string; loading: boolean; cwd?: string }>({ list: [], loading: false })
  const [prompt, setPrompt] = useState(() => messageFor('report', { pre: true, pro: false }))
  const [edited, setEdited] = useState(false) // once you type, option changes stop overwriting your text
  const [agent, setAgent] = useState<'claude' | 'opencode'>(() => (localStorage.getItem('ice-new-agent') === 'opencode' ? 'opencode' : 'claude'))
  const [images, setImages] = useState<Attached[]>([])
  const [cmds, setCmds] = useState<{ key: string; list?: SlashCommandInfo[]; error?: string } | null>(null)
  const [chrome, setChrome] = useState(true)
  const [autoAllow, setAutoAllow] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Open issues of the chosen directory, only needed by the "implement an issue" template.
  useEffect(() => {
    if (tpl !== 'implement-one' || !cwd.trim()) return
    let live = true
    const dir = cwd.trim()
    // A list that belongs to another repository must never stay visible (or selected) while the new one loads.
    setIssues((i) => (i.cwd === dir ? { ...i, loading: true } : { list: [], loading: true, cwd: dir }))
    setIssue((cur) => (issues.cwd === dir ? cur : undefined))
    const t = setTimeout(() => {
      fetch(`/api/issues?cwd=${encodeURIComponent(dir)}`).then((r) => r.json())
        .then((d: { issues: RepoIssue[]; error?: string }) => { if (!live) return; setIssues({ list: d.issues, error: d.error, loading: false, cwd: dir }); setIssue((cur) => (d.issues.some((x) => x.number === cur) ? cur : undefined)) })
        .catch(() => live && setIssues({ list: [], error: 'Could not reach the ICE API', loading: false, cwd: dir }))
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [tpl, cwd])

  const title = issues.list.find((i) => i.number === issue)?.title
  useEffect(() => { // regenerate the message from the template unless the user edited it
    if (tpl !== 'custom' && !edited) setPrompt(messageFor(tpl, { issue, issueTitle: title, idea, pre, pro }))
  }, [tpl, issue, title, idea, pre, pro, edited])

  const pickTemplate = (id: TemplateId) => {
    setTpl(id); setEdited(false)
    if (id === 'custom') setPrompt('')
  }
  const needsIssue = (tpl === 'implement-one' && !issue) || (tpl === 'new-issue' && !idea.trim())

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [onClose])

  // Slash commands for the chosen agent and directory, read the first time the user types "/" (and again if either changes).
  const cmdKey = `${agent}\n${cwd.trim()}`
  const wantCommands = () => {
    if (!cwd.trim() || (cmds?.key === cmdKey && !cmds.error)) return
    setCmds({ key: cmdKey })
    post<{ commands: SlashCommandInfo[] }>('/api/commands', { agent, cwd: cwd.trim() })
      .then((d) => { if (!Array.isArray(d.commands)) throw new Error('Unexpected answer from the ICE server'); setCmds((c) => (c?.key === cmdKey ? { key: cmdKey, list: d.commands } : c)) })
      .catch((e: Error) => setCmds((c) => (c?.key === cmdKey ? { key: cmdKey, error: e.message } : c)))
  }

  const start = async () => {
    setErr(''); setBusy(true)
    try { localStorage.setItem('ice-new-agent', agent); const { id } = await post<{ id: string }>('/api/sessions', { agent, cwd: cwd.trim(), prompt, chrome, autoAllow, images: strip(images) }); onStarted(id); onClose() }
    catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  const DEPLOY = (
    <fieldset><legend>Deploy to</legend>
                <label className="chk"><input type="checkbox" checked={pre} onChange={(e) => { setPre(e.target.checked); if (!e.target.checked) setPro(false) }} />PRE</label>
                <label className="chk"><input type="checkbox" checked={pro} onChange={(e) => { setPro(e.target.checked); if (e.target.checked) setPre(true) }} />PRO <small className="muted">(needs PRE first)</small></label>
              </fieldset>
  )

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal newsession" role="dialog" aria-modal="true" aria-label="New session">
        <header><h3>New session</h3>
          <div className="tplrow" role="group" aria-label="Agent">
            <button className={agent === 'claude' ? 'on' : ''} onClick={() => setAgent('claude')}>Claude Code</button>
            <button className={agent === 'opencode' ? 'on' : ''} onClick={() => setAgent('opencode')}>OpenCode</button>
          </div>
          <p className="muted small">Runs on this machine, owned by ICE: you can message it and answer its permission prompts here. It keeps running if you restart ICE; the transcript stays.{agent === 'opencode' ? ' ICE starts its own OpenCode server for it and uses your last-used model.' : ''}</p></header>
        <div className="mbody">
          <label>Working directory
            <input list="ice-dirs" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/project" spellCheck={false} autoFocus />
            <datalist id="ice-dirs">{dirs.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <div className="tplrow" role="group" aria-label="Message template">
            {TEMPLATES.map((x) => <button key={x.id} className={tpl === x.id ? 'on' : ''} onClick={() => pickTemplate(x.id)}>{x.label}</button>)}
          </div>
          <p className="muted small tplhint">{TEMPLATES.find((x) => x.id === tpl)!.hint}</p>
          {tpl === 'new-issue' && (
            <div className="tploptions">
              <label>What do you want?
                <textarea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Describe the feature or fix in your own words, in any language. The agent turns it into a proper English issue." />
              </label>
              {DEPLOY}
            </div>
          )}
          {tpl === 'implement-one' && (
            <div className="tploptions">
              <label>Issue
                {issues.error || (!issues.loading && issues.list.length === 0) ? (
                  <input type="number" min={1} value={issue ?? ''} onChange={(e) => setIssue(e.target.value ? Number(e.target.value) : undefined)} placeholder={issues.error ?? 'No open issues found: type a number'} />
                ) : (
                  <select value={issue ?? ''} onChange={(e) => setIssue(e.target.value ? Number(e.target.value) : undefined)} disabled={issues.loading}>
                    <option value="">{issues.loading ? 'Loading issues…' : 'Choose an issue…'}</option>
                    {issues.list.map((i) => <option key={i.number} value={i.number}>#{i.number} · {i.title}{i.labels.length ? `  [${i.labels.join(', ')}]` : ''}</option>)}
                  </select>
                )}
              </label>
              {DEPLOY}
            </div>
          )}
          <label>First message {tpl !== 'custom' && edited && <button className="linkbtn" onClick={() => setEdited(false)}>Reset to template</button>}
            <Composer rows={tpl === 'custom' ? 6 : 12} enterSends={false} value={prompt} onChange={(v) => { setPrompt(v); setEdited(true) }} onSend={() => undefined}
              images={images} onImages={setImages} commands={cmds?.key === cmdKey ? cmds.list ?? null : null} commandsError={cmds?.key === cmdKey ? cmds.error : undefined} onWantCommands={wantCommands} placeholder="What should the agent do?" />
          </label>
          {err && <div className="calert flow-failed">{err}</div>}
        </div>
        <footer><div className="crow"><label className="chk" title="Accept every permission prompt automatically (your deny rules and hooks still apply). Questions and plan approval still ask you."><input type="checkbox" checked={autoAllow} onChange={(e) => setAutoAllow(e.target.checked)} />Auto-allow</label>{agent === 'claude' && <label className="chk" title="Lets the agent drive your Chrome through the Claude in Chrome extension, as terminal sessions can"><input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />Claude in Chrome</label>}<span className="spacer" /><button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={start} disabled={busy || !cwd.trim() || (!prompt.trim() && !images.length) || needsIssue}>{busy ? 'Starting…' : 'Start session'}</button></div></footer>
      </div>
    </div>,
    document.body,
  )
}
