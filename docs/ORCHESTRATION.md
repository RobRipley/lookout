# Supervisor and subproject orchestration

Use this operating standard when connecting a team of agents to Lookout. Activate the team's available orchestration and board skills, such as `team-agent-orchestration`, `supervise-agent-team`, and `codex-kanban`, or their platform equivalents. If the platform has no skill mechanism, use this document as its explicit operating instructions. User instructions take precedence over a skill's default hierarchy, models, or concurrency policy.

Lookout displays the team's decisions. It does not dispatch workers, enforce capacity limits, or discover task changes automatically. Keep these rules in the actual supervisors' and orchestrators' instructions and existing workflow.

## Roles and ownership

The hierarchy is Product CTO → Project orchestrator → Subproject lead → task worker. A product CTO orders member projects and maintains the product overview; the project supervisor/orchestrator below remains accountable for the project board and its subproject priorities. Product manager access permits reading member boards and writing product overview/priorities, while project publishing retains its separate grants. See [Products](PRODUCTS.md) for explicit membership, UI, and API details.

- **Developer/owner:** sets goals, spending boundaries, and authority for protected actions.
- **Supervisor:** creates and maintains the overall project board, owns subproject priorities, allocates effort, checks progress and evidence, and ensures the live Lookout mirror stays accurate. Accountability for the board does not require personally editing every card.
- **Subproject orchestrator:** owns a defined part of the project, shapes and populates its task queue, assigns and coordinates workers within the supervisor's allocation, and keeps its cards, blockers, next actions, and evidence current.
- **Worker:** owns a bounded task and returns its result, verification, remaining limitations, and any blocker to the orchestrator.

“Subproject” means a useful, accountable part of the work, such as an integration, interface, migration, or feature. It need not be a separate repository. Reuse existing people, agents, boards, and handoffs. A small effort may combine roles; do not create an extra manager merely to match this hierarchy. Existing program coordinators and leads retain their ownership unless the user actually changes it.

## One authoritative board, maintained by the team

The supervisor establishes the project board and subproject list. Orchestrators populate and update their own tasks in that same task system. Workers report through their existing owner. One designated publisher or integration owner resolves concurrent edits and publishes the sanitized mirror; this can be the supervisor, an orchestrator, or the existing publisher. Do not introduce competing publishers or a second authoritative board.

Each actionable task should have a stable ID, subproject association, accountable owner, expected outcome, scope, dependencies, acceptance check, current state, and next action. Keep detailed engineering evidence in the source board or task detail; keep Lookout's Plain English summary readable. Where Lookout priorities link tasks, use the existing priority item's `cardIds`; do not invent another mapping format.

## Seed a useful queue, then refine it

At a fresh start, each orchestrator should identify the current subproject outcome and populate enough known work to make sustained progress toward the next useful milestone. A shaped queue must survive the first task finishing or becoming blocked.

Make near-term tasks small enough to assign, verify, and hand off. Mark real dependencies and include independent next work where it exists. Keep later, uncertain work as broader backlog items rather than inventing a detailed project history in advance. Review and expand the queue as discoveries change the work; do not keep workers waiting simply because nobody wrote down the next known task.

Do not manufacture optional tasks to keep agents busy. A queue is useful when it supports the intended outcome, not when it contains the most cards. An orchestrator may prepare future work without dispatching all of it.

## Priorities guide allocation; they are not an exclusive lock

The supervisor orders subprojects by their contribution to the owner's goals. The first actionable priority is the default next focus. That does **not** mean only rank 1 is allowed to run, nor that every unblocked subproject should run simultaneously.

At meaningful checkpoints, consider:

- Critical-path value, deadlines, dependencies, and the actual next deliverable.
- Expected model and context usage, task complexity, and the smallest capable worker.
- Build, CI, memory, disk, provider, API, and other shared-resource costs.
- Independent progress that fits alongside current work without collisions.
- Review and integration capacity; producing more unreviewed patches is not automatically progress.

