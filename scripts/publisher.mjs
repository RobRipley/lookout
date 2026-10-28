import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/idl.js';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_HEADERS = ['ID', 'State', 'Accountable owner', 'Scope', 'Evidence / next action'];
const DEFAULT_ALLOWED_HOSTS = ['github.com', 'internetcomputer.org', 'docs.internetcomputer.org', 'dfinity.org'];

export function parseArgs(argv) {
  const parsed = { dryRun: false, publish: false, prioritiesOnly: false, config: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--publish') parsed.publish = true;
    else if (arg === '--priorities-only') parsed.prioritiesOnly = true;
    else if (arg === '--config') parsed.config = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.dryRun && parsed.publish) throw new Error('Choose either --dry-run or --publish.');
  if (!parsed.config) throw new Error('--config <manifest.json> is required.');
  return parsed;
}

function splitMarkdownRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  let codeTicks = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && !escaped) { escaped = true; cell += ch; continue; }
    if (ch === '`' && !escaped) {
      let count = 1;
      while (text[i + count] === '`') count += 1;
      codeTicks = codeTicks === 0 ? count : (codeTicks === count ? 0 : codeTicks);
      cell += '`'.repeat(count); i += count - 1; escaped = false; continue;
    }
    if (ch === '|' && !escaped && codeTicks === 0) { cells.push(unescapeCell(cell)); cell = ''; escaped = false; continue; }
    cell += ch;
    escaped = false;
  }
  cells.push(unescapeCell(cell));
  return cells.map((part) => part.trim());
}

function unescapeCell(value) {
  return value.replace(/\\\|/g, '|').replace(/\\\\/g, '\\').replace(/<br\s*\/?>/gi, '\n').trim();
}

function selectSection(markdown, heading) {
  if (typeof heading !== 'string' || !heading.trim()) throw new Error('An exact sectionHeading is required.');
  const lines = markdown.split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i += 1) if (lines[i].trim() === heading) matches.push(i);
  if (matches.length !== 1) throw new Error(`Expected one exact section heading ${JSON.stringify(heading)}; found ${matches.length}.`);
  const start = matches[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^##\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

function safeField(value) {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted secret]')
    .replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, '[redacted private key]')
    .replace(/(?:\/Users\/[^\s|]+|\/home\/[^\s|]+|\/private\/[^\s|]+|[A-Za-z]:\\[^\s|]+)/g, '[redacted local path]')
    .replace(/\b(?:seed phrase|mnemonic|private key|api key|token|secret)\s*[:=]\s*[^|\n]+/gi, '[redacted secret]')
    .trim();
}

function parseLinks(markdown, allowedHosts) {
  const links = [];
  const linkPattern = /\[([^\]]{1,180})\]\((https?:\/\/[^\s)<>]+)\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    let url;
    try { url = new URL(match[2]); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
    if ([...url.searchParams.keys()].some((key) => /^(?:access_?token|api_?key|auth|code|key|secret|signature|sig|token)$/i.test(key))) continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) continue;
    const normalized = url.toString();
    if (!links.some((item) => item.url === normalized)) links.push({ title: safeField(match[1]), url: normalized });
    if (links.length === 8) break;
  }
  return links;
}

export function parseMarkdownBoard(markdown, config, modifiedNs) {
  const heading = config.source?.sectionHeading;
  if (config.source?.kind === 'curated-json') return parseCurated(markdown, config, modifiedNs);
  const selected = selectSection(markdown, heading);
  const lines = selected.split('\n');
  const tableStart = lines.findIndex((line) => /^\s*\|/.test(line));
  if (tableStart < 0 || tableStart + 1 >= lines.length) throw new Error('Selected section has no Markdown table.');
  const headers = splitMarkdownRow(lines[tableStart]);
  if (headers.length !== REQUIRED_HEADERS.length || REQUIRED_HEADERS.some((header, i) => headers[i] !== header)) {
    throw new Error(`Selected table must have exactly these columns, in order: ${REQUIRED_HEADERS.join(' | ')}.`);
  }
  if (!/^\s*\|?\s*:?-{3,}/.test(lines[tableStart + 1])) throw new Error('Malformed Markdown table separator.');
  const cards = [];
  const seen = new Set();
  for (let i = tableStart + 2; i < lines.length && /^\s*\|/.test(lines[i]); i += 1) {
    const values = splitMarkdownRow(lines[i]);
    if (values.length !== headers.length) throw new Error(`Malformed table row ${i + 1}: expected ${headers.length} cells, found ${values.length}.`);
    const [rawId, rawState, rawOwner, rawScope, rawEvidence] = values;
    const id = safeField(rawId);
    if (!id) throw new Error(`Empty card ID in row ${i + 1}.`);
    if (seen.has(id)) throw new Error(`Duplicate card ID: ${id}`);
    seen.add(id);
    const state = safeField(rawState);
    const owner = safeField(rawOwner);
    if (!state || !owner) throw new Error(`Card ${id} must have a State and Accountable owner.`);
    cards.push({
      id,
      title: safeField(rawScope).slice(0, 500) || id,
      description: `Scope: ${safeField(rawScope)}\n\nEvidence / next action: ${safeField(rawEvidence)}`,
      state,
      owner,
      blocked: /\b(blocked|waiting|external boundary)\b/i.test(state.replaceAll('_', ' ')),
      evidence: parseLinks(`${rawScope}\n${rawEvidence}`, config.allowedLinkHosts ?? DEFAULT_ALLOWED_HOSTS),
    });
  }
  if (!cards.length) throw new Error('Selected table contains no cards.');
  const sourceRevision = createHash('sha256').update(selected, 'utf8').digest('hex');
  return makeSnapshot(config, cards, sourceRevision, modifiedNs);
}

function codepointLength(value) {
  return Array.from(value).length;
}

