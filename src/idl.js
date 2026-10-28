import { IDL } from '@icp-sdk/core/candid';
export const idlFactory = () => {
  const Link = IDL.Record({ title: IDL.Text, url: IDL.Text });
  const Card = IDL.Record({ id: IDL.Text, title: IDL.Text, description: IDL.Text, state: IDL.Text, owner: IDL.Text, blocked: IDL.Bool, evidence: IDL.Vec(Link) });
  const Input = IDL.Record({ projectId: IDL.Text, title: IDL.Text, lead: IDL.Text, columns: IDL.Vec(IDL.Text), cards: IDL.Vec(Card), sourceRevision: IDL.Text, sourceUpdatedAt: IDL.Int });
  const Snapshot = IDL.Record({ data: Input, revision: IDL.Nat, publishedAt: IDL.Int, publishedBy: IDL.Principal });
  const CompletionEntry = IDL.Record({ cardId: IDL.Text, completedAt: IDL.Int });
  const CardArchive = IDL.Record({ projectId: IDL.Text, cardId: IDL.Text, card: Card, completedAt: IDL.Int, sourceRevision: IDL.Text, archivedAt: IDL.Int, archivedBy: IDL.Principal, manual: IDL.Bool, active: IDL.Bool, restored: IDL.Bool });
  const Definition = IDL.Record({ term: IDL.Text, definition: IDL.Text, cardId: IDL.Opt(IDL.Text) });
  const PresentationInput = IDL.Record({ summary: IDL.Text, glossary: IDL.Vec(Definition), sourceRevision: IDL.Text });
  const Presentation = IDL.Record({ projectId: IDL.Text, data: PresentationInput, publishedAt: IDL.Int, publishedBy: IDL.Principal });
  const PriorityItem = IDL.Record({ id: IDL.Text, title: IDL.Text, status: IDL.Text, blockedReason: IDL.Text, nextAction: IDL.Text, cardIds: IDL.Vec(IDL.Text) });
  const PriorityInput = IDL.Record({ items: IDL.Vec(PriorityItem), sourceRevision: IDL.Text });
  const PriorityList = IDL.Record({ projectId: IDL.Text, data: PriorityInput, publishedAt: IDL.Int, publishedBy: IDL.Principal });
  return IDL.Service({
    canManageProject: IDL.Func([IDL.Text], [IDL.Bool], ['query']),
    listArchives: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [IDL.Vec(CardArchive)], ['query']),
    listArchiveHistory: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [IDL.Vec(CardArchive)], ['query']),
    listCompletionMetadata: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [IDL.Vec(CardArchive)], ['query']),
    publishCompletionMetadata: IDL.Func([IDL.Text, IDL.Text, IDL.Vec(CompletionEntry)], [], []),
    archiveCard: IDL.Func([IDL.Text, IDL.Text, IDL.Text], [], []),
    restoreCard: IDL.Func([IDL.Text, IDL.Text, IDL.Int, IDL.Text], [Card], []),
    listPresentations: IDL.Func([], [IDL.Vec(Presentation)], ['query']),
    publishPresentation: IDL.Func([IDL.Text, PresentationInput], [], []),
    listPriorities: IDL.Func([], [IDL.Vec(PriorityList)], ['query']),
    publishPriorities: IDL.Func([IDL.Text, PriorityInput], [], []),
    session: IDL.Func([], [IDL.Record({ principal: IDL.Principal, canRead: IDL.Bool, isAdmin: IDL.Bool })], ['query']),
    listBoards: IDL.Func([], [IDL.Vec(Snapshot)], ['query']),
    redeemInvite: IDL.Func([IDL.Text], [], []),
    cycleBalance: IDL.Func([], [IDL.Nat], ['query']),
    publish: IDL.Func([Input, IDL.Nat], [IDL.Nat], []),
    setInvite: IDL.Func([IDL.Text], [], []),
    setAdmin: IDL.Func([IDL.Principal, IDL.Bool], [], []),
    setViewer: IDL.Func([IDL.Principal, IDL.Bool], [], []),
    setPublisher: IDL.Func([IDL.Text, IDL.Principal, IDL.Bool], [], []),
  });
};