Allocate a suitable amount of effort across the actionable subprojects. There is no universal task-count cap. One heavy build may consume a constrained resource while several light, independent tasks can still be reasonable. Existing owner-approved budget, resource, and authority limits continue to apply.

Give dispatches a concrete task, scope, owner, acceptance condition, resource allowance, and return path. Lower-priority work may proceed when it is inexpensive, independent, prepares a dependency, or makes useful progress while higher-priority work waits. Record the reason compactly in the actual coordination record; do not add another recurring reporting task to explain every decision.

## Blocked work, resumption, and deliberate waiting

When a high-priority task becomes blocked, record the real blocker, who or what can clear it, and the next useful check. Identify the next authorized, independent task that can advance. A blocked task does not necessarily block its entire subproject or the whole project.

When it becomes actionable again, reassess allocation and restore its appropriate priority. Shift at a safe, useful handoff or task boundary instead of abandoning healthy work mid-write, interrupting a running build, or repeatedly switching workers between tasks. A supervisor can deliberately finish a short lower-priority task first when that reduces waste; make the reason clear.

There may be no useful authorized work that fits the available resources. A quiet wait is then correct. Do not invent busywork, duplicate reviews, repeated unchanged checks, or a new agent merely to keep utilization high. Conversely, do not sit idle because one item is blocked when another useful item can proceed.

Ready work awaiting an allocation remains ready; do not mislabel it as technically blocked. State the capacity or scheduling wait in its next action or coordination record.

## Coordinate across projects

If supervisors share the same developer's hardware, CI budget, provider limits, or other constrained resources, use the existing shared allocation owner or resource record. No supervisor should assume it independently owns all spare capacity. Keep one monitoring owner per build, CI run, or worker and share compact milestone evidence rather than duplicating polling.

Choose models deliberately within the owner's approved provider/source scope. Optimize total cost to an accepted result, including failed attempts, supervision, context, builds, tests, and integration. Cheap workers are valuable for suitable tasks; a stronger worker can be cheaper overall when it avoids repeated failures. Do not remove essential acceptance or safety checks merely to reduce usage.

## Bound assignments and notice stalled progress

Each dispatch includes an outcome, acceptance check, approved spending or resource allowance, and a useful stop-and-report checkpoint. Set these for the actual task; do not invent one universal worker limit. A worker that reaches its allowance, repeatedly fails, or discovers a larger scope preserves its result and returns to the orchestrator rather than silently expanding the assignment. The orchestrator may reshape or reassign work within existing authority; ask the owner only for a genuinely missing decision or permission.

Keep a compact allocation record in the existing board or handoff: active subproject, current owner, next deliverable, and constrained resources in use. Reuse information already recorded rather than creating a second reporting system. Distinguish measured usage from estimates.

At meaningful checkpoints, look for a concrete change in behavior, verified evidence, or a cleared dependency. Repeated failures, unchanged reports, or growing context and spending without progress call for a different approach, a narrower task, a better-suited worker, or a deliberate pause. Preserve useful partial work and avoid interrupting a healthy run merely because observation timed out.

## Keep Lookout current

After material task movement, update the canonical task data and publish its sanitized mirror through the established project-scoped manifest and identity. Keep both summaries, ordered priorities, task associations, and genuine completion dates consistent. Verify exact readback; unchanged content must not receive fabricated freshness.

The supervisor is accountable for this happening. Orchestrators supply timely task updates; the established publishing owner performs the upload. Avoid making routine board visibility depend on a long-running feature, a new permission question already covered by standing scope, or a new timer. Preserve source ownership and the actual limits of the owner's authorization.

Rank and scheduling decisions are not permission to merge, deploy product code, expand access, share private source, sign transactions, or move funds. Preserve genuine new review rejections, credentials, secrets, and other private-data boundaries. Fix ordinary schema errors as data errors and do not bypass a rejection through another publisher or tool.

See [Agent setup](AGENT_SETUP.md) to deploy a copy, and [Publishing](PUBLISHING.md) for the existing card, priority, summary, and completion formats.
