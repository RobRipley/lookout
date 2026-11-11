// Preserve the supervisor's durable order. Status only determines which item
// is the current focus; it never changes the displayed ranking.
export function firstActionablePriority(items = []) {
  return items.find(item => item.status === 'ready' || item.status === 'in_progress') ?? null;
}

// Card associations are explicit source metadata. A revision mismatch makes
// every association untrusted until the priority list is republished.
export function prioritiesForCard(priority, board, cardId) {
  if (!priority || !board || priority.data?.sourceRevision !== board.data?.sourceRevision) return [];
  return (priority.data?.items || []).flatMap((item, index) =>
    item.cardIds?.includes(cardId) ? [{ rank: index + 1, id: item.id, title: item.title }] : []
  );
}

export function priorityIsCurrent(priority, board) {
  return Boolean(priority && board && priority.data?.sourceRevision === board.data?.sourceRevision);
}

// A filter is addressed by the durable item id, never by rank. It is only
// usable while the priority list is current for the board and still has the item.
export function priorityFilterItem(priority, board, itemId) {
  if (!itemId || !priorityIsCurrent(priority, board)) return null;
  return (priority.data?.items || []).find(item => item.id === itemId) ?? null;
}

// Only explicit cardIds link a card to a sub-project; titles and owners are never inferred.
export function cardMatchesPriorityFilter(item, cardId) {
  return !item || Boolean(item.cardIds?.includes(cardId));
}

export function toggleFilterId(currentId, itemId) {
  return currentId === itemId ? null : itemId;
}
