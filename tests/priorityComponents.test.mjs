import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, PriorityPanel, PriorityCardBadge;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  ({ PriorityPanel } = await server.ssrLoadModule('/src/PriorityPanel.jsx'));
  ({ PriorityCardBadge } = await server.ssrLoadModule('/src/PriorityCardBadge.jsx'));
});
after(async () => { await server?.close(); });

const board = { data: { sourceRevision: 'rev-1' } };
const list = (revision = 'rev-1') => ({ data: { sourceRevision: revision, items: [
  { id: 'a', title: 'Alpha', status: 'blocked', blockedReason: 'Waiting', nextAction: 'Ask', cardIds: ['C-1'] },
  { id: 'b', title: 'Beta', status: 'ready', blockedReason: '', nextAction: '', cardIds: [] },
] } });
const render = props => renderToStaticMarkup(React.createElement(PriorityPanel, { board, onToggleFilter: () => {}, ...props }));
const buttons = html => [...html.matchAll(/<button[^>]*>/g)].map(m => m[0]);

test('filter button is a sibling of the details disclosure, never inside summary', () => {
  const html = render({ priority: list() });
  assert.doesNotMatch(html, /<summary[^>]*>(?:(?!<\/summary>).)*<button/s);
  assert.match(html, /<\/details><button[^>]*priority-filter-button/);
});

test('current item with linked cards is enabled; pressed state follows durable filterId', () => {
  const [a, b] = buttons(render({ priority: list(), filterId: 'a' }));
  assert.match(a, /aria-pressed="true"/);
  assert.doesNotMatch(a, /disabled/);
  assert.match(a, /aria-label="Filter cards by sub-project: Alpha"/);
  assert.match(b, /aria-pressed="false"/);
  assert.match(b, /disabled/); // no linked cards
});

test('stale revision disables every unpressed filter button', () => {
  const all = buttons(render({ priority: list('rev-old') }));
  assert.equal(all.length, 2);
  for (const button of all) assert.match(button, /disabled/);
});

test('numeric badge is an aria-pressed button only when linked and a toggle is supplied', () => {
  const badge = props => renderToStaticMarkup(React.createElement(PriorityCardBadge, props));
  assert.match(badge({ rank: 2, title: 'Alpha', itemId: 'a', active: true, onToggle: () => {} }), /^<button[^>]*type="button"[^>]*aria-pressed="true"/);
  assert.match(badge({ rank: 2, title: 'Alpha' }), /^<span[^>]*role="img"/);
  assert.match(badge({}), /^<span[^>]*role="img"[^>]*>\?<\/span>/);
});