function validatePresentation(raw, snapshot) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Presentation metadata must be a JSON object.');
  const allowed = ['summary', 'glossary', 'plainSummary'];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new Error('Presentation metadata contains a non-allowlisted field.');
  if (typeof raw.summary !== 'string' || !Array.isArray(raw.glossary)) throw new Error('Presentation metadata requires summary text and a glossary array.');
  const summary = safeField(raw.summary);
  if (codepointLength(summary) > 600) throw new Error('Presentation summary exceeds 600 characters.');
  let plainSummary;
  if (raw.plainSummary !== undefined) {
    if (typeof raw.plainSummary !== 'string') throw new Error('Presentation plainSummary must be text when provided.');
    plainSummary = safeField(raw.plainSummary);
    if (codepointLength(plainSummary) > 600) throw new Error('Presentation plainSummary exceeds 600 characters.');
  }
  if (raw.glossary.length > 200) throw new Error('Presentation glossary exceeds 200 definitions.');
  const cardIds = new Set(snapshot.cards.map((card) => card.id));
  const seen = new Set();
  let total = codepointLength(summary);
  const glossary = raw.glossary.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Glossary definition ${index} must be an object.`);
    if (Object.keys(item).some((key) => !['term', 'definition', 'cardId'].includes(key))) throw new Error(`Glossary definition ${index} contains a non-allowlisted field.`);
    if (typeof item.term !== 'string' || typeof item.definition !== 'string') throw new Error(`Glossary definition ${index} requires term and definition text.`);
    if (item.cardId !== undefined && typeof item.cardId !== 'string') throw new Error(`Glossary definition ${index} cardId must be text when provided.`);
    const term = safeField(item.term);
    const definition = safeField(item.definition);
    const cardId = item.cardId === undefined ? null : safeField(item.cardId);
    if (!term || !definition) throw new Error(`Glossary definition ${index} requires non-empty term and definition.`);
    if (codepointLength(term) > 100) throw new Error(`Glossary term ${JSON.stringify(term)} exceeds 100 characters.`);
    if (codepointLength(definition) > 1200) throw new Error(`Definition for ${JSON.stringify(term)} exceeds 1200 characters.`);
    if (cardId !== null && codepointLength(cardId) > 128) throw new Error(`Glossary cardId for ${JSON.stringify(term)} exceeds 128 characters.`);
    if (cardId !== null && !cardIds.has(cardId)) throw new Error(`Glossary definition ${JSON.stringify(term)} refers to unknown card ${JSON.stringify(cardId)}.`);
    const key = JSON.stringify([term, cardId]);
    if (seen.has(key)) throw new Error(`Duplicate glossary term/cardId pair: ${JSON.stringify(term)} / ${JSON.stringify(cardId)}.`);
    seen.add(key);
    total += codepointLength(term) + codepointLength(definition) + (cardId === null ? 0 : codepointLength(cardId));
    return { term, definition, cardId };
  });
  if (total > 70000) throw new Error('Presentation metadata exceeds 70000 total characters.');
  return { summary, glossary, ...(plainSummary === undefined ? {} : { plainSummary }), sourceRevision: snapshot.sourceRevision };
}

function parsePresentationFile(text, snapshot) {
  let raw;
  try { raw = JSON.parse(text); } catch (error) { throw new Error(`Presentation JSON is invalid: ${error.message}`); }
  return validatePresentation(raw, snapshot);
}

const PRIORITY_STATUSES = new Set(['ready', 'in_progress', 'blocked', 'paused', 'done']);

export function validatePriorities(raw, snapshot) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Priority metadata must be a JSON object.');
  if (Object.keys(raw).some((key) => key !== 'items')) throw new Error('Priority metadata contains a non-allowlisted field.');
  if (!Array.isArray(raw.items)) throw new Error('Priority metadata requires an items array.');
  if (raw.items.length > 30) throw new Error('Priority metadata exceeds 30 items.');
  const cardIds = new Set(snapshot.cards.map((card) => card.id));
  const seen = new Set();
  let total = codepointLength(snapshot.sourceRevision);
  const items = raw.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Priority item ${index} must be an object.`);
    const fields = ['id', 'title', 'status', 'blockedReason', 'nextAction', 'cardIds'];
    if (Object.keys(item).some((key) => !fields.includes(key))) throw new Error(`Priority item ${index} contains a non-allowlisted field.`);
    if (fields.some((key) => !(key in item)) || fields.slice(0, 5).some((key) => typeof item[key] !== 'string') || !Array.isArray(item.cardIds)) throw new Error(`Priority item ${index} has invalid fields.`);
    const [id, title, status, blockedReason, nextAction] = fields.slice(0, 5).map((key) => safeField(item[key]));
    if (!id || codepointLength(id) > 80) throw new Error(`Priority item ${index} id must be 1..80 characters.`);
    if (seen.has(id)) throw new Error(`Duplicate priority item id: ${id}`);
    seen.add(id);
    if (!title || codepointLength(title) > 160) throw new Error(`Priority item ${id} title must be 1..160 characters.`);
    if (!PRIORITY_STATUSES.has(status)) throw new Error(`Priority item ${id} has invalid status.`);
    if (codepointLength(blockedReason) > 600 || codepointLength(nextAction) > 600) throw new Error(`Priority item ${id} text exceeds 600 characters.`);
    if ((status === 'blocked' || status === 'paused') && !blockedReason.trim()) throw new Error(`Priority item ${id} requires a blockedReason.`);
    if ((status === 'ready' || status === 'in_progress') && !nextAction.trim()) throw new Error(`Priority item ${id} requires a nextAction.`);
    if (item.cardIds.length > 100) throw new Error(`Priority item ${id} exceeds 100 cardIds.`);
    const linked = item.cardIds.map((cardId) => {
      if (typeof cardId !== 'string') throw new Error(`Priority item ${id} cardIds must be text.`);
      const clean = safeField(cardId);
      if (!clean || codepointLength(clean) > 128 || !cardIds.has(clean)) throw new Error(`Priority item ${id} refers to invalid or unknown card ${JSON.stringify(clean)}.`);
      return clean;
    });
    if (new Set(linked).size !== linked.length) throw new Error(`Priority item ${id} repeats a cardId.`);
    total += fields.slice(0, 5).reduce((sum, key) => sum + codepointLength(key === 'id' ? id : key === 'title' ? title : key === 'status' ? status : key === 'blockedReason' ? blockedReason : nextAction), 0) + linked.reduce((sum, value) => sum + codepointLength(value), 0);
    return { id, title, status, blockedReason, nextAction, cardIds: linked };
  });
  if (total > 30000) throw new Error('Priority metadata exceeds 30000 total characters.');
  return { items, sourceRevision: snapshot.sourceRevision };
}

