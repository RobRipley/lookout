import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function PriorityCardBadge({ rank, title }) {
  const badgeRef = useRef(null);
  const tooltipRef = useRef(null);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const tooltipId = useId();
  const linked = Number.isInteger(rank) && Boolean(title);
  const label = linked ? `Sub-project priority rank ${rank}: ${title}` : 'No sub-project linked';
  const tooltipText = linked ? title : 'No sub-project linked';

  useLayoutEffect(() => {
    if (!visible) return;
    const badge = badgeRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current?.getBoundingClientRect();
    if (!badge || !tooltip) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(
      badge.left + badge.width / 2 - tooltip.width / 2,
      window.innerWidth - tooltip.width - margin,
    ));
    const preferredTop = badge.top < tooltip.height + 12
      ? badge.bottom + 8
      : badge.top - tooltip.height - 8;
    const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - tooltip.height - margin));
    setPosition({ left, top, ready: true });
  }, [visible, tooltipText]);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const hide = () => {
      hoverRef.current = false;
      focusRef.current = false;
      setVisible(false);
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [visible]);

  const show = () => setVisible(true);
  const hideIfInactive = () => { if (!hoverRef.current && !focusRef.current) setVisible(false); };

  return <>
    <span
      ref={badgeRef}
      className={`priority-card-badge${linked ? '' : ' priority-card-unlinked'}`}
      role="img"
      tabIndex={0}
      aria-label={label}
      aria-describedby={visible ? tooltipId : undefined}
      onMouseEnter={() => { hoverRef.current = true; show(); }}
      onMouseLeave={() => { hoverRef.current = false; hideIfInactive(); }}
      onFocus={() => { focusRef.current = true; show(); }}
      onBlur={() => { focusRef.current = false; hideIfInactive(); }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >{linked ? rank : '?'}</span>
    {visible && createPortal(
      <span
        ref={tooltipRef}
        id={tooltipId}
        className="priority-card-tooltip"
        role="tooltip"
        aria-hidden={!position.ready}
        style={{ left: position.left, top: position.top, opacity: position.ready ? 1 : 0 }}
      >{tooltipText}</span>,
      document.body,
    )}
  </>;
}
