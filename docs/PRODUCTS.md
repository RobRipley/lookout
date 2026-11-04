# Products and CTO priorities

A product groups existing project boards under one accountable CTO. The operating hierarchy is **Product CTO → Project orchestrator → Subproject lead → task worker**. Roles may be combined in a small team. Preserve existing ownership, source boards, publisher identities, and task IDs.

The CTO orders projects and maintains the product overview. Project orchestrators maintain project summaries, ranked subprojects, and resource allocation. Subproject leads shape and maintain task queues; workers complete bounded tasks and return evidence. See [Orchestration](ORCHESTRATION.md) for allocation and handoff rules.

## Use the interface

Choose a product in the sidebar to see its overview and ordered project priorities. Open a project beneath it for its existing board and subproject priorities. Projects without explicit product membership remain available under Other projects, grouped by repository. Repository association does not infer product membership, including for future projects.

Admins can create a product with **New product**, then use **Product settings & CTO access** to choose its project membership and set the CTO display name. Leave that name blank until someone is assigned. The display name grants no permissions: separately grant the CTO's authenticated principal access. Admins can revoke that grant in the same settings panel.

Authorized CTOs can edit the product summary and rank member projects, setting status, blocker, and next action. Unranking a project retains its membership and board. Reordering product projects does not reorder project subpriorities or edit any source task. A concurrent change requires reloading the latest product before saving again.

Priority guides effort across projects: the highest actionable project is the default focus. Independent lower-priority work may proceed when useful and within budget and resource constraints. When a blocker clears, restore appropriate attention at a safe task boundary or handoff checkpoint. Lookout does not dispatch agents or change their instructions automatically. Ranking does not authorize deployment, access changes, signing, transactions, or funds movement.

## Backend API

Product IDs use the same bounded identifier format as project IDs. The backend stores up to 30 products. Each project can belong to at most one product; membership refers to existing boards.

```text
ProductInput = { title: text; cto: text; summary: text; projectIds: [text] }
ProductPriorityItem = { projectId: text; status: text; blockedReason: text; nextAction: text }
Product = { id: text; data: ProductInput; items: [ProductPriorityItem];
            revision: nat; updatedAt: int; updatedBy: principal }
```

Array order in `items` is the durable project priority order. Only member project IDs are accepted, without duplicates. Status is `ready`, `in_progress`, `blocked`, `paused`, or `done`; blocked/paused entries require a blocker, and ready/in-progress entries require a next action. Titles and CTO names are bounded to 256 codepoints, summaries to 1200, and each blocker/next action to 600.

| Method | Authority and behavior |
| --- | --- |
| `listProducts() → [Product]` (query) | Authenticated readers see accessible products. Admins and workspace viewers see all; product managers see their full products. Project publishers see only their readable member IDs and corresponding priority entries, with product summary blank. |
| `canManageProduct(id) → bool` (query) | True for an authenticated admin or that product's manager. |
| `upsertProduct(id, input, expectedRevision) → nat` | Admin only; creates or updates metadata and membership. Removing members prunes their priority entries. |
| `setProductManager(id, principal, enabled)` | Admin only; grants/revokes an authenticated principal's product scope separately from the CTO display name. |
| `publishProductPriorities(id, items, expectedRevision) → nat` | Product manager or admin; replaces ordered project priorities. |
| `publishProductOverview(id, summary, expectedRevision) → nat` | Product manager or admin; replaces product summary. CTO display name and membership remain admin-managed. |

All three revision-bearing writes use compare-and-swap: creation requires `expectedRevision = 0`; updates require the exact current product revision and return the incremented revision. Overview, membership, and priority changes share one revision. Read first, write with that revision, then read back. A stale revision is rejected, including an identical stale retry. If a write's outcome is unknown, reconcile readback before trying again.

A product manager can read its member boards and associated project metadata, priorities, and archives. This grant does not allow publishing project snapshots, project summaries, subproject priorities, completion records, or archive mutations. Those retain existing admin/project-publisher authorization. Membership changes immediately change the manager's readable scope. Revoking an admin through the recovery identity also clears that principal's product manager grants, alongside existing viewer/publisher revocation.

## Keep both levels current

Use the established [project publisher](PUBLISHING.md) for board and project metadata updates. Product overview and priorities are separate API/UI updates; the publisher CLI does not infer membership or publish product rankings. The CTO owns product accuracy while the established project publishing owner maintains each source-bound mirror. Keep private production configuration and actual workspace data out of this repository.
