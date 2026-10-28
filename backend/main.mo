import Array "mo:core/Array";
import Char "mo:core/Char";
import Cycles "mo:core/Cycles";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Sha256 "mo:sha2/Sha256";
import Text "mo:core/Text";
import Time "mo:core/Time";

persistent actor class Backend(recoveryAdmin : Principal, inviteSecret : Text) {
  type Link = { title : Text; url : Text };
  type Card = {
    id : Text;
    title : Text;
    description : Text;
    state : Text;
    owner : Text;
    blocked : Bool;
    evidence : [Link];
  };
  type SnapshotInput = {
    projectId : Text;
    title : Text;
    lead : Text;
    columns : [Text];
    cards : [Card];
    sourceRevision : Text;
    sourceUpdatedAt : Int;
  };
  type Snapshot = {
    data : SnapshotInput;
    revision : Nat;
    publishedAt : Int;
    publishedBy : Principal;
  };
  type CompletionEntry = { cardId : Text; completedAt : Int };
  type CardArchive = {
    projectId : Text;
    cardId : Text;
    card : Card;
    completedAt : Int;
    sourceRevision : Text;
    archivedAt : Int;
    archivedBy : Principal;
    manual : Bool;
    active : Bool;
    restored : Bool;
  };
  type Session = { principal : Principal; canRead : Bool; isAdmin : Bool };
  type Publisher = { projectId : Text; principal : Principal };
  type Definition = { term : Text; definition : Text; cardId : ?Text };
  type PresentationInput = { summary : Text; glossary : [Definition]; sourceRevision : Text };
  type Presentation = {
    projectId : Text;
    data : PresentationInput;
    publishedAt : Int;
    publishedBy : Principal;
  };
  type PriorityItem = { id : Text; title : Text; status : Text; blockedReason : Text; nextAction : Text; cardIds : [Text] };
  type PriorityInput = { items : [PriorityItem]; sourceRevision : Text };
  type PriorityList = { projectId : Text; data : PriorityInput; publishedAt : Int; publishedBy : Principal };

  let maxProjects = 30;
  let maxCardsPerProject = 500;
  let maxColumns = 12;
  let maxLinksPerCard = 8;
  let maxPublisherGrants = 1_000;
  let maxViewers = 1_000;
  let maxArchiveRecords = 5_000;
  let maxArchivePage = 5;
  let maxArchiveCharacters = 4_000_000;
  // Text.size counts code points. At four UTF-8 bytes each, this remains
  // comfortably below the 2 MiB Candid payload ceiling, including overhead.
  let maxPayloadCharacters = 350_000;

  // The recovery principal is fixed at installation. Invite secrets are never
  // retained in clear text; only their SHA-256 digest persists.
  let adminRecovery = recoveryAdmin;
  var admins : [Principal] = [];
  var viewers : [Principal] = [];
  var publishers : [Publisher] = [];
  var snapshots : [Snapshot] = [];
  var archives : [CardArchive] = [];
  var presentations : [Presentation] = [];
  var priorities : [PriorityList] = [];
  var inviteDigest : Blob = Sha256.fromBlob(#sha256, inviteSecret.encodeUtf8());
  var inviteAvailable : Bool = true;

  if (inviteSecret.size() < 32 or inviteSecret.size() > 512) {
    Runtime.trap("initial invite secret must contain 32 to 512 characters");
  };
  if (adminRecovery.isAnonymous()) {
    Runtime.trap("recovery admin must be authenticated");
  };

  func fail(message : Text) : None { Runtime.trap(message) };

  func requireAuthenticated(caller : Principal) {
    if (caller.isAnonymous()) fail("anonymous caller not allowed");
  };

  func hasPrincipal(principals : [Principal], target : Principal) : Bool {
    for (principal in principals.vals()) {
      if (principal == target) return true;
    };
    false
  };

  func isAdmin(caller : Principal) : Bool {
    caller == adminRecovery or hasPrincipal(admins, caller)
  };

  func isPublisher(caller : Principal, projectId : Text) : Bool {
    for (grant in publishers.vals()) {
      if (grant.principal == caller and grant.projectId == projectId) return true;
    };
    false
  };

  func hasReadAccess(caller : Principal) : Bool {
    if (caller.isAnonymous()) return false;
    isAdmin(caller) or hasPrincipal(viewers, caller) or isAnyPublisher(caller)
  };

  func canReadProject(caller : Principal, projectId : Text) : Bool {
    isAdmin(caller) or hasPrincipal(viewers, caller) or isPublisher(caller, projectId)
  };

  func isAnyPublisher(caller : Principal) : Bool {
    for (grant in publishers.vals()) {
      if (grant.principal == caller) return true;
    };
    false
  };

  func requireAdmin(caller : Principal) {
    requireAuthenticated(caller);
    if (not isAdmin(caller)) fail("admin access required");
  };

  func hasColumn(columns : [Text], state : Text) : Bool {
    for (column in columns.vals()) {
      if (column == state) return true;
    };
    false
  };

  func validProjectId(projectId : Text) : Bool {
    if (projectId.size() == 0 or projectId.size() > 128) return false;
    for (character in projectId.toIter()) {
      let code = character.toNat32();
      let alphaNumeric = (code >= 48 and code <= 57) or
        (code >= 65 and code <= 90) or (code >= 97 and code <= 122);
      if (not alphaNumeric and character != '-' and character != '_' and character != '.') return false;
    };
    true
  };

  func validLink(link : Link) : Bool {
    if (link.title.size() == 0 or link.title.size() > 256) return false;
    if (link.url.size() < 10 or link.url.size() > 2048) return false;
    if (not link.url.startsWith(#text "https://")) return false;
    if (link.url.contains(#text "@") or link.url.contains(#text " ")) return false;
    if (link.url.startsWith(#text "https:///")) return false;
    true
  };

  func validate(input : SnapshotInput) {
    if (not validProjectId(input.projectId)) fail("invalid project id");
    if (input.title.size() == 0 or input.title.size() > 256) fail("invalid project title");
    if (input.lead.size() > 256) fail("lead is too long");
    if (input.columns.size() == 0 or input.columns.size() > maxColumns) fail("invalid column count");
    if (input.cards.size() > maxCardsPerProject) fail("too many cards");
    if (not validRevision(input.sourceRevision)) fail("source revision must be a SHA-256 hex digest");
    if (input.sourceUpdatedAt < 0) fail("invalid source timestamp");

    var payloadCharacters = input.projectId.size() + input.title.size() + input.lead.size() + input.sourceRevision.size();
    var columnPosition = 0;
    for (column in input.columns.vals()) {
      if (column.size() == 0 or column.size() > 64) fail("invalid column name");
      var priorPosition = 0;
      for (priorColumn in input.columns.vals()) {
        if (priorPosition < columnPosition and priorColumn == column) fail("duplicate column name");
        priorPosition += 1;
      };
      payloadCharacters += column.size();
      columnPosition += 1;
    };
    for (cardIndex in input.cards.keys()) {
      let card = input.cards[cardIndex];
      if (card.id.size() == 0 or card.id.size() > 128) fail("invalid card id");
      if (card.title.size() == 0 or card.title.size() > 512) fail("invalid card title");
      if (card.description.size() > 20_000) fail("card description is too long");
      if (card.owner.size() > 256) fail("card owner is too long");
      if (card.state.size() == 0 or card.state.size() > 64 or not hasColumn(input.columns, card.state)) {
        fail("card state is not a configured column");
      };
      if (card.evidence.size() > maxLinksPerCard) fail("too many evidence links");
      for (priorIndex in input.cards.keys()) {
        if (priorIndex < cardIndex and input.cards[priorIndex].id == card.id) fail("duplicate card id");
      };
      payloadCharacters += card.id.size() + card.title.size() + card.description.size() + card.state.size() + card.owner.size();
      for (link in card.evidence.vals()) {
        if (not validLink(link)) fail("invalid evidence link");
        payloadCharacters += link.title.size() + link.url.size();
      };
    };
    if (payloadCharacters > maxPayloadCharacters) fail("snapshot payload is too large");
  };

  func validRevision(revision : Text) : Bool {
    if (revision.size() != 64) return false;
    for (character in revision.toIter()) {
      let code = character.toNat32();
      let digit = code >= 48 and code <= 57;
      let lowerHex = code >= 97 and code <= 102;
      let upperHex = code >= 65 and code <= 70;
      if (not digit and not lowerHex and not upperHex) return false;
    };
    true
  };

  func findSnapshot(projectId : Text) : ?Snapshot {
    for (snapshot in snapshots.vals()) {
      if (snapshot.data.projectId == projectId) return ?snapshot;
    };
    null
  };

  func snapshotIndex(projectId : Text) : ?Nat {
    var index = 0;
    for (snapshot in snapshots.vals()) {
      if (snapshot.data.projectId == projectId) return ?index;
      index += 1;
    };
    null
  };

  func equalData(left : SnapshotInput, right : SnapshotInput) : Bool {
    left == right
  };

  func visibleTo(caller : Principal, snapshot : Snapshot) : Bool {
    isAdmin(caller) or hasPrincipal(viewers, caller) or isPublisher(caller, snapshot.data.projectId)
  };

  func visiblePresentationTo(caller : Principal, presentation : Presentation) : Bool {
    isAdmin(caller) or hasPrincipal(viewers, caller) or isPublisher(caller, presentation.projectId)
  };
  func visiblePriorityTo(caller : Principal, priority : PriorityList) : Bool {
    isAdmin(caller) or hasPrincipal(viewers, caller) or isPublisher(caller, priority.projectId)
  };

  func completedState(state : Text) : Bool {
    let normalized = state.toLower();
    normalized == "done" or normalized == "complete" or normalized == "completed" or normalized == "closed"
  };

  func cardIn(input : SnapshotInput, cardId : Text) : ?Card {
    for (card in input.cards.vals()) if (card.id == cardId) return ?card;
    null
  };

  func archiveIndex(projectId : Text, cardId : Text, completedAt : Int) : ?Nat {
    var i = 0;
    for (entry in archives.vals()) {
      if (entry.projectId == projectId and entry.cardId == cardId and entry.completedAt == completedAt and entry.active) return ?i;
      i += 1;
    };
    null
  };

  func activeArchiveIndex(projectId : Text, cardId : Text) : ?Nat {
    var i = 0;
    for (entry in archives.vals()) {
      if (entry.projectId == projectId and entry.cardId == cardId and entry.active) return ?i;
      i += 1;
    };
    null
  };

  func archivePage(entries : [CardArchive], offset : Nat, limit : Nat) : [CardArchive] {
    if (limit == 0 or limit > maxArchivePage) fail("archive page limit must be between 1 and 5");
    if (offset >= entries.size()) return [];
    var page : [CardArchive] = [];
    var index = offset;
    var remaining = limit;
    while (index < entries.size() and remaining > 0) {
      page := page.concat([entries[index]]);
      index += 1;
      remaining -= 1;
    };
    page
  };

  func cardCharacters(card : Card) : Nat {
    var size = card.id.size() + card.title.size() + card.description.size() + card.state.size() + card.owner.size();
    for (link in card.evidence.vals()) size += link.title.size() + link.url.size();
    size
  };

  func archiveEntryCharacters(entry : CardArchive) : Nat {
    entry.projectId.size() + entry.cardId.size() + entry.sourceRevision.size() + cardCharacters(entry.card) + 160
  };

  func archiveCharacters() : Nat {
    var total = 0;
    for (entry in archives.vals()) total += archiveEntryCharacters(entry);
    total
  };

  func requireArchiveCapacity(additional : Nat, replacingIndex : ?Nat) {
    var total = archiveCharacters();
    switch (replacingIndex) {
      case (?index) { total -= archiveEntryCharacters(archives[index]) };
      case null {};
    };
    if (archives.size() >= maxArchiveRecords and replacingIndex == null) fail("archive history capacity reached");
    if (total + additional > maxArchiveCharacters) fail("archive storage capacity reached");
  };

  func resetReopened(projectId : Text, input : SnapshotInput) {
    archives := Array.tabulate<CardArchive>(archives.size(), func(i) {
      let old = archives[i];
      if (old.projectId == projectId and old.active) {
        switch (cardIn(input, old.cardId)) {
          case (?card) { if (not completedState(card.state)) { { old with active = false } } else old };
          case null old;
        }
      } else old
    });
  };

  func findPresentation(projectId : Text) : ?Presentation {
    for (presentation in presentations.vals()) {
      if (presentation.projectId == projectId) return ?presentation;
    };
    null
  };
  func findPriority(projectId : Text) : ?PriorityList {
    for (priority in priorities.vals()) if (priority.projectId == projectId) return ?priority;
    null
  };
  func priorityIndex(projectId : Text) : ?Nat {
    var index = 0;
    for (priority in priorities.vals()) { if (priority.projectId == projectId) return ?index; index += 1 };
    null
  };
  func nonBlank(value : Text) : Bool {
    for (character in value.toIter()) {
      let code = character.toNat32();
      let whitespace = (code >= 9 and code <= 13) or code == 32 or code == 160 or code == 5760 or
        (code >= 8192 and code <= 8202) or code == 8232 or code == 8233 or code == 8239 or
        code == 8287 or code == 12288 or code == 65279;
      if (not whitespace) return true;
    };
    false
  };
  func validatePriorities(input : PriorityInput, current : Snapshot) {
    if (input.sourceRevision != current.data.sourceRevision) fail("priority source revision is stale");
    if (input.items.size() > 30) fail("too many priority items");
    var total = input.sourceRevision.size();
    for (index in input.items.keys()) {
      let item = input.items[index];
      if (item.id.size() == 0 or item.id.size() > 80 or not nonBlank(item.id)) fail("invalid priority id");
      if (item.title.size() == 0 or item.title.size() > 160 or not nonBlank(item.title)) fail("invalid priority title");
      if (item.status != "ready" and item.status != "in_progress" and item.status != "blocked" and item.status != "paused" and item.status != "done") fail("invalid priority status");
      if (item.blockedReason.size() > 600 or item.nextAction.size() > 600) fail("priority action text is too long");
      if ((item.status == "blocked" or item.status == "paused") and not nonBlank(item.blockedReason)) fail("blocked or paused priority requires a blocked reason");
      if ((item.status == "ready" or item.status == "in_progress") and not nonBlank(item.nextAction)) fail("actionable priority requires a next action");
      if (item.cardIds.size() > 100) fail("too many priority card ids");
      for (prior in input.items.keys()) if (prior < index and input.items[prior].id == item.id) fail("duplicate priority id");
      for (cardIndex in item.cardIds.keys()) {
        let cardId = item.cardIds[cardIndex];
        if (cardId.size() == 0 or cardId.size() > 128) fail("invalid priority card id");
        if (not containsCard(current.data.cards, cardId)) fail("priority card id does not exist");
        for (previous in item.cardIds.keys()) if (previous < cardIndex and item.cardIds[previous] == cardId) fail("duplicate priority card id");
        total += cardId.size();
      };
      total += item.id.size() + item.title.size() + item.status.size() + item.blockedReason.size() + item.nextAction.size();
    };
    if (total > 30_000) fail("priority payload is too large");
  };

  func containsCard(cards : [Card], cardId : Text) : Bool {
    for (card in cards.vals()) {
      if (card.id == cardId) return true;
    };
    false
  };

  func validatePresentation(input : PresentationInput, current : Snapshot) {
    if (input.summary.size() > 600) fail("presentation summary is too long");
    if (input.glossary.size() > 200) fail("too many glossary definitions");
    if (input.sourceRevision != current.data.sourceRevision) fail("presentation source revision is stale");

    var totalCharacters = input.summary.size() + input.sourceRevision.size();
    for (index in input.glossary.keys()) {
      let item = input.glossary[index];
      if (item.term.size() == 0 or item.term.size() > 100) fail("invalid glossary term");
      if (item.definition.size() == 0 or item.definition.size() > 1200) fail("invalid glossary definition");
      switch (item.cardId) {
        case (?cardId) {
          if (cardId.size() == 0 or cardId.size() > 128) fail("invalid glossary card id");
          if (not containsCard(current.data.cards, cardId)) fail("glossary card id does not exist");
          totalCharacters += cardId.size();
        };
        case null {};
      };
      for (previousIndex in input.glossary.keys()) {
        if (previousIndex < index) {
          let previous = input.glossary[previousIndex];
          if (previous.term == item.term and previous.cardId == item.cardId) {
            fail("duplicate glossary term scope");
          };
        };
      };
      totalCharacters += item.term.size() + item.definition.size();
    };
    if (totalCharacters > 70_000) fail("presentation payload is too large");
  };

  public shared query ({ caller }) func session() : async Session {
    let admin = not caller.isAnonymous() and isAdmin(caller);
    {
      principal = caller;
      canRead = hasReadAccess(caller);
      isAdmin = admin;
    }
  };

  public shared query ({ caller }) func listBoards() : async [Snapshot] {
    requireAuthenticated(caller);
    if (not hasReadAccess(caller)) fail("board read access required");
    snapshots.filter(func(snapshot) { visibleTo(caller, snapshot) })
  };

  public shared query ({ caller }) func canManageProject(projectId : Text) : async Bool {
    not caller.isAnonymous() and (isAdmin(caller) or isPublisher(caller, projectId))
  };

  public shared query ({ caller }) func listArchives(projectId : Text, offset : Nat, limit : Nat) : async [CardArchive] {
    requireAuthenticated(caller);
    if (not canReadProject(caller, projectId)) fail("board read access required");
    let now = Time.now();
    archivePage(archives.filter(func(entry) {
      entry.projectId == projectId and entry.active and not entry.restored and
      (entry.manual or now - entry.completedAt >= 72 * 60 * 60 * 1_000_000_000)
    }), offset, limit)
  };

  public shared query ({ caller }) func listArchiveHistory(projectId : Text, offset : Nat, limit : Nat) : async [CardArchive] {
    requireAuthenticated(caller);
    if (not canReadProject(caller, projectId)) fail("board read access required");
    archivePage(archives.filter(func(entry) { entry.projectId == projectId }), offset, limit)
  };

  public shared query ({ caller }) func listCompletionMetadata(projectId : Text, offset : Nat, limit : Nat) : async [CardArchive] {
    requireAuthenticated(caller);
    if (not canReadProject(caller, projectId)) fail("board read access required");
    archivePage(archives.filter(func(entry) { entry.projectId == projectId and entry.active and entry.completedAt > 0 }), offset, limit)
  };

  public shared ({ caller }) func publishCompletionMetadata(projectId : Text, sourceRevision : Text, entries : [CompletionEntry]) : async () {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, projectId)) fail("publisher access required");
    let snapshot = switch (findSnapshot(projectId)) { case (?value) value; case null fail("board snapshot does not exist") };
    if (snapshot.data.sourceRevision != sourceRevision) fail("stale source revision");
    if (entries.size() > maxCardsPerProject) fail("too many completion metadata entries");
    var entryIndex = 0;
    for (entry in entries.vals()) {
      var priorIndex = 0;
      for (prior in entries.vals()) {
        if (priorIndex < entryIndex and prior.cardId == entry.cardId) fail("duplicate completion card id");
        priorIndex += 1;
      };
      if (entry.completedAt < 0 or entry.completedAt > Time.now()) fail("invalid completion timestamp");
      let card = switch (cardIn(snapshot.data, entry.cardId)) { case (?value) value; case null fail("completion card id does not exist") };
      if (not completedState(card.state)) fail("completion metadata requires a completed card");
      switch (activeArchiveIndex(projectId, entry.cardId)) {
        case (?index) {
          let existing = archives[index];
          // Timestamp corrections within one uninterrupted completed cycle do
          // not reset a manual archive or a user's restore suppression.
          let updated : CardArchive = { existing with card; completedAt = entry.completedAt; sourceRevision };
          requireArchiveCapacity(archiveEntryCharacters(updated), ?index);
          archives := Array.tabulate<CardArchive>(archives.size(), func(i) { if (i == index) updated else archives[i] });
        };
        case null {
          // Reopen publication deactivates the prior cycle. A new entry is
          // therefore a new completion cycle with a fresh archive state.
          let created : CardArchive = { projectId; cardId = entry.cardId; card; completedAt = entry.completedAt; sourceRevision; archivedAt = 0; archivedBy = caller; manual = false; active = true; restored = false };
          requireArchiveCapacity(archiveEntryCharacters(created), null);
          archives := archives.concat([created]);
        };
      };
      entryIndex += 1;
    };
  };

  public shared ({ caller }) func archiveCard(projectId : Text, cardId : Text, sourceRevision : Text) : async () {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, projectId)) fail("publisher access required");
    let snapshot = switch (findSnapshot(projectId)) { case (?value) value; case null fail("board snapshot does not exist") };
    if (snapshot.data.sourceRevision != sourceRevision) fail("stale source revision");
    let card = switch (cardIn(snapshot.data, cardId)) { case (?value) value; case null fail("card id does not exist") };
    if (not completedState(card.state)) fail("only completed cards can be archived");
    switch (activeArchiveIndex(projectId, cardId)) {
      case (?index) {
        let old = archives[index];
        let updated : CardArchive = { old with card; sourceRevision; archivedAt = Time.now(); archivedBy = caller; manual = true; restored = false };
        requireArchiveCapacity(archiveEntryCharacters(updated), ?index);
        archives := Array.tabulate<CardArchive>(archives.size(), func(i) { if (i == index) updated else archives[i] });
      };
      case null {
        let created : CardArchive = { projectId; cardId; card; completedAt = 0; sourceRevision; archivedAt = Time.now(); archivedBy = caller; manual = true; active = true; restored = false };
        requireArchiveCapacity(archiveEntryCharacters(created), null);
        archives := archives.concat([created]);
      };
    };
  };

  public shared ({ caller }) func restoreCard(projectId : Text, cardId : Text, completedAt : Int, sourceRevision : Text) : async Card {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, projectId)) fail("publisher access required");
    let snapshot = switch (findSnapshot(projectId)) { case (?value) value; case null fail("board snapshot does not exist") };
    if (snapshot.data.sourceRevision != sourceRevision) fail("stale source revision");
    let currentCard = switch (cardIn(snapshot.data, cardId)) { case (?value) value; case null fail("card is no longer on the current board") };
    if (not completedState(currentCard.state)) fail("only completed cards can be restored from archive");
    switch (archiveIndex(projectId, cardId, completedAt)) {
      case (?index) {
        let old = archives[index];
        let updated : CardArchive = { old with manual = false; restored = true };
        archives := Array.tabulate<CardArchive>(archives.size(), func(i) { if (i == index) updated else archives[i] });
        currentCard
      };
      case null { fail("archive entry does not exist") };
    }
  };

  public shared query ({ caller }) func listPresentations() : async [Presentation] {
    requireAuthenticated(caller);
    if (not hasReadAccess(caller)) fail("board read access required");
    presentations.filter(func(presentation) { visiblePresentationTo(caller, presentation) })
  };
  public shared query ({ caller }) func listPriorities() : async [PriorityList] {
    requireAuthenticated(caller);
    if (not hasReadAccess(caller)) fail("board read access required");
    priorities.filter(func(priority) { visiblePriorityTo(caller, priority) })
  };
  public shared ({ caller }) func publishPriorities(projectId : Text, input : PriorityInput) : async () {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, projectId)) fail("publisher access required");
    let current = switch (findSnapshot(projectId)) { case (?snapshot) snapshot; case null fail("board snapshot does not exist") };
    validatePriorities(input, current);
    switch (findPriority(projectId)) { case (?existing) { if (existing.data == input) return }; case null {} };
    let replacement : PriorityList = { projectId; data = input; publishedAt = Time.now(); publishedBy = caller };
    switch (priorityIndex(projectId)) {
      case (?index) { priorities := Array.tabulate<PriorityList>(priorities.size(), func(i) { if (i == index) replacement else priorities[i] }) };
      case null { priorities := priorities.concat([replacement]) };
    };
  };

  public shared ({ caller }) func publish(input : SnapshotInput, expectedRevision : Nat) : async Nat {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, input.projectId)) fail("publisher access required");
    validate(input);

    let current = findSnapshot(input.projectId);
    switch (current) {
      case (?snapshot) {
        if (equalData(snapshot.data, input)) return snapshot.revision;
        if (expectedRevision != snapshot.revision) fail("revision conflict");
        resetReopened(input.projectId, input);
        let replacement : Snapshot = {
          data = input;
          revision = snapshot.revision + 1;
          publishedAt = Time.now();
          publishedBy = caller;
        };
        switch (snapshotIndex(input.projectId)) {
          case (?index) { snapshots := Array.tabulate<Snapshot>(snapshots.size(), func(i) { if (i == index) replacement else snapshots[i] }) };
          case null { fail("snapshot index invariant failed") };
        };
        replacement.revision
      };
      case null {
        if (expectedRevision != 0) fail("revision conflict");
        if (snapshots.size() >= maxProjects) fail("project limit reached");
        let created : Snapshot = {
          data = input;
          revision = 1;
          publishedAt = Time.now();
          publishedBy = caller;
        };
        snapshots := snapshots.concat([created]);
        created.revision
      };
    }
  };

  public shared ({ caller }) func publishPresentation(projectId : Text, input : PresentationInput) : async () {
    requireAuthenticated(caller);
    if (not isAdmin(caller) and not isPublisher(caller, projectId)) fail("publisher access required");
    let current = switch (findSnapshot(projectId)) {
      case (?snapshot) snapshot;
      case null fail("board snapshot does not exist");
    };
    validatePresentation(input, current);

    switch (findPresentation(projectId)) {
      case (?existing) {
        if (existing.data == input) return;
      };
      case null {};
    };

    let replacement : Presentation = {
      projectId;
      data = input;
      publishedAt = Time.now();
      publishedBy = caller;
    };
    switch (presentationIndex(projectId)) {
      case (?index) {
        presentations := Array.tabulate<Presentation>(presentations.size(), func(i) {
          if (i == index) replacement else presentations[i]
        });
      };
      case null { presentations := presentations.concat([replacement]) };
    };
  };

  func presentationIndex(projectId : Text) : ?Nat {
    var index = 0;
    for (presentation in presentations.vals()) {
      if (presentation.projectId == projectId) return ?index;
      index += 1;
    };
    null
  };

  public shared ({ caller }) func setPublisher(projectId : Text, publisher : Principal, enabled : Bool) : async () {
    requireAdmin(caller);
    if (not validProjectId(projectId)) fail("invalid project id");
    if (publisher.isAnonymous()) fail("anonymous principal cannot be a publisher");
    let exists = isPublisher(publisher, projectId);
    if (enabled and not exists) {
      if (publishers.size() >= maxPublisherGrants) fail("publisher grant limit reached");
      publishers := publishers.concat([{ projectId; principal = publisher }]);
    } else if (not enabled and exists) {
      publishers := publishers.filter(func(grant) { grant.projectId != projectId or grant.principal != publisher });
    };
  };

  // Only the fixed recovery identity can grant/revoke workspace administrators.
  public shared ({ caller }) func setAdmin(admin : Principal, enabled : Bool) : async () {
    requireAuthenticated(caller);
    if (caller != adminRecovery) fail("recovery admin required");
    if (admin.isAnonymous() or admin == adminRecovery) fail("invalid admin target");
    if (enabled and not hasPrincipal(admins, admin)) {
      if (admins.size() >= 100) fail("admin limit reached");
      admins := admins.concat([admin]);
    };
    if (not enabled) {
      admins := admins.filter(func(principal) { principal != admin });
      viewers := viewers.filter(func(principal) { principal != admin });
      publishers := publishers.filter(func(grant) { grant.principal != admin });
    };
  };

  public shared ({ caller }) func setViewer(viewer : Principal, enabled : Bool) : async () {
    requireAdmin(caller);
    if (viewer.isAnonymous()) fail("anonymous principal cannot be a viewer");
    let exists = hasPrincipal(viewers, viewer);
    if (enabled and not exists) {
      if (viewers.size() >= maxViewers) fail("viewer limit reached");
      viewers := viewers.concat([viewer]);
    };
    if (not enabled and exists) viewers := viewers.filter(func(principal) { principal != viewer });
  };

  public shared ({ caller }) func setInvite(secret : Text) : async () {
    requireAdmin(caller);
    if (secret.size() < 32 or secret.size() > 512) fail("invite secret must contain 32 to 512 characters");
    inviteDigest := Sha256.fromBlob(#sha256, secret.encodeUtf8());
    inviteAvailable := true;
  };

  public shared ({ caller }) func redeemInvite(secret : Text) : async () {
    requireAuthenticated(caller);
    if (not inviteAvailable) fail("invite is unavailable");
    if (secret.size() < 1 or secret.size() > 512) fail("invalid invite");
    let submittedDigest = Sha256.fromBlob(#sha256, secret.encodeUtf8());
    if (submittedDigest != inviteDigest) fail("invalid invite");
    // No await occurs before consuming the invite, so competing redemptions
    // cannot both observe it as available.
    inviteAvailable := false;
    if (not hasPrincipal(admins, caller)) {
      if (admins.size() >= 100) fail("admin limit reached");
      admins := admins.concat([caller]);
    };
  };

  public shared query ({ caller }) func cycleBalance() : async Nat {
    requireAdmin(caller);
    Cycles.balance()
  };
}
