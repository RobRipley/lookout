import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBoardsByRepository } from '../src/repositories.js';

const board = (projectId, title) => ({ data: { projectId, title } });
const info = (projectId, repository) => ({ projectId, data: { repository } });

test('groups visible projects by repository regardless of project title', () => {
  const boards = [board('one', 'Search'), board('two', 'Payments'), board('three', 'Search')];
  const groups = groupBoardsByRepository(boards, [info('one', 'Owner/website'), info('two', 'owner/website'), info('three', 'owner/service')]);
  assert.deepEqual(groups.map(group => [group.label, group.boards.map(item => item.data.projectId)]), [['service', ['three']], ['website', ['two', 'one']]]);
  assert.deepEqual(boards.map(item => item.data.projectId), ['one', 'two', 'three']);
});

test('new repositories naturally form their own group and duplicate names stay distinguishable', () => {
  const groups = groupBoardsByRepository([board('a', 'Alpha'), board('b', 'Beta')], [info('a', 'alice/app'), info('b', 'bob/app')]);
  assert.deepEqual(groups.map(group => group.label), ['alice/app', 'bob/app']);
});

test('legacy projects stay visible without guessing a repository from their title', () => {
  const groups = groupBoardsByRepository([board('a', 'Website'), board('b', 'Matches a repository name')], [info('a', 'owner/website')]);
  assert.deepEqual(groups.map(group => [group.label, group.boards.length]), [['website', 1], ['Other projects', 1]]);
  assert.equal(groups[1].boards[0].data.projectId, 'b');
});

test('unused metadata creates no visible group and valid repository names cannot collide with fallback', () => {
  const groups = groupBoardsByRepository([board('a', 'Known'), board('b', 'Legacy')], [info('a', '__unassigned__'), info('hidden', 'owner/private-hidden')]);
  assert.equal(groups.length, 2);
  assert.equal(groups.some(group => group.repository === 'owner/private-hidden'), false);
  assert.deepEqual(groups.map(group => group.boards[0].data.projectId), ['a', 'b']);
});
