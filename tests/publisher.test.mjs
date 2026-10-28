import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCallArgs,
  candidText,
  completionMetadataCandidText,
  isCompletionMetadataNoop,
  isNoop,
  isPresentationNoop,
  parseArgs,
  parseIcpJson,
  parseMarkdownBoard,
  presentationCandidText,
  priorityCandidText,
  validatePriorities,
  validateCompletionMetadata,
  runPublisher,
} from '../scripts/publisher.mjs';

const heading = '## Example project — Alex (current checkpoint)';
const config = {
  projectId: 'example-project', title: 'Example project', lead: 'Alex',
  columns: ['In progress', 'Review'],
  source: { kind: 'markdown-section', sectionHeading: heading },
};

function board(rows, headingText = heading) {
  return `${headingText}\n\n| ID | State | Accountable owner | Scope | Evidence / next action |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Later\nsecret-in-another-section`;
}

test('parses escaped pipes and backtick code spans without splitting cells', () => {
  const input = board('| EX-1 | In progress | Alex | `x | y` and left\\|right | See [review](https://github.com/org/repo/pull/1) |');
  const parsed = parseMarkdownBoard(input, config, 123n);
  assert.equal(parsed.cards.length, 1);
  assert.match(parsed.cards[0].description, /x \| y/);
  assert.match(parsed.cards[0].description, /left\|right/);
  assert.deepEqual(parsed.cards[0].evidence, [{ title: 'review', url: 'https://github.com/org/repo/pull/1' }]);
  assert.equal(parsed.sourceUpdatedAt, 123n);
  assert.equal(parsed.sourceRevision.length, 64);
  assert.doesNotMatch(parsed.cards[0].description, /secret-in-another-section/);
});

test('priority validation binds source revision, preserves order, and accepts an empty list', () => {
  const snapshot = { sourceRevision: 'rev-new', cards: [{ id: 'EX-1' }] };
  const input = { items: [
    { id: 'later', title: 'Later', status: 'blocked', blockedReason: 'Waiting on review', nextAction: 'Check tomorrow', cardIds: ['EX-1'] },
    { id: 'first', title: 'First', status: 'ready', blockedReason: '', nextAction: 'Start at checkpoint', cardIds: [] },
  ] };
  const result = validatePriorities(input, snapshot);
  assert.deepEqual(result.items.map((item) => item.id), ['later', 'first']);
  assert.equal(result.sourceRevision, 'rev-new');
  assert.equal(validatePriorities({ items: [] }, snapshot).items.length, 0);
  assert.match(priorityCandidText('p', result), /sourceRevision = "rev-new"/);
});

test('priority validation rejects unknown fields, invalid bounds, and unsupported statuses', () => {
  const snapshot = { sourceRevision: 'r', cards: [{ id: 'EX-1' }] };
  const item = { id: 'x', title: 'X', status: 'ready', blockedReason: '', nextAction: 'Go', cardIds: [] };
  assert.throws(() => validatePriorities({ items: [item], extra: true }, snapshot), /non-allowlisted/);
  assert.throws(() => validatePriorities({ items: [{ ...item, status: 'unknown' }] }, snapshot), /invalid status/);
  assert.throws(() => validatePriorities({ items: [{ ...item, title: '' }] }, snapshot), /title must be/);
  assert.throws(() => validatePriorities({ items: [{ ...item, cardIds: ['MISSING'] }] }, snapshot), /unknown card/);
  assert.throws(() => validatePriorities({ items: [{ ...item, cardIds: ['EX-1', 'EX-1'] }] }, snapshot), /repeats a cardId/);
});

