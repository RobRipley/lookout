// Membership alone never invents a priority.
export const productStatuses = ['ready', 'in_progress', 'blocked', 'paused', 'done'];
export function productProjects(product, boards) {
  const members = new Set(product.data.projectIds);
  const available = new Map(boards.filter(b => members.has(b.data.projectId)).map(b => [b.data.projectId, b]));
  const ranked = product.items.filter(item => available.has(item.projectId)).map((item, index) => ({ ...item, rank: index + 1, board: available.get(item.projectId) }));
  const published = new Set(ranked.map(item => item.projectId));
  const unranked = [...available.values()].filter(b => !published.has(b.data.projectId)).sort((a,b) => a.data.title.localeCompare(b.data.title)).map(board => ({projectId: board.data.projectId, board, rank: null, status: '', blockedReason: '', nextAction: ''}));
  return [...ranked, ...unranked];
}
export function otherProductBoards(products, boards) {
  const assigned = new Set(products.flatMap(product => product.data.projectIds));
  return boards.filter(board => !assigned.has(board.data.projectId));
}
export function productFocus(product, boards) {
  return productProjects(product, boards).find(item => item.rank !== null && ['ready','in_progress'].includes(item.status) && !item.blockedReason.trim()) || null;
}
export function priorityInput(entry) { return {projectId: entry.projectId, status: entry.status || 'ready', blockedReason: entry.blockedReason || '', nextAction: entry.nextAction || ''}; }
// Freshness of a product's last published update (updatedAt in nanoseconds, normally bigint).
// Missing, non-positive, malformed, or implausibly future values are 'unknown', never fresh.
const DAY_MS = 86400000, FUTURE_SKEW_MS = 300000;
export function productFreshness(updatedAt, now = Date.now()) {
  let ms;
  if (typeof updatedAt === 'bigint') ms = Number(updatedAt / 1000000n);
  else if (typeof updatedAt === 'number' && Number.isInteger(updatedAt)) ms = Math.floor(updatedAt / 1e6);
  if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(now) || ms - now > FUTURE_SKEW_MS) return {state: 'unknown', label: 'Update time unavailable', title: 'This product has no valid updated time.'};
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  const label = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return {state: now - ms > DAY_MS ? 'stale' : 'fresh', label: `Updated ${label}`, title: `Product updated ${new Date(ms).toLocaleString()}`};
}
