import React from 'react';

export function ProjectStatus({ board, presentation, plainSummary, mode, onModeChange }) {
  const selected = mode === 'technical' ? presentation : plainSummary;
  const summary = selected?.data.summary;
  const current = Boolean(selected && board && selected.data.sourceRevision === board.data.sourceRevision);
  return <section className="board-summary" aria-label="Project status">
    <div className="status-summary-heading">
      <div className="summary-label">Project status</div>
      <div className="status-mode-control" role="group" aria-label="Project status language">
        <button type="button" aria-pressed={mode === 'plain'} onClick={() => onModeChange('plain')}>Plain English</button>
        <button type="button" aria-pressed={mode === 'technical'} onClick={() => onModeChange('technical')}>Technical</button>
      </div>
    </div>
    {selected && !current && <div className="summary-earlier" role="status">From an earlier board update</div>}
    <p aria-live="polite">{summary || (mode === 'technical' ? 'Your lead has not posted a technical project status yet.' : 'Your lead has not posted a plain-English update yet. You can read the Technical view while they prepare it.')}</p>
  </section>;
}
