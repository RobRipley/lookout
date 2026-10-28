# Connect a project

Give each project a stable ID and a dedicated publisher identity. The workspace admin grants it access using `setPublisher(projectId, principal, true)`. Publisher identities need no funds for ordinary board calls; the backend pays for execution. The grant does not confer canister control or access to unrelated projects.

Copy `examples/publisher.local.json` and its example data into an ignored `.local/` directory. Set the backend, network or environment, identity, project ID, title, lead, and source paths for your own workspace. Paths are resolved relative to the manifest. All example cards are fictional.

Set the optional `repository` field to the canonical repository name or `owner/repository` slug that owns the project shown in the sidebar. This explicit value is recommended. If the source projection lives in a different repository from the project, set `repository` to the originating project repository; the publisher cannot infer that relationship from the projection checkout. Without this field, the publisher tries the source file's Git root and `origin` remote using local read-only Git commands. It normalizes HTTPS and SSH origins to their repository slug, or uses the Git root directory name when no origin exists. It never searches from the publisher's working directory or guesses from project IDs and titles. If it cannot determine a repository, it leaves any existing association unchanged. If an association already exists, an inferred source-path value never replaces it; set `repository` explicitly to change the association.

Accepted values are a repository name such as `website`, an `owner/website` slug, a hostname-qualified slug, or an HTTPS/SSH Git origin. GitHub origins normalize to `owner/repository`; other hosts retain their lowercase hostname, and nested paths are preserved (for example, `gitlab.com/owner/group/repository`). Do not include local paths or credentials. The association is saved separately from board content, so changing it does not republish the board or reset its freshness timestamp. Regular publishing requires the project board to exist before the association is written. `--priorities-only` does not read or publish repository metadata.

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

`presentationPath` points to `{ "summary": "...", "plainSummary": "...", "glossary": [...] }`. The standard `summary` is the technical overview used by the project presentation. Keep it under 600 characters and describe overall progress and the next obstacle. Glossary entries have `term`, `definition`, and optional `cardId` for a card-specific meaning. Explain local identifiers from actual project knowledge rather than guessing.

`plainSummary` is optional and is published separately from the technical overview. Write 2–3 brief sentences for a general reader: state overall progress, what is done, what is blocked, and what happens next. Keep it under 600 Unicode codepoints. Explain acronyms and avoid unexplained hashes. Report only what has been verified; a completed software task does not imply deployment, signing, funds movement, or readiness. When the meaningful project status changes, update both summaries. The plain summary is the default view; readers can switch to the technical details. If `plainSummary` is omitted, the publisher leaves any existing plain summary untouched.

For `curated-json` sources, top-level `plainSummary` can be included beside `summary` and `glossary`. A configured `presentationPath` takes precedence over inline metadata, including the plain summary.

`priorityPath` points to `{ "items": [...] }`. Array order is priority order. Every item has `id`, `title`, `status`, `blockedReason`, `nextAction`, and `cardIds`. Allowed statuses are `ready`, `in_progress`, `blocked`, `paused`, and `done`. Linked IDs must exist in the current source board. The first actionable item is shown as the next focus. Card badges reflect their linked priority rank.

Supervisors should work on the highest-ranked actionable item, move to the next when blocked, and return when the higher item becomes actionable. Record who or what can unblock it and the next check. Do not sit idle merely because one item is blocked. Reassess the ranking at each meaningful checkpoint; it is a maintained source of priorities, not a second task queue.

For a ranking-only change, `--priorities-only --dry-run` and then `--priorities-only --publish` bind priorities to the existing live board revision without republishing unrelated source content.

## Completion and archives

An optional `completionPath` points to `{ "entries": [{ "cardId": "EX-2", "completedAt": "2026-01-01T12:00:00Z" }] }`. Use the actual UTC completion time, not the upload time. Only completed cards may have completion metadata. Include this metadata in ongoing publishing so 72-hour archival is based on genuine completion events. See the synthetic example for the exact shape.

## Keep it current

Publish after any meaningful task movement: state, owner, blocker, next action, completion, or priority change. Update the authoritative board and summary first, then publish the sanitized projection. Preserve the distinction between code written, tests passing, deployment, and real-world execution. A completed card is a claim about its stated scope.

The CLI does not install a timer or discover agents automatically. Put publication into the lead's existing workflow and instructions. Keep production manifests and private source files under ignored paths; never add them to this public repository.
