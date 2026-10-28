import test from 'node:test';
import assert from 'node:assert/strict';
import { createColumnHelpers } from '../src/boardColumns.js';

const { boardColumns, cardInColumn } = createColumnHelpers(['example-bridge']);

test('configured project merges only case variants of done and blocked without losing cards', () => {
  const board = { projectId: 'example-bridge', columns: ['Backlog', 'Done', 'done', 'Blocked', 'blocked'] };
  assert.deepEqual(boardColumns(board), ['Backlog', 'Done', 'Blocked']);
  assert.equal(cardInColumn(board.projectId, 'done', 'Done'), true);
  assert.equal(cardInColumn(board.projectId, 'blocked', 'Blocked'), true);
  assert.equal(cardInColumn(board.projectId, 'done', 'Blocked'), false);
});

test('unconfigured projects retain exact source columns and state matching', () => {
  const board = { projectId: 'other', columns: ['Done', 'done'] };
  assert.deepEqual(boardColumns(board), board.columns);
  assert.equal(cardInColumn(board.projectId, 'done', 'Done'), false);
});
