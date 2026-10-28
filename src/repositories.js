// Repository association is metadata, never a guess from a project's title.
export function groupBoardsByRepository(boards, projectInfo) {
  const repositories = new Map((projectInfo || []).map(info => [info.projectId, info.data?.repository]));
  const groups = new Map();
  for (const board of boards) {
    const raw = repositories.get(board.data.projectId);
    const repository = typeof raw === 'string' ? raw.trim() : '';
    const key = repository ? `repo:${repository.toLowerCase()}` : 'unassigned';
    if (!groups.has(key)) groups.set(key, { key, repository, label: repository.split('/').at(-1) || 'Other projects', boards: [] });
    groups.get(key).boards.push(board);
  }
  const result = [...groups.values()];
  const duplicateNames = new Map();
  for (const group of result) {
    const name = group.label.toLowerCase();
    duplicateNames.set(name, (duplicateNames.get(name) || 0) + 1);
  }
  for (const group of result) {
    if (duplicateNames.get(group.label.toLowerCase()) > 1 && group.repository) group.label = group.repository;
    group.boards.sort((a, b) => a.data.title.localeCompare(b.data.title, undefined, { sensitivity: 'base', numeric: true }));
  }
  return result.sort((a, b) => !a.repository ? 1 : !b.repository ? -1 : a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}