test('completion metadata accepts only explicit UTC timestamps for completed cards', () => {
  const snapshot = { sourceRevision: 'rev-a', cards: [{ id: 'EX-1', state: 'Done' }, { id: 'EX-2', state: 'In progress' }] };
  const result = validateCompletionMetadata({ entries: [{ cardId: 'EX-1', completedAt: '2026-10-27T12:34:56.123456789Z' }] }, snapshot);
  assert.equal(result.entries[0].completedAt, 1793104496123456789n);
  assert.equal(result.sourceRevision, 'rev-a');
  assert.throws(() => validateCompletionMetadata({ entries: [{ cardId: 'EX-1', completedAt: '2026-10-27T12:34:56' }] }, snapshot), /ending in Z/);
  assert.throws(() => validateCompletionMetadata({ entries: [{ cardId: 'EX-1', completedAt: '2026-02-30T12:34:56Z' }] }, snapshot), /valid calendar/);
  assert.throws(() => validateCompletionMetadata({ entries: [{ cardId: 'EX-2', completedAt: '2026-10-27T12:34:56Z' }] }, snapshot), /not in a completed state/);
  assert.throws(() => validateCompletionMetadata({ entries: [{ cardId: 'MISSING', completedAt: '2026-10-27T12:34:56Z' }] }, snapshot), /unknown card/);
  assert.throws(() => validateCompletionMetadata({ entries: [{ cardId: 'EX-1', completedAt: '2026-10-27T12:34:56Z' }, { cardId: 'EX-1', completedAt: '2026-10-27T12:34:57Z' }] }, snapshot), /Duplicate completion/);
  assert.match(completionMetadataCandidText('example-project', result), /completedAt = 1793104496123456789/);
  assert.equal(isCompletionMetadataNoop([{ projectId: 'example-project', cardId: 'EX-1', completedAt: result.entries[0].completedAt, sourceRevision: 'rev-a', active: true, manual: false }], result, 'example-project'), true);
  assert.equal(isCompletionMetadataNoop([{ projectId: 'example-project', cardId: 'EX-1', completedAt: result.entries[0].completedAt, sourceRevision: 'rev-a', active: true, manual: true }], result, 'example-project'), true);
  assert.equal(isCompletionMetadataNoop([{ projectId: 'example-project', cardId: 'EX-1', completedAt: 0n, sourceRevision: 'rev-a', active: true, manual: true }], result, 'example-project'), false);
  assert.equal(isCompletionMetadataNoop([], result, 'example-project'), false);
});

