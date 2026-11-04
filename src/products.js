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