async function loadPriorities(config, absConfig, snapshot) {
  if (!config.priorityPath) return null;
  const file = resolve(dirname(absConfig), config.priorityPath);
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new Error(`Priority JSON is invalid: ${error.message}`); }
  return validatePriorities(raw, snapshot);
}

export function priorityCandidText(projectId, input) {
  const items = input.items.map((item) => `record { id = ${candidText(item.id)}; title = ${candidText(item.title)}; status = ${candidText(item.status)}; blockedReason = ${candidText(item.blockedReason)}; nextAction = ${candidText(item.nextAction)}; cardIds = vec { ${item.cardIds.map(candidText).join('; ')} } }`);
  return `(${candidText(projectId)}, record { items = vec { ${items.join('; ')} }; sourceRevision = ${candidText(input.sourceRevision)} })\n`;
}

// Completion timestamps are an opt-in sidecar. They are never inferred from
// card state or source-file modification time.
export function validateCompletionMetadata(raw, snapshot) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Completion metadata must be a JSON object.');
  if (Object.keys(raw).some((key) => key !== 'entries')) throw new Error('Completion metadata contains a non-allowlisted field.');
  if (!Array.isArray(raw.entries)) throw new Error('Completion metadata requires an entries array.');
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const seen = new Set();
  const entries = raw.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Completion entry ${index} must be an object.`);
    if (Object.keys(entry).some((key) => !['cardId', 'completedAt'].includes(key))) throw new Error(`Completion entry ${index} contains a non-allowlisted field.`);
    if (typeof entry.cardId !== 'string' || typeof entry.completedAt !== 'string') throw new Error(`Completion entry ${index} requires cardId and an explicit UTC completedAt timestamp.`);
    const cardId = safeField(entry.cardId);
    if (!cardId || cardId.length > 128) throw new Error(`Completion entry ${index} has an invalid cardId.`);
    if (seen.has(cardId)) throw new Error(`Duplicate completion cardId: ${cardId}`);
    seen.add(cardId);
    const card = cards.get(cardId);
    if (!card) throw new Error(`Completion metadata refers to unknown card ${JSON.stringify(cardId)}.`);
    if (!/^(?:done|complete|completed|closed)$/i.test(card.state.trim())) throw new Error(`Completion metadata card ${JSON.stringify(cardId)} is not in a completed state.`);
    // Require a UTC Z suffix and at most nanosecond precision. This avoids
    // silently guessing a timezone or truncating source precision.
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(entry.completedAt);
    if (!match) throw new Error(`Completion timestamp for ${JSON.stringify(cardId)} must be an ISO-8601 UTC timestamp ending in Z.`);
    const millis = Date.parse(`${match[1]}Z`);
    if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== match[1]) throw new Error(`Completion timestamp for ${JSON.stringify(cardId)} is not a valid calendar time.`);
    const fractional = (match[2] ?? '').padEnd(9, '0');
    const completedAt = BigInt(millis) * 1_000_000n + BigInt(fractional || '0');
    if (completedAt < 0n) throw new Error(`Completion timestamp for ${JSON.stringify(cardId)} must not precede the Unix epoch.`);
    return { cardId, completedAt };
  });
  return { sourceRevision: snapshot.sourceRevision, entries };
}

export function completionMetadataCandidText(projectId, input) {
  const entries = input.entries.map((entry) => `record { cardId = ${candidText(entry.cardId)}; completedAt = ${candidText(entry.completedAt)} }`);
  return `(${candidText(projectId)}, ${candidText(input.sourceRevision)}, vec { ${entries.join('; ')} })\n`;
}

function completionComparableTimestamp(value) {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  return value === null || value === undefined ? null : String(value);
}

export function isCompletionMetadataNoop(existingEntries, next, projectId) {
  const existing = new Map((existingEntries ?? [])
    .filter((entry) => entry.projectId === projectId && entry.active !== false)
    .map((entry) => [entry.cardId, entry]));
  return next.entries.every((entry) => {
    const prior = existing.get(entry.cardId);
    return prior && prior.sourceRevision === next.sourceRevision && completionComparableTimestamp(prior.completedAt) === String(entry.completedAt);
  });
}

const COMPLETION_METADATA_PAGE_SIZE = 5;

async function readCompletionMetadata(config, icpCall, projectId) {
  const entries = [];
  let offset = 0;
  while (true) {
    const page = await icpCall(config, 'listCompletionMetadata', `(${candidText(projectId)}, ${offset}, ${COMPLETION_METADATA_PAGE_SIZE})\n`, { query: true });
    if (!Array.isArray(page) || page.length > COMPLETION_METADATA_PAGE_SIZE) throw new Error('Completion metadata query returned an invalid page.');
    entries.push(...page);
    if (page.length < COMPLETION_METADATA_PAGE_SIZE) return entries;
    offset += page.length;
  }
}

async function loadCompletionMetadata(config, absConfig, snapshot) {
  if (!config.completionPath) return null;
  const path = resolve(dirname(absConfig), config.completionPath);
  let raw;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch (error) { throw new Error(`Completion metadata JSON is invalid: ${error.message}`); }
  return validateCompletionMetadata(raw, snapshot);
}

function comparablePriorities(value) {
  if (!value) return null;
  return { sourceRevision: value.sourceRevision, items: (value.items ?? []).map(({ id, title, status, blockedReason, nextAction, cardIds }) => ({ id, title, status, blockedReason, nextAction, cardIds: (cardIds ?? []).map(optionalText) })) };
}

export function isPriorityNoop(existing, next) {
  return JSON.stringify(comparablePriorities(existing?.data)) === JSON.stringify(comparablePriorities(next));
}

function optionalText(value) {
  if (Array.isArray(value)) return value.length === 0 ? null : String(value[0]);
  if (value === null || value === undefined) return null;
  return String(value);
}

function comparablePresentation(value) {
  if (!value) return null;
  return {
    summary: value.summary,
    glossary: (value.glossary ?? []).map((item) => ({ term: item.term, definition: item.definition, cardId: optionalText(item.cardId) })),
    sourceRevision: value.sourceRevision,
  };
}

export function isPresentationNoop(existing, next) {
  return JSON.stringify(comparablePresentation(existing?.data)) === JSON.stringify(comparablePresentation(next));
}

export function presentationCandidText(projectId, input) {
  const glossary = input.glossary.map((item) => `record { term = ${candidText(item.term)}; definition = ${candidText(item.definition)}; cardId = ${item.cardId === null ? 'null' : `opt ${candidText(item.cardId)}`} }`);
  return `(${candidText(projectId)}, record { summary = ${candidText(input.summary)}; glossary = vec { ${glossary.join('; ')} }; sourceRevision = ${candidText(input.sourceRevision)} })\n`;
}

async function loadPresentation(config, absConfig, sourceText, snapshot) {
  if (config.presentationPath) {
    const path = resolve(dirname(absConfig), config.presentationPath);
    return parsePresentationFile(await readFile(path, 'utf8'), snapshot);
  }
  if (config.source?.kind === 'curated-json') {
    const curated = JSON.parse(sourceText);
    if (curated.summary === undefined && curated.glossary === undefined && curated.plainSummary === undefined) return null;
    return validatePresentation({ summary: curated.summary, glossary: curated.glossary, ...(curated.plainSummary === undefined ? {} : { plainSummary: curated.plainSummary }) }, snapshot);
  }
  return null;
}

function parseCurated(raw, config, modifiedNs) {
  const curated = JSON.parse(raw);
  if (!Array.isArray(curated.cards)) throw new Error('Curated input must contain a cards array.');
  const seen = new Set();
  const cards = curated.cards.map((card, i) => {
    if (!card || typeof card !== 'object') throw new Error(`Invalid curated card at index ${i}.`);
    const allowed = ['id', 'state', 'owner', 'scope', 'evidenceText', 'evidenceLinks'];
    if (Object.keys(card).some((key) => !allowed.includes(key))) throw new Error(`Curated card ${i} contains a non-allowlisted field.`);
    const id = safeField(String(card.id ?? ''));
    if (!id) throw new Error(`Curated card ${i} has no ID.`);
    if (seen.has(id)) throw new Error(`Duplicate card ID: ${id}`);
    seen.add(id);
    const state = safeField(String(card.state ?? ''));
    const owner = safeField(String(card.owner ?? ''));
    if (!state || !owner) throw new Error(`Curated card ${id} must have a State and Accountable owner.`);
    if (card.evidenceLinks !== undefined && !Array.isArray(card.evidenceLinks)) throw new Error(`Curated card ${id} evidenceLinks must be an array.`);
    const links = (card.evidenceLinks ?? []).flatMap((item) => {
      if (!item || typeof item !== 'object' || Object.keys(item).some((key) => !['title', 'url'].includes(key))) return [];
      return parseLinks(`[${String(item.title ?? '')}](${String(item.url ?? '')})`, config.allowedLinkHosts ?? DEFAULT_ALLOWED_HOSTS);
    });
    return {
      id, title: safeField(String(card.scope ?? '')).slice(0, 500) || id,
      description: `Scope: ${safeField(String(card.scope ?? ''))}\n\nEvidence / next action: ${safeField(String(card.evidenceText ?? ''))}`,
      state,
      owner,
      blocked: /\b(blocked|waiting|external boundary)\b/i.test(state.replaceAll('_', ' ')),
      evidence: links.slice(0, 8),
    };
  });
  const canonical = JSON.stringify(curated.cards.map((c) => ({ id: c.id, state: c.state, owner: c.owner, scope: c.scope, evidenceText: c.evidenceText, evidenceLinks: c.evidenceLinks })));
  return makeSnapshot(config, cards, createHash('sha256').update(canonical).digest('hex'), modifiedNs);
}

function makeSnapshot(config, cards, sourceRevision, modifiedNs) {
  const states = [...new Set(cards.map((card) => card.state))];
  const defaultOrder = ['Backlog', 'Ready', 'Claimed', 'In progress', 'Review', 'Done', 'Blocked', 'Cancelled'];
  const columns = config.columns ?? [...defaultOrder.filter(state => states.includes(state) || ['Backlog', 'Ready', 'In progress', 'Review', 'Done'].includes(state)), ...states.filter(state => !defaultOrder.includes(state))];
  for (const state of states) if (!columns.includes(state)) throw new Error(`State ${JSON.stringify(state)} is missing from configured columns.`);
  if (cards.length > 500) throw new Error('Board exceeds the 500 card limit.');
  if (columns.length > 12) throw new Error('Board exceeds the 12 column limit.');
  return {
    projectId: config.projectId,
    title: config.title,
    lead: config.lead,
    columns,
    cards,
    sourceRevision,
    sourceUpdatedAt: modifiedNs,
  };
}

export function candidText(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `vec { ${value.map(candidText).join('; ')} }`;
  if (value && typeof value === 'object') {
    return `record { ${Object.entries(value).map(([key, item]) => `${key} = ${candidText(item)}`).join('; ')} }`;
  }
  throw new Error(`Unsupported Candid value: ${typeof value}`);
}

export function buildCallArgs(config, method, argsFile, { query = false } = {}) {
  if (typeof config.identity !== 'string' || !config.identity.trim()) throw new Error('An explicit identity is required in the publisher config.');
  const args = ['canister', 'call', '--identity', config.identity, '--args-format', 'candid', '--args-file', argsFile, '--json'];
  if (config.environment) args.push('--environment', config.environment);
  else if (config.network) args.push('--network', config.network);
  if (query) args.push('--query');
  args.push(config.canister, method);
  return args;
}

function findBoards(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { return findBoards(JSON.parse(value), seen); } catch { return null; }
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'data' in item && 'revision' in item)) return value;
    for (const item of value) { const found = findBoards(item, seen); if (found) return found; }
    return null;
  }
  for (const item of Object.values(value)) { const found = findBoards(item, seen); if (found) return found; }
  return null;
}

function findPresentations(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { return findPresentations(JSON.parse(value), seen); } catch { return null; }
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'projectId' in item && 'data' in item && !('revision' in item))) return value;
    for (const item of value) { const found = findPresentations(item, seen); if (found) return found; }
    return null;
  }
  for (const item of Object.values(value)) { const found = findPresentations(item, seen); if (found) return found; }
  return null;
}

function findPlainSummaries(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { return findPlainSummaries(JSON.parse(value), seen); } catch { return null; }
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'projectId' in item && 'data' in item && 'publishedAt' in item && 'publishedBy' in item)) return value;
    for (const item of value) { const found = findPlainSummaries(item, seen); if (found) return found; }
    return null;
  }
  for (const item of Object.values(value)) { const found = findPlainSummaries(item, seen); if (found) return found; }
  return null;
}

export function parseIcpJson(stdout, method) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch (error) { throw new Error(`icp ${method} did not return valid JSON: ${error.message}`); }
  if (typeof parsed.response_bytes === 'string') {
    const methodType = idlFactory()._fields.find(([name]) => name === method)?.[1];
    if (!methodType) throw new Error(`Unknown Candid method: ${method}`);
    const values = IDL.decode(methodType.retTypes, Uint8Array.from(Buffer.from(parsed.response_bytes, 'hex')));
    return values[0];
  }
  if (method === 'listBoards') {
    const boards = findBoards(parsed);
    if (!boards) throw new Error(`Could not find listBoards snapshots in icp JSON response: ${JSON.stringify(parsed).slice(0, 500)}`);
    return boards;
  }
  if (method === 'listPresentations') {
    const presentations = findPresentations(parsed);
    if (!presentations) throw new Error(`Could not find listPresentations values in icp JSON response: ${JSON.stringify(parsed).slice(0, 500)}`);
    return presentations;
  }
  if (method === 'listPlainSummaries') {
    const summaries = findPlainSummaries(parsed);
    if (!summaries) throw new Error(`Could not find listPlainSummaries values in icp JSON response: ${JSON.stringify(parsed).slice(0, 500)}`);
    return summaries;
  }
  if (method === 'listProjectInfo') {
    const projectInfo = findProjectInfo(parsed);
    if (!projectInfo) throw new Error(`Could not find listProjectInfo values in icp JSON response: ${JSON.stringify(parsed).slice(0, 500)}`);
    return projectInfo;
  }
  if (method === 'listPriorities') {
    const priorities = findPresentations(parsed);
    if (!priorities) throw new Error(`Could not find listPriorities values in icp JSON response: ${JSON.stringify(parsed).slice(0, 500)}`);
    return priorities;
  }
  return parsed;
}

function findProjectInfo(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { return findProjectInfo(JSON.parse(value), seen); } catch { return null; }
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'projectId' in item && 'data' in item && 'publishedAt' in item && 'publishedBy' in item)) return value;
    for (const item of value) { const found = findProjectInfo(item, seen); if (found) return found; }
    return null;
  }
  for (const item of Object.values(value)) { const found = findProjectInfo(item, seen); if (found) return found; }
  return null;
}

export function canonicalRepository(value) {
  if (typeof value !== 'string') throw new Error('Repository must be a canonical name or owner/repository slug.');
  const input = value.trim();
  if (!input || input.length > 2048) throw new Error('Repository must be a canonical name or owner/repository slug.');
  let hostname = null;
  let path = input;
  if (/^https:\/\//i.test(input) || /^ssh:\/\//i.test(input)) {
    const rawUrlPath = /^[a-z]+:\/\/[^/?#]*(\/[^?#]*)?/i.exec(input)?.[1] ?? '';
    validateRepositoryPath(rawUrlPath);
    let url;
    try { url = new URL(input); } catch { throw new Error('Repository origin must be a valid HTTPS or SSH Git URL.'); }
    if ((url.protocol !== 'https:' && url.protocol !== 'ssh:') || url.password || (url.protocol === 'https:' && url.username) || (url.protocol === 'ssh:' && url.username && url.username !== 'git') || url.port || url.search || url.hash) {
      throw new Error('Repository origin must not contain credentials, ports, query strings, or fragments.');
    }
    hostname = url.hostname.toLowerCase();
    path = rawUrlPath.replace(/^\/+/, '').replace(/\/+$/, '');
  } else if (/^[^/@:]+@[^/:]+:.+$/.test(input)) {
    const match = /^([^/@:]+)@([^/:]+):(.+)$/.exec(input);
    if (!match || match[1] !== 'git') throw new Error('SSH repository origin must use the standard git user without embedded credentials.');
    hostname = match[2].toLowerCase();
    path = match[3];
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes(':')) throw new Error('Repository must not be a local path.');
  const parts = path.split('/');
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Repository paths must not contain dot or dot-dot segments.');
  if (parts.at(-1)?.toLowerCase().endsWith('.git')) parts[parts.length - 1] = parts.at(-1).slice(0, -4);
  if (parts.some((part) => !part || !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error('Repository must be a name or a valid owner/repository path.');
  }
  if (hostname) {
    if (!isRepositoryHostname(hostname)) throw new Error('Repository origin must have a valid hostname.');
    if (parts.length < 2) throw new Error('Repository origin must include at least owner and repository path segments.');
    path = hostname === 'github.com' || hostname === 'www.github.com'
      ? parts.join('/')
      : `${hostname}/${parts.join('/')}`;
  } else if (parts.length > 2) {
    if (!isRepositoryHostname(parts[0])) throw new Error('Multi-segment repository values must begin with a hostname.');
    path = parts[0].toLowerCase() === 'github.com' || parts[0].toLowerCase() === 'www.github.com'
      ? parts.slice(1).join('/')
      : `${parts[0].toLowerCase()}/${parts.slice(1).join('/')}`;
  } else {
    path = parts.join('/');
  }
  if (Array.from(path).length > 160) throw new Error('Repository name exceeds 160 characters.');
  return path;
}

function validateRepositoryPath(path) {
  if (path.includes('\\') || path.includes('%')) throw new Error('Repository origins must not contain encoded or local-path segments.');
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') throw new Error('Repository paths must not contain dot or dot-dot segments.');
  }
}

function isRepositoryHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname.includes('.') || hostname.length > 253) return false;
  return hostname.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export async function resolveRepository(config, sourcePath) {
  if (Object.prototype.hasOwnProperty.call(config, 'repository')) return canonicalRepository(config.repository);
  const resolvedSource = resolve(sourcePath);
  let sourceDir = dirname(resolvedSource);
  try { if ((await stat(resolvedSource)).isDirectory()) sourceDir = resolvedSource; } catch {}
  const rootResult = spawnSync('git', ['-C', sourceDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
  if (rootResult.error || rootResult.status !== 0) return null;
  const root = rootResult.stdout.trim();
  if (!root) return null;
  const remoteResult = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
  if (!remoteResult.error && remoteResult.status === 0 && remoteResult.stdout.trim()) {
    try { return canonicalRepository(remoteResult.stdout.trim()); } catch { return null; }
  }
  const rootName = basename(root);
  try { return canonicalRepository(rootName); } catch { return null; }
}

function projectInfoCandidText(projectId, repository) {
  return `(${candidText(projectId)}, record { repository = ${candidText(repository)} })\n`;
}

function isProjectInfoNoop(existing, repository) {
  return existing?.data?.repository === repository;
}

async function publishProjectInfo(config, icpCall, projectId, repository, repositoryExplicit, logger) {
  if (!repository) return { repositoryNoop: null, projectInfoResponse: null };
  const currentList = await icpCall(config, 'listProjectInfo', '()\n', { query: true });
  const current = currentList.find((item) => item.projectId === projectId) ?? null;
  if (!repositoryExplicit && current?.data?.repository) {
    if (current.data.repository !== repository) {
      logger.log(`Keeping existing repository association ${current.data.repository}; source-path inference returned ${repository}.`);
    } else {
      logger.log(`Repository association for ${projectId} is unchanged.`);
    }
    return { repositoryNoop: true, repository: current.data.repository, projectInfoResponse: null };
  }
  const repositoryNoop = isProjectInfoNoop(current, repository);
  if (repositoryNoop) {
    logger.log(`Repository association for ${projectId} is unchanged.`);
    return { repositoryNoop, repository, projectInfoResponse: null };
  }
  const boards = await icpCall(config, 'listBoards', '()\n', { query: true });
  if (!boards.some((item) => item.data?.projectId === projectId)) {
    throw new Error(`Cannot publish repository association for ${projectId} without an existing published board.`);
  }
  const projectInfoResponse = await icpCall(config, 'publishProjectInfo', projectInfoCandidText(projectId, repository), { query: false });
  const afterList = await icpCall(config, 'listProjectInfo', '()\n', { query: true });
  const after = afterList.find((item) => item.projectId === projectId) ?? null;
  if (!isProjectInfoNoop(after, repository)) throw new Error(`Repository association readback for ${projectId} did not match ${repository}.`);
  logger.log(`Published and verified repository association ${repository} for ${projectId}.`);
  return { repositoryNoop: false, repository, projectInfoResponse };
}

function plainSummaryCandidText(projectId, input) {
  return `(${candidText(projectId)}, record { summary = ${candidText(input.plainSummary)}; sourceRevision = ${candidText(input.sourceRevision)} })\n`;
}

function isPlainSummaryNoop(existing, next) {
  return Boolean(existing?.data && existing.data.summary === next.plainSummary && existing.data.sourceRevision === next.sourceRevision);
}

async function publishPlainSummary(config, icpCall, snapshot, presentation, logger) {
  if (presentation?.plainSummary === undefined) return { plainSummaryNoop: null, plainSummaryResponse: null };
  const currentList = await icpCall(config, 'listPlainSummaries', '()\n', { query: true });
  const current = currentList.find((item) => item.projectId === snapshot.projectId) ?? null;
  const plainSummaryNoop = isPlainSummaryNoop(current, presentation);
  if (plainSummaryNoop) {
    logger.log('Plain English summary is unchanged.');
    return { plainSummaryNoop, plainSummaryResponse: null };
  }
  const boards = await icpCall(config, 'listBoards', '()\n', { query: true });
  const liveBoard = boards.find((item) => item.data?.projectId === snapshot.projectId) ?? null;
  if (!liveBoard || liveBoard.data.sourceRevision !== snapshot.sourceRevision) {
    throw new Error(`Board ${snapshot.projectId} changed before plain summary publish; refusing to bind metadata to a stale source revision.`);
  }
  const plainSummaryResponse = await icpCall(config, 'publishPlainSummary', plainSummaryCandidText(snapshot.projectId, presentation), { query: false });
  const afterList = await icpCall(config, 'listPlainSummaries', '()\n', { query: true });
  const after = afterList.find((item) => item.projectId === snapshot.projectId) ?? null;
  if (!isPlainSummaryNoop(after, presentation)) throw new Error(`Plain English summary readback for ${snapshot.projectId} did not match the requested metadata.`);
  logger.log(`Published and verified plain English summary for ${snapshot.projectId} at source revision ${snapshot.sourceRevision}.`);
  return { plainSummaryNoop: false, plainSummaryResponse };
}

function normalizedComparable(snapshot) {
  const { sourceUpdatedAt, ...rest } = snapshot;
  return JSON.stringify(rest, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}

export function isNoop(existing, next) {
  if (!existing) return false;
  return existing.data?.sourceRevision === next.sourceRevision && normalizedComparable(existing.data) === normalizedComparable(next);
}

async function callIcp(config, method, candidArgs, { query = false } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'lookout-publisher-'));
  const file = resolve(dir, 'args.did');
  try {
    await writeFile(file, candidArgs, { mode: 0o600 });
    const args = buildCallArgs(config, method, file, { query });
    const result = spawnSync(config.icpExecutable ?? 'icp', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    if (result.error) throw new Error(`Could not run icp: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`icp ${method} failed (${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 1200)}`);
    return parseIcpJson(result.stdout, method);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runPrioritiesOnly(config, absConfig, publish, logger, icpCall) {
  if (!config.projectId || !config.canister || !config.priorityPath || !config.identity) {
    throw new Error('Priorities-only mode requires projectId, canister, identity, and priorityPath.');
  }
  const boards = await icpCall(config, 'listBoards', '()\n', { query: true });
  const board = boards.find((item) => item.data?.projectId === config.projectId) ?? null;
  if (!board) throw new Error(`No published board exists for ${config.projectId}; priorities cannot be bound.`);
  const priorities = await loadPriorities(config, absConfig, board.data);
  const currentList = await icpCall(config, 'listPriorities', '()\n', { query: true });
  const current = currentList.find((item) => item.projectId === config.projectId) ?? null;
  const noop = isPriorityNoop(current, priorities);
  logger.log(`${publish ? 'PUBLISH' : 'DRY RUN'} priorities for ${config.projectId}, bound to source revision ${priorities.sourceRevision}${noop ? ' (unchanged)' : ''}.`);
  if (!publish || noop) {
    if (!publish) logger.log('No upload occurred. Re-run with --publish --priorities-only to publish this sidecar.');
    return { outcome: publish ? 'noop' : 'dry-run', priorities, priorityNoop: noop, sourceRevision: priorities.sourceRevision };
  }
  const response = await icpCall(config, 'publishPriorities', priorityCandidText(config.projectId, priorities), { query: false });
  const afterList = await icpCall(config, 'listPriorities', '()\n', { query: true });
  const after = afterList.find((item) => item.projectId === config.projectId) ?? null;
  if (!isPriorityNoop(after, priorities)) throw new Error(`Priority readback for ${config.projectId} did not match the requested metadata.`);
  logger.log(`Published and verified priorities for ${config.projectId} at source revision ${priorities.sourceRevision}.`);
  return { outcome: 'published', priorities, priorityNoop: false, priorityResponse: response, sourceRevision: priorities.sourceRevision };
}