test('preserves exact state and redacts secrets, private keys, and local paths', () => {
  const input = board('| EX-2 | In progress | Alex | Use ghp_123456789012345678901234567890123456 and /Users/example/private.txt | Private key: abc |');
  const parsed = parseMarkdownBoard(input, config, 1n);
  assert.equal(parsed.cards[0].state, 'In progress');
  assert.match(parsed.cards[0].description, /\[redacted secret\]/);
  assert.match(parsed.cards[0].description, /\[redacted local path\]/);
  assert.doesNotMatch(parsed.cards[0].description, /ghp_|\/Users\//);
});

test('rejects a missing explicit section and malformed table rows', () => {
  assert.throws(() => parseMarkdownBoard(board('| EX-1 | In progress | Alex | one | two |', '## Other section'), config, 1n), /Expected one exact section heading/);
  assert.throws(() => parseMarkdownBoard(board('| EX-1 | In progress | Alex | short |'), config, 1n), /expected 5 cells/);
  assert.throws(() => parseMarkdownBoard(`${heading}\n\n| ID | State | Owner | Scope | Evidence / next action |\n| --- | --- | --- | --- | --- |\n| EX-1 | In progress | Alex | A | B |`, config, 1n), /exactly these columns/);
});

test('rejects duplicate IDs and states missing from configured columns', () => {
  assert.throws(() => parseMarkdownBoard(board('| EX-1 | In progress | Alex | A | B |\n| EX-1 | Review | Alex | C | D |'), config, 1n), /Duplicate card ID/);
  assert.throws(() => parseMarkdownBoard(board('| EX-1 | Blocked | Alex | A | B |'), config, 1n), /missing from configured columns/);
});

test('only retains explicitly linked public HTTPS URLs on allowed hosts', () => {
  const input = board('| EX-1 | In progress | Alex | Scope [local](file:///tmp/x) | [http](http://github.com/org/repo) [external](https://example.com/x) [allowed](https://docs.internetcomputer.org/references/resource-limits/) |');
  const parsed = parseMarkdownBoard(input, config, 1n);
  assert.deepEqual(parsed.cards[0].evidence, [{ title: 'allowed', url: 'https://docs.internetcomputer.org/references/resource-limits/' }]);
});

test('escapes Candid string content and child process arguments stay an argv array', () => {
  const payload = { projectId: 'x"; system("touch /tmp/pwned")', cards: [{ description: 'quote " slash \\ newline\n' }] };
  const text = candidText(payload);
  assert.match(text, /\\"/);
  assert.match(text, /\\n/);
  assert.match(text, /system\(\\"touch/);
  const args = buildCallArgs({ identity: 'lookout-example', environment: 'local', canister: 'kanban_backend' }, 'publish', '/tmp/input with spaces.did');
  assert.throws(() => buildCallArgs({ environment: 'local', canister: 'backend' }, 'publish', '/tmp/args.did'), /explicit identity/);
  assert.ok(Array.isArray(args));
  assert.ok(args.includes('/tmp/input with spaces.did'));
  assert.deepEqual(parseArgs(['--config', 'manifest.json', '--dry-run']), { config: 'manifest.json', dryRun: true, prioritiesOnly: false, publish: false });
  assert.equal(parseArgs(['--config', 'x', '--publish', '--priorities-only']).prioritiesOnly, true);
  assert.throws(() => parseArgs(['--config', 'x', '--publish', '--dry-run']), /Choose either/);
});

test('parses JSON-wrapped board snapshots and detects an exact content no-op', () => {
  const data = { projectId: 'example-project', sourceRevision: 'abc', title: 'T', lead: 'R', columns: [], cards: [] };
  const boards = parseIcpJson(JSON.stringify({ result: [{ data, revision: 4 }] }), 'listBoards');
  assert.equal(boards[0].revision, 4);
  assert.equal(isNoop({ data: { ...data, sourceUpdatedAt: 100 }, revision: 4 }, { ...data, sourceUpdatedAt: 200 }), true);
  assert.equal(isNoop({ data: { ...data, sourceRevision: 'old' }, revision: 4 }, { ...data }), false);
});

test('dry-run never calls publish and publish uses the revision read by listBoards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-publisher-test-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const configPath = join(dir, 'manifest.json');
    await writeFile(sourcePath, board('| EX-1 | In progress | Alex | Scope | Evidence |'));
    const manifest = { ...config, canister: 'backend', source: { ...config.source, path: sourcePath } };
    await writeFile(configPath, JSON.stringify(manifest));
    const calls = [];
    const icpCall = async (_config, method, args, options) => {
      calls.push({ method, args, options });
      if (method === 'listBoards') return [{ data: { projectId: 'example-project', sourceRevision: 'old' }, revision: 9 }];
      return { result: 10 };
    };
    const logger = { log() {} };
    const dry = await runPublisher({ configPath, logger, icpCall });
    assert.equal(dry.outcome, 'dry-run');
    assert.equal(dry.expectedRevision, '9');
    assert.deepEqual(calls.map((call) => call.method), ['listBoards']);
    calls.length = 0;
    const published = await runPublisher({ configPath, publish: true, logger, icpCall });
    assert.equal(published.outcome, 'published');
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'publish']);
    assert.equal(calls[1].args.endsWith(', 9)\n'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('completion sidecar updates with an unchanged board revision and verifies readback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-completion-test-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const completionPath = join(dir, 'completion.json');
    const configPath = join(dir, 'manifest.json');
    await writeFile(sourcePath, board('| EX-1 | Done | Alex | Scope | Evidence |'));
    await writeFile(completionPath, JSON.stringify({ entries: [{ cardId: 'EX-1', completedAt: '2026-10-27T12:34:56Z' }] }));
    const manifest = { ...config, columns: ['Done'], canister: 'backend', source: { ...config.source, path: sourcePath }, completionPath };
    await writeFile(configPath, JSON.stringify(manifest));
    const sourceStat = await stat(sourcePath, { bigint: true });
    const snapshot = parseMarkdownBoard(await readFile(sourcePath, 'utf8'), manifest, sourceStat.mtimeNs);
    let completionRows = [...Array.from({ length: 4 }, (_, index) => ({ projectId: 'example-project', cardId: `OLD-${index}`, completedAt: 1n, sourceRevision: 'old-rev', active: true, manual: false })), { projectId: 'example-project', cardId: 'EX-1', completedAt: 0n, sourceRevision: snapshot.sourceRevision, active: true, manual: true }];
    const calls = [];
    const icpCall = async (_config, method, args) => {
      calls.push({ method, args });
      if (method === 'listBoards') return [{ data: snapshot, revision: 7 }];
      if (method === 'listCompletionMetadata') {
        const offset = Number(/, (\d+), 5\)/.exec(args)[1]);
        assert.match(args, /^\("example-project",/);
        return completionRows.slice(offset, offset + 5);
      }
      if (method === 'publishCompletionMetadata') {
        const completedAt = BigInt(/completedAt = (\d+)/.exec(args)[1]);
        completionRows = completionRows.map((row) => row.cardId === 'EX-1' ? { ...row, completedAt, sourceRevision: snapshot.sourceRevision } : row);
        return {};
      }
      throw new Error(`Unexpected call ${method}`);
    };
    const result = await runPublisher({ configPath, publish: true, logger: { log() {} }, icpCall });
    assert.equal(result.outcome, 'published');
    assert.equal(result.completionNoop, false);
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'listCompletionMetadata', 'listCompletionMetadata', 'listBoards', 'publishCompletionMetadata', 'listCompletionMetadata', 'listCompletionMetadata']);
    assert.match(calls[4].args, new RegExp(`\\"${snapshot.sourceRevision}\\"`));
    calls.length = 0;
    const unchanged = await runPublisher({ configPath, publish: true, logger: { log() {} }, icpCall });
    assert.equal(unchanged.outcome, 'noop');
    assert.equal(unchanged.completionNoop, true);
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'listCompletionMetadata', 'listCompletionMetadata']);
    await writeFile(completionPath, JSON.stringify({ entries: [{ cardId: 'EX-1', completedAt: '2026-10-27T12:34:57Z' }] }));
    calls.length = 0;
    const updated = await runPublisher({ configPath, publish: true, logger: { log() {} }, icpCall });
    assert.equal(updated.outcome, 'published');
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'listCompletionMetadata', 'listCompletionMetadata', 'listBoards', 'publishCompletionMetadata', 'listCompletionMetadata', 'listCompletionMetadata']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('decodes the installed CLI response_bytes format', async () => {
  const { IDL } = await import('@icp-sdk/core/candid');
  const { idlFactory } = await import('../src/idl.js');
  const type = idlFactory()._fields.find(([name]) => name === 'listBoards')[1];
  const bytes = IDL.encode(type.retTypes, [[]]);
  assert.deepEqual(parseIcpJson(JSON.stringify({response_bytes: Buffer.from(bytes).toString('hex')}), 'listBoards'), []);
});

test('presentation Candid encodes optional cardId as opt text or null', () => {
  const encoded = presentationCandidText('example-project', {
    summary: 'Plain English overview', sourceRevision: 'rev-123',
    glossary: [
      { term: 'R1', definition: 'A release label.', cardId: 'EX-1' },
      { term: 'hash', definition: 'A content fingerprint.', cardId: null },
    ],
  });
  assert.match(encoded, /cardId = opt "EX-1"/);
  assert.match(encoded, /cardId = null/);
  assert.match(encoded, /sourceRevision = "rev-123"/);
});

test('presentation metadata is strict, bounded, sanitized, and card-bound', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-presentation-test-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const configPath = join(dir, 'manifest.json');
    const presentationPath = join(dir, 'presentation.json');
    await writeFile(sourcePath, board('| EX-1 | In progress | Alex | Scope | Evidence |'));
    const manifest = { ...config, canister: 'backend', source: { ...config.source, path: sourcePath }, presentationPath };
    await writeFile(configPath, JSON.stringify(manifest));
    const run = async (raw) => {
      await writeFile(presentationPath, JSON.stringify(raw));
      return runPublisher({ configPath, logger: { log() {} }, icpCall: async () => [] });
    };
    const valid = await run({ summary: 'Use ghp_123456789012345678901234567890123456 for access.', glossary: [{ term: 'PR', definition: 'Pull request.', cardId: 'EX-1' }] });
    assert.match(valid.presentation.summary, /\[redacted secret\]/);
    assert.equal(valid.presentation.glossary[0].cardId, 'EX-1');
    await assert.rejects(() => run({ summary: 'x', glossary: [], html: '<b>unsafe</b>' }), /non-allowlisted field/);
    await assert.rejects(() => run({ summary: 'x', glossary: [{ term: 'PR', definition: 'Meaning', cardId: 'MISSING' }] }), /unknown card/);
    await assert.rejects(() => run({ summary: '😀'.repeat(601), glossary: [] }), /600 characters/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('curated JSON may carry lead metadata and manifest presentationPath takes precedence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-curated-presentation-'));
  try {
    const sourcePath = join(dir, 'curated.json');
    const configPath = join(dir, 'manifest.json');
    const presentationPath = join(dir, 'presentation.json');
    const curated = {
      summary: 'Lead-authored source overview.',
      glossary: [{ term: 'R1', definition: 'A release label.', cardId: 'EX-1' }],
      cards: [{ id: 'EX-1', state: 'In progress', owner: 'Alex', scope: 'A scope', evidenceText: 'A fact.' }],
    };
    await writeFile(sourcePath, JSON.stringify(curated));
    const manifest = { ...config, canister: 'backend', source: { kind: 'curated-json', path: sourcePath } };
    await writeFile(configPath, JSON.stringify(manifest));
    const icpCall = async () => [];
    const fromSource = await runPublisher({ configPath, logger: { log() {} }, icpCall });
    assert.equal(fromSource.presentation.summary, 'Lead-authored source overview.');
    manifest.presentationPath = presentationPath;
    await writeFile(configPath, JSON.stringify(manifest));
    await writeFile(presentationPath, JSON.stringify({ summary: 'Manifest override.', glossary: [] }));
    const overridden = await runPublisher({ configPath, logger: { log() {} }, icpCall });
    assert.equal(overridden.presentation.summary, 'Manifest override.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('presentation dry-run, unchanged skip, and update use current board sourceRevision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-presentation-flow-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const configPath = join(dir, 'manifest.json');
    const presentationPath = join(dir, 'presentation.json');
    await writeFile(sourcePath, board('| EX-1 | In progress | Alex | Scope | Evidence |'));
    const manifest = { ...config, canister: 'backend', source: { ...config.source, path: sourcePath }, presentationPath };
    await writeFile(configPath, JSON.stringify(manifest));
    const writeMeta = async () => writeFile(presentationPath, JSON.stringify({ summary: 'Board overview.', glossary: [{ term: 'PR', definition: 'Pull request.', cardId: 'EX-1' }] }));
    await writeMeta();
    const sourceStat = await stat(sourcePath, { bigint: true });
    const snapshot = parseMarkdownBoard(await readFile(sourcePath, 'utf8'), manifest, sourceStat.mtimeNs);
    const currentBoard = { projectId: 'example-project', data: snapshot, revision: 5 };
    const currentPresentation = { projectId: 'example-project', data: { summary: 'Board overview.', glossary: [{ term: 'PR', definition: 'Pull request.', cardId: ['EX-1'] }], sourceRevision: snapshot.sourceRevision } };
    const calls = [];
    const runWith = async (presentationRows, publish = false) => runPublisher({
      configPath, publish, logger: { log() {} },
      icpCall: async (_config, method, args, options) => {
        calls.push({ method, args, options });
        if (method === 'listBoards') return [currentBoard];
        if (method === 'listPresentations') return presentationRows;
        return { result: 'ok' };
      },
    });

    const dry = await runWith([], false);
    assert.equal(dry.outcome, 'dry-run');
    assert.equal(dry.presentationNoop, false);
    assert.ok(calls.every((call) => call.method.startsWith('list')));
    calls.length = 0;
    const unchanged = await runWith([currentPresentation], true);
    assert.equal(unchanged.outcome, 'noop');
    assert.ok(calls.some((call) => call.method === 'listPresentations'));
    assert.ok(!calls.some((call) => call.method === 'publishPresentation'));
    calls.length = 0;
    const updated = await runWith([], true);
    assert.equal(updated.outcome, 'published');
    const metadataCall = calls.find((call) => call.method === 'publishPresentation');
    assert.ok(metadataCall);
    assert.match(metadataCall.args, new RegExp(`sourceRevision = "${snapshot.sourceRevision}"`));
    assert.match(metadataCall.args, /cardId = opt "EX-1"/);
    assert.ok(!calls.some((call) => call.method === 'publish'), 'same board revision should not republish cards');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('board publish is read back before presentation binds to its source revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-presentation-readback-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const configPath = join(dir, 'manifest.json');
    const presentationPath = join(dir, 'presentation.json');
    const oldSource = board('| EX-1 | In progress | Alex | Original scope | Evidence |');
    const newSource = board('| EX-1 | In progress | Alex | Updated scope | Evidence |');
    await writeFile(sourcePath, oldSource);
    const manifest = { ...config, canister: 'backend', source: { ...config.source, path: sourcePath }, presentationPath };
    await writeFile(configPath, JSON.stringify(manifest));
    await writeFile(presentationPath, JSON.stringify({ summary: 'Updated overview.', glossary: [] }));
    const oldStat = await stat(sourcePath, { bigint: true });
    const oldSnapshot = parseMarkdownBoard(oldSource, manifest, oldStat.mtimeNs);
    await writeFile(sourcePath, newSource);
    const newStat = await stat(sourcePath, { bigint: true });
    const newSnapshot = parseMarkdownBoard(newSource, manifest, newStat.mtimeNs);
    let currentBoard = { data: oldSnapshot, revision: 5 };
    const calls = [];
    await runPublisher({
      configPath, publish: true, logger: { log() {} },
      icpCall: async (_config, method, args) => {
        calls.push({ method, args });
        if (method === 'listBoards') return [currentBoard];
        if (method === 'publish') { currentBoard = { data: newSnapshot, revision: 6 }; return { result: 6 }; }
        if (method === 'listPresentations') return [];
        return { result: 'ok' };
      },
    });
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'publish', 'listBoards', 'listPresentations', 'publishPresentation']);
    assert.match(calls.at(-1).args, new RegExp(`sourceRevision = "${newSnapshot.sourceRevision}"`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('priority-only update is published in source order, while dry-run only queries and unconfigured manifests never wipe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-priority-flow-'));
  try {
    const sourcePath = join(dir, 'source.md');
    const configPath = join(dir, 'manifest.json');
    const priorityPath = join(dir, 'priorities.json');
    await writeFile(sourcePath, board('| EX-1 | In progress | Alex | Scope | Evidence |'));
    const manifest = { ...config, canister: 'backend', source: { ...config.source, path: sourcePath }, priorityPath };
    await writeFile(configPath, JSON.stringify(manifest));
    const priorities = { items: [
      { id: 'B', title: 'Second in rank', status: 'paused', blockedReason: 'Waiting', nextAction: '', cardIds: ['EX-1'] },
      { id: 'A', title: 'First in rank', status: 'ready', blockedReason: '', nextAction: 'Proceed', cardIds: [] },
    ] };
    await writeFile(priorityPath, JSON.stringify(priorities));
    let currentBoard;
    const calls = [];
    const icpCall = async (_config, method, args, options) => {
      calls.push({ method, args, options });
      if (method === 'listBoards') return [currentBoard];
      if (method === 'listPriorities') return [];
      if (method === 'publish') return {};
      if (method === 'publishPriorities') return { result: 'ok' };
      return {};
    };
    // Make the board itself current so only the sidecar changes.
    const sourceStat = await stat(sourcePath, { bigint: true });
    const snapshot = parseMarkdownBoard(await readFile(sourcePath, 'utf8'), manifest, sourceStat.mtimeNs);
    currentBoard = { data: snapshot, revision: 3 };
    const dry = await runPublisher({ configPath, logger: { log() {} }, icpCall });
    assert.equal(dry.outcome, 'dry-run');
    assert.equal(dry.priorityNoop, false);
    assert.ok(calls.every(({ options }) => options?.query === true));
    calls.length = 0;
    const published = await runPublisher({ configPath, publish: true, logger: { log() {} }, icpCall });
    assert.equal(published.outcome, 'published');
    assert.deepEqual(calls.map(({ method }) => method), ['listBoards', 'listPriorities', 'publishPriorities']);
    assert.ok(calls[2].args.indexOf('id = "B"') < calls[2].args.indexOf('id = "A"'));
    assert.equal(calls[2].options.query, false);

    calls.length = 0;
    delete manifest.priorityPath;
    await writeFile(configPath, JSON.stringify(manifest));
    const legacy = await runPublisher({ configPath, publish: true, logger: { log() {} }, icpCall });
    assert.equal(legacy.outcome, 'noop');
    assert.deepEqual(calls.map(({ method }) => method), ['listBoards']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('priorities-only mode never reads source or presentation files and verifies its write against the live board', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-priorities-only-'));
  try {
    const configPath = join(dir, 'manifest.json');
    const priorityPath = join(dir, 'priorities.json');
    await writeFile(configPath, JSON.stringify({ projectId: 'example-project', canister: 'backend', identity: 'lookout-example', priorityPath: 'priorities.json', source: { path: 'does-not-exist.md' }, presentationPath: 'also-does-not-exist.json' }));
    await writeFile(priorityPath, JSON.stringify({ items: [{ id: 'R1', title: 'Resume', status: 'ready', blockedReason: '', nextAction: 'Continue from checkpoint', cardIds: ['EX-1'] }] }));
    const liveBoard = { data: { projectId: 'example-project', sourceRevision: 'live-rev', cards: [{ id: 'EX-1' }] }, revision: 7 };
    let saved;
    const calls = [];
    const icpCall = async (_config, method, args, options) => {
      calls.push({ method, args, options });
      if (method === 'listBoards') return [liveBoard];
      if (method === 'listPriorities') return saved ? [saved] : [];
      if (method === 'publishPriorities') {
        saved = { projectId: 'example-project', data: { items: [{ id: 'R1', title: 'Resume', status: 'ready', blockedReason: '', nextAction: 'Continue from checkpoint', cardIds: ['EX-1'] }], sourceRevision: 'live-rev' } };
        return { result: 'ok' };
      }
      throw new Error(`unexpected method ${method}`);
    };
    const dry = await runPublisher({ configPath, prioritiesOnly: true, logger: { log() {} }, icpCall });
    assert.equal(dry.outcome, 'dry-run');
    assert.equal(dry.priorities.sourceRevision, 'live-rev');
    assert.ok(calls.every((call) => ['listBoards', 'listPriorities'].includes(call.method) && call.options.query));
    calls.length = 0;
    const published = await runPublisher({ configPath, prioritiesOnly: true, publish: true, logger: { log() {} }, icpCall });
    assert.equal(published.outcome, 'published');
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'listPriorities', 'publishPriorities', 'listPriorities']);
    assert.equal(calls[2].options.query, false);
    assert.match(calls[2].args, /sourceRevision = "live-rev"/);
    calls.length = 0;
    const noop = await runPublisher({ configPath, prioritiesOnly: true, publish: true, logger: { log() {} }, icpCall });
    assert.equal(noop.outcome, 'noop');
    assert.deepEqual(calls.map((call) => call.method), ['listBoards', 'listPriorities']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('priorities-only mode requires sidecar configuration and an existing live board', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-priorities-only-invalid-'));
  try {
    const configPath = join(dir, 'manifest.json');
    await writeFile(configPath, JSON.stringify({ projectId: 'p', canister: 'b', identity: 'i' }));
    await assert.rejects(() => runPublisher({ configPath, prioritiesOnly: true, logger: { log() {} }, icpCall: async () => [] }), /priorityPath/);
    await writeFile(configPath, JSON.stringify({ projectId: 'p', canister: 'b', identity: 'i', priorityPath: 'priorities.json' }));
    await writeFile(join(dir, 'priorities.json'), JSON.stringify({ items: [] }));
    const calls = [];
    await assert.rejects(() => runPublisher({ configPath, prioritiesOnly: true, logger: { log() {} }, icpCall: async (_config, method) => { calls.push(method); return []; } }), /No published board exists/);
    assert.deepEqual(calls, ['listBoards']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
