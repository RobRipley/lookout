import test from 'node:test';
import assert from 'node:assert/strict';
import { firstActionablePriority, prioritiesForCard } from '../src/priorities.js';

test('blocked top priority yields the next actionable item without reordering', () => {
  const items = [{ id: 'a', status: 'blocked' }, { id: 'b', status: 'ready' }, { id: 'c', status: 'in_progress' }];
  assert.equal(firstActionablePriority(items), items[1]);
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c']);
});

test('unblocked top priority remains focus', () => {
  const items = [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'ready' }];
  assert.equal(firstActionablePriority(items), items[0]);
});

test('paused and done items are excluded from focus', () => {
  assert.equal(firstActionablePriority([{ status: 'paused' }, { status: 'done' }]), null);
});

const board = { data: { sourceRevision: 'rev-1' } };
const priority = items => ({ data: { sourceRevision: 'rev-1', items } });

test('maps multiple explicit card links in current durable rank order', () => {
  const list = priority([
    { id: 'later', title: 'Second project', cardIds: ['CARD-1'] },
    { id: 'first', title: 'First project', cardIds: ['CARD-1', 'CARD-2'] },
    { id: 'unrelated', title: 'Unrelated', cardIds: ['CARD-2'] },
  ]);
  assert.deepEqual(prioritiesForCard(list, board, 'CARD-1').map(({ rank, title }) => ({ rank, title })), [
    { rank: 1, title: 'Second project' },
    { rank: 2, title: 'First project' },
  ]);
});

test('returns no association for unmapped cards or stale priority revisions', () => {
  const list = priority([{ id: 'p', title: 'A project', cardIds: ['CARD-1'] }]);
  assert.deepEqual(prioritiesForCard(list, board, 'CARD-2'), []);
  assert.deepEqual(prioritiesForCard({ ...list, data: { ...list.data, sourceRevision: 'rev-old' } }, board, 'CARD-1'), []);
  assert.deepEqual(prioritiesForCard(list, null, 'CARD-1'), []);
});

test('rank follows current array order after supervisor reorders items', () => {
  const reordered = priority([
    { id: 'second', title: 'Second project', cardIds: ['CARD-1'] },
    { id: 'first', title: 'First project', cardIds: ['CARD-1'] },
  ]);
  assert.deepEqual(prioritiesForCard(reordered, board, 'CARD-1').map(item => [item.id, item.rank]), [
    ['second', 1], ['first', 2],
  ]);
});
