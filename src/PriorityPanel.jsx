import React from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import { firstActionablePriority } from './priorities';

const labels = { ready: 'Ready', in_progress: 'In progress', blocked: 'Blocked', paused: 'Paused', done: 'Done' };

export function PriorityPanel({ priority, board }) {
  const current = Boolean(priority && board && priority.data.sourceRevision === board.data.sourceRevision);
  const items = priority?.data?.items || [];
  const focus = current ? firstActionablePriority(items) : null;
  return <section className="priority-panel" aria-labelledby="priorities-title">
    <div className="priority-heading"><div className="priority-heading-label"><div className="priority-eyebrow">Supervisor ranking</div><h2 id="priorities-title">Sub-project priorities</h2></div>
      {current && <p className="priority-focus-summary" title={focus ? `${focus.status === 'ready' ? 'Next focus' : 'Current focus'}: ${focus.title}` : 'No actionable sub-projects'}>{focus ? <><strong>{focus.status === 'ready' ? 'Next focus' : 'Current focus'}:</strong> {focus.title}</> : 'No actionable sub-projects'}</p>}
    </div>
    {!priority || !items.length ? <div className="priority-empty"><CircleHelp size={19}/><p>No sub-project priorities have been supplied yet.</p></div> : <>
      {!current && <div className="priority-stale" role="status"><AlertTriangle size={16}/><span>These priorities refer to an earlier board update. Focus is unavailable until they are republished.</span></div>}
      <ol className="priority-list" tabIndex={0} aria-label="Priorities in supervisor rank order">{items.map((item, index) => <li className={`priority-item priority-${item.status}`} key={item.id}>
        <span className="priority-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
        <div className="priority-content">
          {(item.blockedReason || item.nextAction) ? <details className="priority-explanation">
            <summary className="priority-title-row"><h3>{item.title}</h3><span className="priority-disclosure-label">{item.status === 'blocked' ? 'Blocker and next step' : item.status === 'paused' ? 'Why paused' : 'Next step'}</span><span className={`priority-status status-${item.status}`}>{labels[item.status] || item.status}</span></summary>
            <div className="priority-explanation-body">
              {item.blockedReason && <p className="priority-detail"><strong>{item.status === 'paused' ? 'Why paused' : 'Blocker'}:</strong> {item.blockedReason}</p>}
              {item.nextAction && <p className="priority-detail"><strong>Next action:</strong> {item.nextAction}</p>}
            </div>
          </details> : <div className="priority-title-row"><h3>{item.title}</h3><span className={`priority-status status-${item.status}`}>{labels[item.status] || item.status}</span></div>}
        </div>
      </li>)}</ol>
    </>}
  </section>;
}