export async function runPublisher({ configPath, publish = false, prioritiesOnly = false, logger = console, icpCall = callIcp }) {
  const absConfig = resolve(configPath);
  const config = JSON.parse(await readFile(absConfig, 'utf8'));
  if (prioritiesOnly) return runPrioritiesOnly(config, absConfig, publish, logger, icpCall);
  if (!config.projectId || !config.title || !config.lead || !config.canister || !config.source?.path) throw new Error('Manifest requires projectId, title, lead, canister, and source.path.');
  const sourcePath = resolve(config.source.path);
  const [source, sourceStat] = await Promise.all([readFile(sourcePath, 'utf8'), stat(sourcePath, { bigint: true })]);
  const snapshot = parseMarkdownBoard(source, config, sourceStat.mtimeNs);
  const repositoryExplicit = Object.prototype.hasOwnProperty.call(config, 'repository');
  let repository = await resolveRepository(config, sourcePath);
  const presentation = await loadPresentation(config, absConfig, source, snapshot);
  const priorities = await loadPriorities(config, absConfig, snapshot);
  const completionMetadata = await loadCompletionMetadata(config, absConfig, snapshot);
  const boards = await icpCall(config, 'listBoards', '()\n', { query: true });
  const existing = boards.find((board) => board.data?.projectId === snapshot.projectId) ?? null;
  const boardNoop = isNoop(existing, snapshot);
  const expectedRevision = existing ? BigInt(existing.revision) : 0n;
  let completionNoop = null;
  if (completionMetadata?.entries.length) {
    const currentCompletion = await readCompletionMetadata(config, icpCall, snapshot.projectId);
    completionNoop = isCompletionMetadataNoop(currentCompletion, completionMetadata, snapshot.projectId);
  }
  logger.log(`${publish ? 'PUBLISH' : 'DRY RUN'} ${snapshot.title}: ${snapshot.cards.length} cards, source revision ${snapshot.sourceRevision}, expected revision ${expectedRevision}${boardNoop ? ' (board unchanged)' : ''}.`);
  if (!publish) {
    let presentationNoop = null;
    let plainSummaryNoop = null;
    if (presentation) {
      const existingPresentations = await icpCall(config, 'listPresentations', '()\n', { query: true });
      const currentPresentation = existingPresentations.find((item) => item.projectId === snapshot.projectId) ?? null;
      presentationNoop = isPresentationNoop(currentPresentation, presentation);
      logger.log(presentationNoop ? 'Presentation metadata is unchanged.' : 'Presentation metadata would be published with this source revision.');
      if (presentation.plainSummary !== undefined) {
        const existingPlainSummaries = await icpCall(config, 'listPlainSummaries', '()\n', { query: true });
        const currentPlainSummary = existingPlainSummaries.find((item) => item.projectId === snapshot.projectId) ?? null;
        plainSummaryNoop = isPlainSummaryNoop(currentPlainSummary, presentation);
        logger.log(plainSummaryNoop ? 'Plain English summary is unchanged.' : 'Plain English summary would be published with this source revision.');
      }
    }
    let priorityNoop = null;
    if (priorities) {
      const existingPriorities = await icpCall(config, 'listPriorities', '()\n', { query: true });
      const currentPriorities = existingPriorities.find((item) => item.projectId === snapshot.projectId) ?? null;
      priorityNoop = isPriorityNoop(currentPriorities, priorities);
      logger.log(priorityNoop ? 'Priority metadata is unchanged.' : 'Priority metadata would be published with this source revision.');
    }
    let repositoryNoop = null;
    if (repository) {
      const existingProjectInfo = await icpCall(config, 'listProjectInfo', '()\n', { query: true });
      const currentProjectInfo = existingProjectInfo.find((item) => item.projectId === snapshot.projectId) ?? null;
      if (!repositoryExplicit && currentProjectInfo?.data?.repository) {
        const inferred = repository;
        repository = currentProjectInfo.data.repository;
        repositoryNoop = true;
        logger.log(inferred === repository
          ? 'Repository association is unchanged.'
          : `Keeping existing repository association ${repository}; source-path inference returned ${inferred}.`);
      } else {
        repositoryNoop = isProjectInfoNoop(currentProjectInfo, repository);
        logger.log(repositoryNoop ? 'Repository association is unchanged.' : `Repository association would be published as ${repository}.`);
      }
    }
    logger.log('No upload occurred. Re-run with --publish to publish this snapshot.');
    if (completionMetadata?.entries.length) logger.log(completionNoop ? 'Completion metadata is unchanged.' : `Completion metadata would publish ${completionMetadata.entries.length} explicit UTC timestamp${completionMetadata.entries.length === 1 ? '' : 's'}.`);
    return { outcome: 'dry-run', snapshot, repository, repositoryNoop, presentation, presentationNoop, plainSummaryNoop, priorities, priorityNoop, completionMetadata, completionNoop, expectedRevision: expectedRevision.toString() };
  }
  let boardResponse = null;
  if (boardNoop) {
    logger.log(`Board ${snapshot.projectId} already has this source revision; skipping board publish.`);
  } else {
    const args = `(${candidText(snapshot)}, ${expectedRevision})\n`;
    boardResponse = await icpCall(config, 'publish', args, { query: false });
    logger.log(`Published board ${snapshot.projectId}; backend revision ${String(boardResponse?.revision ?? boardResponse?.result ?? boardResponse)}.`);
  }
  let presentationResponse = null;
  let presentationNoop = null;
  if (presentation) {
    if (!boardNoop && presentation) {
      const readback = await icpCall(config, 'listBoards', '()\n', { query: true });
      const currentBoard = readback.find((item) => item.data?.projectId === snapshot.projectId) ?? null;
      if (!currentBoard || currentBoard.data.sourceRevision !== snapshot.sourceRevision) {
        throw new Error(`Board ${snapshot.projectId} changed before presentation publish; refusing to bind metadata to a stale source revision.`);
      }
    }
    const currentList = await icpCall(config, 'listPresentations', '()\n', { query: true });
    const current = currentList.find((item) => item.projectId === snapshot.projectId) ?? null;
    presentationNoop = isPresentationNoop(current, presentation);
    if (presentationNoop) {
      logger.log('Presentation metadata already matches this source revision; skipping metadata publish.');
    } else {
      presentationResponse = await icpCall(config, 'publishPresentation', presentationCandidText(snapshot.projectId, presentation), { query: false });
      logger.log(`Published presentation metadata for ${snapshot.projectId} at source revision ${snapshot.sourceRevision}.`);
    }
  }
  const { plainSummaryNoop, plainSummaryResponse } = await publishPlainSummary(config, icpCall, snapshot, presentation, logger);
  const { repositoryNoop, repository: effectiveRepository, projectInfoResponse } = await publishProjectInfo(config, icpCall, snapshot.projectId, repository, repositoryExplicit, logger);
  if (effectiveRepository !== undefined) repository = effectiveRepository;
  let priorityResponse = null;
  let priorityNoop = null;
  if (priorities) {
    if (!boardNoop) {
      const readback = await icpCall(config, 'listBoards', '()\n', { query: true });
      const currentBoard = readback.find((item) => item.data?.projectId === snapshot.projectId) ?? null;
      if (!currentBoard || currentBoard.data.sourceRevision !== snapshot.sourceRevision) {
        throw new Error(`Board ${snapshot.projectId} changed before priority publish; refusing to bind metadata to a stale source revision.`);
      }
    }
    const currentList = await icpCall(config, 'listPriorities', '()\n', { query: true });
    const current = currentList.find((item) => item.projectId === snapshot.projectId) ?? null;
    priorityNoop = isPriorityNoop(current, priorities);
    if (!priorityNoop) {
      priorityResponse = await icpCall(config, 'publishPriorities', priorityCandidText(snapshot.projectId, priorities), { query: false });
      logger.log(`Published priorities for ${snapshot.projectId} at source revision ${snapshot.sourceRevision}.`);
    }
  }
  let completionResponse = null;
  if (completionMetadata?.entries.length && !completionNoop) {
    const readback = await icpCall(config, 'listBoards', '()\n', { query: true });
    const currentBoard = readback.find((item) => item.data?.projectId === snapshot.projectId) ?? null;
    if (!currentBoard || currentBoard.data.sourceRevision !== snapshot.sourceRevision) {
      throw new Error(`Board ${snapshot.projectId} changed before completion metadata publish; refusing to bind metadata to a stale source revision.`);
    }
    completionResponse = await icpCall(config, 'publishCompletionMetadata', completionMetadataCandidText(snapshot.projectId, completionMetadata), { query: false });
    const after = await readCompletionMetadata(config, icpCall, snapshot.projectId);
    if (!isCompletionMetadataNoop(after, completionMetadata, snapshot.projectId)) throw new Error(`Completion metadata readback for ${snapshot.projectId} did not match the requested timestamps.`);
    logger.log(`Published and verified ${completionMetadata.entries.length} explicit completion timestamp${completionMetadata.entries.length === 1 ? '' : 's'} for ${snapshot.projectId}.`);
  }
  if (boardNoop && (!presentation || presentationNoop) && (presentation?.plainSummary === undefined || plainSummaryNoop) && (!priorities || priorityNoop) && (!completionMetadata?.entries.length || completionNoop) && (!repository || repositoryNoop)) {
    logger.log(`No changes for ${snapshot.projectId}; board and requested presentation are current.`);
    return { outcome: 'noop', snapshot, repository, repositoryNoop, presentation, presentationNoop, plainSummaryNoop, priorities, completionMetadata, completionNoop, expectedRevision: expectedRevision.toString() };
  }
  return { outcome: 'published', snapshot, repository, repositoryNoop, presentation, priorities, completionMetadata, expectedRevision: expectedRevision.toString(), boardResponse, presentationResponse, presentationNoop, plainSummaryNoop, plainSummaryResponse, projectInfoResponse, priorityResponse, priorityNoop, completionResponse, completionNoop };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const flags = parseArgs(process.argv.slice(2));
    await runPublisher({ configPath: flags.config, publish: flags.publish, prioritiesOnly: flags.prioritiesOnly });
  } catch (error) {
    console.error(`Publisher error: ${error.message}`);
    process.exitCode = 1;
  }
}
