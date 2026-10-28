import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Square, Folder, LockKeyhole, RefreshCw, Search, X, Clock3, LogOut, ExternalLink, ArrowRight, AlertTriangle, Download, Check, Eye, Moon, Sun, Maximize2, Minimize2, GitBranch } from 'lucide-react';
import { auth, connect, captureInvitation } from './api';
import './style.css';
import { definitionsFor } from './readability';
import { ExplainedText, TermDialog } from './ExplainedText';
import { prioritiesForCard } from './priorities';
import { PriorityPanel } from './PriorityPanel';
import { ProjectStatus } from './ProjectStatus';
import { groupBoardsByRepository } from './repositories';
import { PriorityCardBadge } from './PriorityCardBadge';
import { boardColumns, cardInColumn } from './boardColumns';

captureInvitation();
const time = (ns) => Number(ns / 1000000n);
function age(ns, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - time(ns)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
const date = ns => new Date(time(ns)).toLocaleString();
const stale = ns => Date.now() - time(ns) > 86400000;
async function readAllArchives(actor, projectId, stale) {
  const result = [];
  const limit = 5n;
  for (let offset = 0n; ; offset += limit) {
    const page = await actor.listArchives(projectId, offset, limit);
    if (stale()) return [];
    result.push(...page);
    if (page.length < Number(limit)) return result;
  }
}
function Avatar({ name }) { return <span aria-hidden="true" className="avatar">{(name || '?').trim()[0].toUpperCase()}</span>; }
const displayState = state => /^[A-Z_]+$/.test(state) ? state.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : state;
const isCompleted = state => ['done', 'complete', 'completed', 'closed'].includes(state.trim().toLowerCase());
function App() {
  const [theme, setTheme] = useState(() => {
    try { const saved = localStorage.getItem('lookout-theme'); if (saved === 'dark' || saved === 'light') return saved; } catch { /* Storage may be disabled. */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101722' : '#142337');
    try { localStorage.setItem('lookout-theme', theme); } catch { /* Theme still works without storage. */ }
  }, [theme]);
  const themeButton = <button className="theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>;
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState(null);
  const [boards, setBoards] = useState([]);
  const [projectInfo, setProjectInfo] = useState([]);
  const [presentations, setPresentations] = useState([]);
  const [plainSummaries, setPlainSummaries] = useState([]);
  const [statusMode, setStatusMode] = useState(() => {
    try { return localStorage.getItem('lookout-status-mode') === 'technical' ? 'technical' : 'plain'; } catch { return 'plain'; }
  });
  useEffect(() => {
    try { localStorage.setItem('lookout-status-mode', statusMode); } catch { /* The current session choice still applies. */ }
  }, [statusMode]);
  const [priorities, setPriorities] = useState([]);
  const [archives, setArchives] = useState([]);
  const [managedProjects, setManagedProjects] = useState([]);
  const [showArchives, setShowArchives] = useState(false);
  const [term, setTerm] = useState(null);
  const termTrigger = useRef(null);
  const closeTerm = useCallback(() => setTerm(null), []);
  const explainTerm = useCallback((text, definition, trigger) => { termTrigger.current = trigger; setTerm({ text, definition }); }, []);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [fullBoard, setFullBoard] = useState(false);
  const [cardSize, setCardSize] = useState(() => {
    try { return localStorage.getItem('lookout-card-size') === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; }
  });
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const api = useRef(null);
  const inFlight = useRef(null);
  const generation = useRef(0);
  const closeButton = useRef(null);
  const opener = useRef(null);

  const refresh = useCallback(async () => {
    if (!api.current) return;
    const epoch = generation.current;
    if (inFlight.current === epoch) return;
    inFlight.current = epoch; setBusy(true);
    try {
      const nextSession = await api.current.session();
      if (epoch !== generation.current) return;
      if (!nextSession.canRead || !auth.isAuthenticated()) {
        setBoards([]); setProjectInfo([]); setPresentations([]); setPlainSummaries([]); setPriorities([]); setArchives([]); setManagedProjects([]); setTerm(null); setCard(null); setSession(nextSession); setPhase(auth.isAuthenticated() ? 'pending' : 'signedout'); return;
      }
      const actor = api.current;
      const [next, nextPresentations, nextPriorities, nextPlainSummaries, nextProjectInfo] = await Promise.all([actor.listBoards(), actor.listPresentations(), actor.listPriorities(), actor.listPlainSummaries(), actor.listProjectInfo()]);
      const [archivePages, nextManaged] = await Promise.all([
        Promise.all(next.map(b => readAllArchives(actor, b.data.projectId, () => epoch !== generation.current))),
        Promise.all(next.map(async b => [b.data.projectId, await actor.canManageProject(b.data.projectId)])),
      ]);
      const nextArchives = archivePages.flat();
      if (epoch !== generation.current) return;
      setBoards(next); setProjectInfo(nextProjectInfo); setPresentations(nextPresentations); setPlainSummaries(nextPlainSummaries); setPriorities(nextPriorities); setArchives(nextArchives); setManagedProjects(nextManaged.filter(([, allowed]) => allowed).map(([id]) => id)); setSession(nextSession); setNow(Date.now()); setError('');
      setSelected(current => next.some(b => b.data.projectId === current) ? current : next[0]?.data.projectId || null);
    } catch {
      if (epoch === generation.current) {
        setBoards([]); setProjectInfo([]); setPresentations([]); setPlainSummaries([]); setPriorities([]); setArchives([]); setManagedProjects([]); setTerm(null); setCard(null); setError('Could not refresh your boards. Check your connection or sign in again.');
      }
    } finally {
      if (inFlight.current === epoch) inFlight.current = null;
      if (epoch === generation.current) setBusy(false);
    }
  }, []);

  const initialize = useCallback(async () => {
    const epoch = generation.current;
    if (!auth.isAuthenticated()) { setPhase('signedout'); return; }
    setBusy(true); setError('');
    try {
      const actor = await connect();
      if (epoch !== generation.current) return;
      api.current = actor;
      const invite = sessionStorage.getItem('lookout-invite');
      if (invite) {
        try { await actor.redeemInvite(invite); sessionStorage.removeItem('lookout-invite'); }
        catch { sessionStorage.removeItem('lookout-invite'); setError('This invitation has expired or was already used. Ask the workspace owner for a fresh invitation.'); }
      }
      const s = await actor.session();
      if (epoch !== generation.current) return;
      setSession(s);
      if (!s.canRead) { setPhase('pending'); return; }
      setPhase('ready'); await refresh();
      if (s.isAdmin) {
        try { const cycles = await actor.cycleBalance(); if (epoch === generation.current) setBalance(cycles); } catch { /* Boards remain usable if metrics fail. */ }
      }
    } catch { if (epoch === generation.current) { setError('We could not connect to your workspace. Please try again.'); setPhase('signedout'); } }
    finally { if (epoch === generation.current) setBusy(false); }
  }, [refresh]);

  useEffect(() => {
    initialize();
    const invitationChanged = () => {
      captureInvitation();
      if (sessionStorage.getItem('lookout-invite') && auth.isAuthenticated()) initialize();
    };
    window.addEventListener('hashchange', invitationChanged);
    const unsubscribe = auth.subscribe(() => {
      if (!auth.isAuthenticated()) { generation.current++; api.current = null; setBoards([]); setProjectInfo([]); setPresentations([]); setPlainSummaries([]); setPriorities([]); setArchives([]); setManagedProjects([]); setTerm(null); setCard(null); setSession(null); setPhase('signedout'); }
    });
    return () => { unsubscribe(); window.removeEventListener('hashchange', invitationChanged); };
  }, [initialize]);
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden) refresh(); }, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [phase, refresh]);
  useEffect(() => {
    if (!card) return;
    closeButton.current?.focus();
    const handler = event => {
      if (event.key === 'Escape') setCard(null);
      if (event.key === 'Tab') {
        const items = [...document.querySelectorAll('.drawer button,.drawer a')];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); opener.current?.focus(); };
  }, [card]);
  useEffect(() => {
    if (!fullBoard) return;
    const onKeyDown = event => { if (event.key === 'Escape' && !card && !term) setFullBoard(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullBoard, card, term]);
  useEffect(() => {
    try { localStorage.setItem('lookout-card-size', cardSize); } catch { /* The current session choice still applies. */ }
  }, [cardSize]);

  async function signIn() { setBusy(true); setError(''); try { await auth.signIn({ maxTimeToLive: 28800000000000n }); await initialize(); } catch { setError('Sign-in was not completed. You can try again.'); } finally { setBusy(false); } }
  async function signOut() { generation.current++; api.current = null; setBoards([]); setProjectInfo([]); setPresentations([]); setPlainSummaries([]); setPriorities([]); setArchives([]); setManagedProjects([]); setTerm(null); setCard(null); setSession(null); setBalance(null); setPhase('signedout'); sessionStorage.removeItem('lookout-invite'); try { await auth.signOut(); } catch { setError('Local view cleared. Sign-out could not be confirmed; close this tab if you are on a shared device.'); } }
  function select(id) { setTerm(null); setSelected(id); setQuery(''); setBlockedOnly(false); setShowArchives(false); setCard(null); }
  async function archiveTask(task) {
    if (!board || !managedProjects.includes(board.data.projectId) || !isCompleted(task.state)) return;
    setBusy(true); setError('');
    try { await api.current.archiveCard(board.data.projectId, task.id, board.data.sourceRevision); setCard(null); await refresh(); }
    catch { setError('Could not archive this card. Refresh the board and try again.'); }
    finally { setBusy(false); }
  }
  async function restoreTask(entry) {
    if (!board || !managedProjects.includes(board.data.projectId)) return;
    setBusy(true); setError('');
    try { await api.current.restoreCard(board.data.projectId, entry.cardId, entry.completedAt, board.data.sourceRevision); setCard(null); await refresh(); }
    catch { setError('Could not restore this card. Refresh the board and try again.'); }
    finally { setBusy(false); }
  }
  function exportBoards() {
    const blob = new Blob([JSON.stringify(boards, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `lookout-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const repositoryGroups = groupBoardsByRepository(boards, projectInfo);
  const board = boards.find(b => b.data.projectId === selected);
  const presentation = presentations.find(item => item.projectId === selected);
  const plainSummary = plainSummaries.find(item => item.projectId === selected);
  const presentationCurrent = Boolean(presentation && board && presentation.data.sourceRevision === board.data.sourceRevision);
  const priority = priorities.find(item => item.projectId === selected);
  const glossary = presentationCurrent ? presentation.data.glossary : [];
  const cardDefinitions = definitionsFor(glossary, card?.id);
  const projectArchives = archives.filter(entry => entry.projectId === selected);
  const archivedIds = new Set(projectArchives.map(entry => entry.cardId));
  const activeCount = board?.data.cards.filter(task => !archivedIds.has(task.id)).length || 0;
  const filtered = board?.data.cards.filter(c => showArchives ? false : !archivedIds.has(c.id)).filter(c => (!blockedOnly || c.blocked || c.state.toLowerCase() === 'blocked') && `${c.id} ${c.title} ${c.owner} ${c.description}`.toLowerCase().includes(query.toLowerCase())) || [];
  const archivedFiltered = projectArchives.filter(entry => `${entry.cardId} ${entry.card.title} ${entry.card.owner} ${entry.card.description}`.toLowerCase().includes(query.toLowerCase()));
  const currentCardIds = new Set(board?.data.cards.map(task => task.id) || []);
  const displayColumns = board ? (() => { const columns = boardColumns(board.data); return columns.some(column => column.trim().toLowerCase() === 'done') ? columns : [...columns, 'Done']; })() : [];
  const selectedArchive = showArchives ? projectArchives.find(entry => entry.cardId === card?.id) : null;
  const canRestoreSelected = Boolean(selectedArchive && currentCardIds.has(selectedArchive.cardId));

  if (phase !== 'ready') return <main className="entry">
    <div className="entry-theme">{themeButton}</div>
    <div className="entry-brand"><Square size={30} strokeWidth={1.5}/><span>Lookout</span></div>
    <section className="login-panel">
      <div className="lock-mark"><LockKeyhole size={26}/></div>
      <h1>{phase === 'pending' ? 'Your workspace is private.' : 'A clear view of the work.'}</h1>
      <p>{phase === 'pending' ? 'You are signed in, but this identity does not have access yet. Open your private invitation link or share this principal with the workspace owner.' : 'Your projects. Your leads. One quiet place to see what’s moving.'}</p>
      {error && <div role="alert" className="error">{error}</div>}
      {phase === 'loading' ? <p role="status">Opening your workspace…</p> : phase === 'pending' ? <>
        <code className="principal">{session?.principal.toText()}</code>
        <button className="primary" onClick={async () => { try { await navigator.clipboard.writeText(session.principal.toText()); setCopied(true); } catch { setError('Select and copy the principal above.'); } }}>{copied ? <Check size={17}/> : null}{copied ? 'Copied' : 'Copy principal'}</button>
        <button className="text-button" onClick={signOut}>Use another identity</button>
      </> : <button className="primary" disabled={busy} onClick={signIn}>{busy ? 'Connecting…' : 'Sign in with Internet Identity'}<ArrowRight size={18}/></button>}
      <div className="entry-note"><LockKeyhole size={14}/> Invite-only · Hosted on ICP</div>
    </section><div className="entry-bottom">A window into your projects. Updated by your leads.</div>
  </main>;
  return <div className={`app${fullBoard ? ' full-board-view' : ''}${fullBoard && cardSize === 'compact' ? ' compact-cards' : ''}`}>
    <aside className="sidebar" inert={Boolean(card || term)}><a className="brand" href="/" aria-label="Lookout home"><Square size={28} strokeWidth={1.5}/>Lookout</a>
      <div className="nav-label">Projects <span>{boards.length}</span></div>
      <nav aria-label="Projects">{repositoryGroups.map(group => <section key={group.key} className="repository-group" aria-label={group.repository || group.label}>
        <h2 className="repository-heading" title={group.repository || undefined}><GitBranch size={14} aria-hidden="true"/><span>{group.label}</span><span className="repository-count">{group.boards.length}</span></h2>
        <div className="repository-projects">{group.boards.map(b => <button key={b.data.projectId} className={`project ${selected === b.data.projectId ? 'active' : ''}`} aria-current={selected === b.data.projectId ? 'page' : undefined} onClick={() => select(b.data.projectId)}><Folder size={17}/><span>{b.data.title}</span>{stale(b.publishedAt) && <span className="stale-dot" title="Snapshot has not been published in over 24 hours"/>}</button>)}</div>
      </section>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-theme">{themeButton}</div><div><LockKeyhole size={16}/>Private workspace</div>{balance !== null && <span className="cycles">Backend reserve · {(Number(balance)/1e12).toFixed(2)}T cycles</span>}<div className="side-actions"><button onClick={exportBoards} title="Download board snapshots"><Download size={15}/>Export</button><button onClick={signOut}><LogOut size={15}/>Sign out</button></div></div>
    </aside>
    <main className="workspace" inert={Boolean(card || term)}><div className="mobile-brand"><Square size={23}/>Lookout{themeButton}<button aria-label="Sign out" onClick={signOut}><LogOut size={18}/></button></div>
      {boards.length > 0 && <label className="mobile-project">Project<select value={selected || ''} onChange={e => select(e.target.value)}>{repositoryGroups.map(group => <optgroup key={group.key} label={group.label}>{group.boards.map(b => <option key={b.data.projectId} value={b.data.projectId}>{b.data.title}</option>)}</optgroup>)}</select></label>}
      {error && <div role="alert" className="error refresh-error">{error}<button onClick={refresh}>Try again</button></div>}
      {board ? <>
        <header className="board-header"><div><h1>{board.data.title}</h1><div className="lead"><Avatar name={board.data.lead}/><span>Lead: {board.data.lead}</span><span className="view-label"><Eye size={14}/>Read-only</span></div></div><div className="refresh-area"><span className={stale(board.publishedAt) ? 'stale' : 'muted'} title={`Snapshot published ${date(board.publishedAt)}`}>Published {age(board.publishedAt, now)}</span><button className="outline" onClick={refresh} disabled={busy}><RefreshCw size={17} className={busy ? 'spinning' : ''}/>{busy ? 'Refreshing' : 'Refresh'}</button></div></header>

        <div className="status-priorities-grid">
          <ProjectStatus board={board} presentation={presentation} plainSummary={plainSummary} mode={statusMode} onModeChange={setStatusMode}/>
          <PriorityPanel priority={priority} board={board}/>
        </div>
        {(stale(board.publishedAt) || stale(board.data.sourceUpdatedAt)) && <div className="stale-banner"><Clock3 size={17}/> {stale(board.publishedAt) ? 'This snapshot is over a day old. Your lead may have newer information.' : 'The source board has not changed in over a day. Recent publishing does not mean recent work.'}</div>}
        <div className="toolbar"><span className="immersive-title">{board.data.title}</span><label className="search"><Search size={18}/><input aria-label="Search tasks" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks…"/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</label><label className="toggle-label"><input type="checkbox" checked={blockedOnly} onChange={e => setBlockedOnly(e.target.checked)}/><span className="switch"/>Blocked only</label><div className="archive-controls"><button type="button" className="outline" aria-pressed={showArchives} onClick={() => { setShowArchives(value => !value); setBlockedOnly(false); }}>{showArchives ? `Active (${activeCount})` : `Archived (${projectArchives.length})`}</button></div><span className="task-total">{showArchives ? archivedFiltered.length : filtered.length} cards</span><div className="board-view-controls" role="group" aria-label="Board display controls"><div className="card-size-control" role="group" aria-label="Card size"><button type="button" aria-pressed={cardSize === 'comfortable'} onClick={() => setCardSize('comfortable')}>Comfortable</button><button type="button" aria-pressed={cardSize === 'compact'} onClick={() => setCardSize('compact')}>Compact</button></div><button type="button" className="outline board-view-toggle" aria-pressed={fullBoard} onClick={() => setFullBoard(value => !value)}>{fullBoard ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}<span>{fullBoard ? 'Exit full board' : 'Full board'}</span></button></div></div>
        <div className="board" aria-label={`${board.data.title} ${showArchives ? 'archived cards' : 'Kanban board'}`}>{(showArchives ? ['Archived'] : displayColumns).map((column, index) => {
          const cards = showArchives ? archivedFiltered.map(entry => entry.card) : filtered.filter(c => cardInColumn(board.data.projectId, c.state, column));
          return <section className={`column tone-${index % 6}`} key={column} aria-label={column}><div className="column-heading"><span className="column-dot"/><h2>{displayState(column)}</h2><span className="count">{cards.length}</span></div><div className="card-stack">{cards.map(c => {
            const openCard = event => { opener.current = event.currentTarget.closest('.task-card')?.querySelector('.card-open') || event.currentTarget; setCard(c); };
            const linkedPriorities = prioritiesForCard(priority, board, c.id);
            return <article className="task-card" key={c.id} onClick={openCard}>
              {(c.blocked || c.state.toLowerCase() === 'blocked') && <div className="blocked-ribbon"><AlertTriangle size={14}/>Blocked</div>}
              <div className="card-body"><button className="card-open card-id" onClick={event => { event.stopPropagation(); openCard(event); }} aria-label={`Open ${c.id}: ${c.title}`}>{c.id}</button>
                <h3><ExplainedText text={c.title} definitions={definitionsFor(glossary, c.id)} onExplain={explainTerm}/></h3>
                <div className="card-footer"><div className="priority-card-badges" aria-label="Linked sub-project priority ranks" onClick={event => event.stopPropagation()}>
                  {linkedPriorities.length ? linkedPriorities.map(item => <PriorityCardBadge key={item.id} rank={item.rank} title={item.title}/>) : <PriorityCardBadge/>}
                </div><span>{c.owner || 'Unassigned'}</span><button className="card-more" aria-label={`View ${c.id} details`} onClick={event => { event.stopPropagation(); openCard(event); }}>···</button></div>
              </div>
            </article>;
          })}{!cards.length && <div className="column-empty">{query || blockedOnly ? 'No matches' : showArchives ? 'No archived cards' : 'Nothing here yet'}</div>}</div></section>;
        })}</div>
        <footer className="source-footer"><Clock3 size={16}/><span>Source changed {age(board.data.sourceUpdatedAt, now)}<span className="footer-sep">·</span>Snapshot published {age(board.publishedAt, now)}</span><span className="revision" title={board.data.sourceRevision}>Revision {board.revision.toString()}</span></footer>
      </> : !error && <div className="empty-workspace"><Folder size={36}/><h1>{busy ? 'Loading your boards…' : 'Your workspace is ready.'}</h1><p>{busy ? 'Fetching the latest published snapshots.' : 'Project boards will appear here when a lead publishes the first snapshot.'}</p><button className="outline" disabled={busy} onClick={refresh}><RefreshCw size={16}/>Refresh boards</button></div>}
    </main>
    {card && board && <div className="drawer-backdrop" onClick={() => setCard(null)}><section role="dialog" aria-modal="true" aria-labelledby="detail-title" className="drawer" inert={Boolean(term)} onClick={e => e.stopPropagation()}><button ref={closeButton} className="close-drawer" aria-label="Close task details" onClick={() => setCard(null)}><X size={22}/></button><span className="card-id">{card.id}</span><h2 id="detail-title"><ExplainedText text={card.title} definitions={cardDefinitions} onExplain={explainTerm}/></h2><div className="detail-meta"><span className="state-tag">{displayState(card.state)}</span><span className="lead"><Avatar name={card.owner}/>{card.owner}</span></div>{card.blocked && <div className="stale-banner"><AlertTriangle size={16}/>This card is blocked.</div>}<h3>Evidence & next action</h3><p className="description"><ExplainedText text={card.description || 'No additional detail was published.'} definitions={cardDefinitions} onExplain={explainTerm}/></p>{card.evidence.length > 0 && <><h3>References</h3><div className="references">{card.evidence.filter(link => { try { return new URL(link.url).protocol === 'https:'; } catch { return false; } }).map((link, i) => <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">{link.title || 'View reference'}<ExternalLink size={15}/></a>)}</div></>}<div className="detail-source"><LockKeyhole size={15}/><p>Mirrored from the lead’s board. A completed card reflects its stated scope; see the evidence for what was verified.</p></div>{managedProjects.includes(board.data.projectId) && (showArchives ? <button className="outline archive-action" disabled={busy || !canRestoreSelected} onClick={() => selectedArchive && restoreTask(selectedArchive)}>{busy ? 'Working…' : 'Restore card to active board'}</button> : isCompleted(card.state) && <button className="outline archive-action" disabled={busy} onClick={() => archiveTask(card)}>{busy ? 'Working…' : 'Archive card'}</button>)}{showArchives && selectedArchive && <><p className="archive-meta">{selectedArchive.manual ? 'Manually archived' : `Completed ${date(selectedArchive.completedAt)}`} · Available since {date(selectedArchive.manual ? selectedArchive.archivedAt : selectedArchive.completedAt + 72n * 60n * 60n * 1000000000n)}</p>{!canRestoreSelected && <p className="archive-meta">This card is no longer on the current source board, so it remains in history and cannot be restored here.</p>}</>}<dl className="detail-provenance"><dt>Source changed</dt><dd>{date(board.data.sourceUpdatedAt)}</dd><dt>Published</dt><dd>{date(board.publishedAt)}</dd><dt>Source revision</dt><dd className="hash">{board.data.sourceRevision}</dd></dl></section></div>}
    {term && <TermDialog term={term} onClose={closeTerm} trigger={termTrigger.current}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
