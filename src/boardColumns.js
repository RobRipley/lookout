const defaultAliases = (import.meta.env?.VITE_STANDARD_COLUMN_ALIASES ?? '')
  .split(',')
  .map((projectId) => projectId.trim())
  .filter(Boolean);

export function createColumnHelpers(projectIds = []) {
  const aliases = new Set(projectIds);
  const alias = (projectId, state) => aliases.has(projectId) && /^(done|blocked)$/i.test(state)
    ? state.toLowerCase()
    : state;

  function boardColumns(board) {
    const seen = new Set();
    return board.columns.flatMap((column) => {
      const key = alias(board.projectId, column);
      if (seen.has(key)) return [];
      seen.add(key);
      return [aliases.has(board.projectId) && /^(done|blocked)$/i.test(column)
        ? key[0].toUpperCase() + key.slice(1)
        : column];
    });
  }

  function cardInColumn(projectId, state, column) {
    return alias(projectId, state) === alias(projectId, column);
  }

  return { boardColumns, cardInColumn };
}

const productionHelpers = createColumnHelpers(defaultAliases);
export const boardColumns = productionHelpers.boardColumns;
export const cardInColumn = productionHelpers.cardInColumn;
