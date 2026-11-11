import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritiesForCard, priorityIsCurrent, priorityFilterItem, cardMatchesPriorityFilter, toggleFilterId } from '../src/priorities.js';

const board = { data: { sourceRevision: 'rev-1' } };
const priority = items => ({ data: { sourceRevision: 'rev-1', items } });
const cards = ['CARD-1', 'CARD-2', 'CARD-3', 'CARD-4'];
// Real matching through the helpers the app composes: durable id -> item -> explicit cardIds.
const visible = (list, boardValue, itemId) => {
  const item = priorityFilterItem(list, boardValue, itemId);
  return cards.filter(id => cardMatchesPriorityFilter(item, id));
};
const items = () => [
  { id: 'alpha', title: 'Alpha', cardIds: ['CARD-1', 'CARD-2'] },
  { id: 'beta', title: 'Beta', cardIds: ['CARD-2'] },
  { id: 'empty', title: 'Alpha', cardIds: [] },
];

test('filter matches only explicit cardIds, including cards linked to multiple items', () => {
  const list = priority(items());
  assert.deepEqual(visible(list, board, 'alpha'), ['CARD-1', 'CARD-2']);
  assert.deepEqual(visible(list, board, 'beta'), ['CARD-2']);
});

test('no title inference: an item sharing a title with another matches only its own cardIds', () => {
  assert.deepEqual(visible(priority(items()), board, 'empty'), []);
});

test('no selection leaves every card visible', () => {
  assert.deepEqual(visible(priority(items()), board, null), cards);
});

test('stale priority revision makes the filter unavailable', () => {
  const stale = { data: { sourceRevision: 'rev-old', items: items() } };
  assert.equal(priorityIsCurrent(stale, board), false);
  assert.equal(priorityFilterItem(stale, board, 'alpha'), null);
});

test('missing priority, missing board, and unknown item yield no filter item', () => {
  assert.equal(priorityFilterItem(null, board, 'alpha'), null);
  assert.equal(priorityFilterItem(priority(items()), null, 'alpha'), null);
  assert.equal(priorityFilterItem(priority(items()), board, 'unknown'), null);
});

test('removed item invalidates a previously selected id', () => {
  const list = priority(items().filter(item => item.id !== 'alpha'));
  assert.equal(priorityFilterItem(list, board, 'alpha'), null);
});

test('selection follows durable id across rank reorder', () => {
  const [a, b, c] = items();
  const reordered = priority([c, b, a]);
  assert.equal(priorityFilterItem(reordered, board, 'alpha').id, 'alpha');
  assert.deepEqual(visible(reordered, board, 'alpha'), ['CARD-1', 'CARD-2']);
  assert.equal(prioritiesForCard(reordered, board, 'CARD-1')[0].rank, 3);
});

test('toggleFilterId selects, switches, and clears by id', () => {
  assert.equal(toggleFilterId(null, 'alpha'), 'alpha');
  assert.equal(toggleFilterId('alpha', 'alpha'), null);
  assert.equal(toggleFilterId('alpha', 'beta'), 'beta');
});
