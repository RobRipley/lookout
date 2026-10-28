# Connect a project

Give each project a stable ID and a dedicated publisher identity. The workspace admin grants it access using `setPublisher(projectId, principal, true)`. Publisher identities need no funds for ordinary board calls; the backend pays for execution. The grant does not confer canister control or access to unrelated projects.

Copy `examples/publisher.local.json` and its example data into an ignored `.local/` directory. Set the backend, network or environment, identity, project ID, title, lead, and source paths for your own workspace. Paths are resolved relative to the manifest. All example cards are fictional.

```sh
node scripts/publisher.mjs --config .local/publisher.json --dry-run
node scripts/publisher.mjs --config .local/publisher.json --publish
node scripts/publisher.mjs --config .local/publisher.json --dry-run
```

The dry run validates inputs and reads the currently published project without writing. After publishing, the last command should report unchanged content. Identical uploads are skipped and do not reset freshness. Writes use the current revision to reject conflicting updates. If a call's outcome is unknown, reconcile by reading before retrying.

## Source formats

`curated-json` accepts the shape in `examples/board.json`: cards have `id`, `state`, `owner`, `scope`, `evidenceText`, and optional `evidenceLinks`. Preserve stable IDs and honest statuses. Curated inputs let you select the small amount of information a supervisor needs from a large internal board.

Alternatively, use `markdown-section` with an exact `source.sectionHeading`. The selected section must contain one table with these exact headers:

```markdown
## Example project

| ID | State | Accountable owner | Scope | Evidence / next action |
| --- | --- | --- | --- | --- |
| EX-1 | In progress | Alex | Build search | Local checks pass; review next. |
```

The publisher never reads other sections as tasks. Configured columns must include every source state. Evidence links must be HTTPS and on allowed hosts. Text redaction is a backstop, not a substitute for selecting safe source content: exclude secrets, private addresses, financial details, internal logs, and confidential project information before publishing.

## Summary, definitions, and priorities

`presentationPath` points to `{ "summary": "...", "glossary": [...] }`. Keep the summary under 600 characters, in plain English, and describe overall progress and the next obstacle. Glossary entries have `term`, `definition`, and optional `cardId` for a card-specific meaning. Explain local identifiers from actual project knowledge rather than guessing.

`priorityPath` points to `{ "items": [...] }`. Array order is priority order. Every item has `id`, `title`, `status`, `blockedReason`, `nextAction`, and `cardIds`. Allowed statuses are `ready`, `in_progress`, `blocked`, `paused`, and `done`. Linked IDs must exist in the current source board. The first actionable item is shown as the next focus. Card badges reflect their linked priority rank.

Supervisors should work on the highest-ranked actionable item, move to the next when blocked, and return when the higher item becomes actionable. Record who or what can unblock it and the next check. Do not sit idle merely because one item is blocked. Reassess the ranking at each meaningful checkpoint; it is a maintained source of priorities, not a second task queue.

For a ranking-only change, `--priorities-only --dry-run` and then `--priorities-only --publish` bind priorities to the existing live board revision without republishing unrelated source content.

## Completion and archives

An optional `completionPath` points to `{ "entries": [{ "cardId": "EX-2", "completedAt": "2026-01-01T12:00:00Z" }] }`. Use the actual UTC completion time, not the upload time. Only completed cards may have completion metadata. Include this metadata in ongoing publishing so 72-hour archival is based on genuine completion events. See the synthetic example for the exact shape.

## Keep it current

Publish after any meaningful task movement: state, owner, blocker, next action, completion, or priority change. Update the authoritative board and summary first, then publish the sanitized projection. Preserve the distinction between code written, tests passing, deployment, and real-world execution. A completed card is a claim about its stated scope.

The CLI does not install a timer or discover agents automatically. Put publication into the lead's existing workflow and instructions. Keep production manifests and private source files under ignored paths; never add them to this public repository.
