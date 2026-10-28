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
