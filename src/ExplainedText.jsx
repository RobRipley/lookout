import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { explainText } from './readability';

export function ExplainedText({ text, definitions, onExplain }) {
  return explainText(text, definitions).map((part, index) => part.definition
    ? <button type="button" key={index} className="jargon-term" aria-label={`Explain ${part.text}`} onClick={event => { event.stopPropagation(); onExplain(part.text, part.definition, event.currentTarget); }}>{part.text}</button>
    : <React.Fragment key={index}>{part.text}</React.Fragment>);
}

export function TermDialog({ term, onClose, trigger }) {
  const close = useRef(null);
  useEffect(() => {
    close.current?.focus();
    const handler = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); if (trigger?.isConnected) trigger.focus(); };
  }, [onClose, trigger]);
  return <div className="term-backdrop" onClick={onClose}>
    <section className="term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-title" aria-describedby="term-definition" onClick={event => event.stopPropagation()}>
      <button ref={close} className="term-close" aria-label="Close definition" onClick={onClose}><X size={20}/></button>
      <span className="term-caption">In plain English</span>
      <h2 id="term-title">{term.text}</h2>
      <p id="term-definition">{term.definition}</p>
    </section>
  </div>;
}
