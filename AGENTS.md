# Lookout agent instructions

Lookout is a private, read-only mirror of the project boards agents already use. The source board stays authoritative. This repository contains application source and fictional examples, not a shared hosted workspace.

## Choose the requested task

- **Deploy the user's own copy:** follow [Agent setup](docs/AGENT_SETUP.md). It covers prerequisites, the user's own identities and cycles, deployment, first-owner login, project-scoped publisher access, and verified upkeep.
- **Connect or maintain a project:** follow [Publishing](docs/PUBLISHING.md). Reuse the established source board, manifest, identity, and publishing owner. Update after material movement and verify readback.
- **Manage products and CTO priorities:** follow [Products](docs/PRODUCTS.md). Use explicit membership, separate product manager grants, and product revisions; preserve the established project publisher and source board.
- **Supervise a team:** follow [Supervisor and subproject orchestration](docs/ORCHESTRATION.md) and activate available team-orchestration and board skills. The supervisor is accountable for the board, priorities, and resource allocation; subproject orchestrators populate and maintain task queues. Priority guides allocation, not an exclusive rank-1 execution lock. Choose concurrency by useful work, cost, dependencies, and shared resources, without an arbitrary task-count cap.
- **Develop Lookout itself:** inspect repository state, preserve unrelated work, and use the implementation notes below. Cloning or editing the repository does not itself request deployment, new canisters, or spending.

When a referenced document is needed, read it before acting. If reading this file through its raw URL, fetch the linked documents from `https://raw.githubusercontent.com/RobRipley/lookout/main/` using their repository-relative paths. Do not mistake an unavailable link for instructions you have already read.

## Implementation notes

- Frontend: React/Vite under `src/`. Backend: persistent Motoko in `backend/main.mo`, with `backend/backend.did` and `src/idl.js`. Publishing CLI: `scripts/publisher.mjs`.
- Use Node.js 22.12+, locked npm dependencies, Mops, and `icp`. Preserve compiler and recipe pins. Never add `@rollup/rollup-darwin-*` as a direct dependency; use `npm ci` to repair missing optional native packages.
- Use `npm test` for JavaScript behavior changes and `npm run build` for frontend changes. For documentation-only changes, verify instructions, examples, shell syntax, and links as appropriate. CI runs tests/build and never deploys.
- Backend changes require relevant access-control, Candid, persistent-state, and upgrade checks. `tests/backend.integration.mjs` is destructive test setup for a disposable local installation only. Never run it against a real workspace.
- Upgrades preserve the existing mapping and installation arguments. Never reinstall a backend containing data. Refer to [Setup](docs/SETUP.md) for deployment, ownership, recovery, and backups.
- Keep `.local/`, `.icp/`, `work/`, `outputs/`, identity recovery material, invitations, production manifests, and actual project data private. Stage public source paths explicitly.
- Preserve scoped access and source-revision binding. Distinguish source, tests, merge, deployment, and actual execution. Never turn a priority or board transition into authority for a protected action.

Public entry point: https://raw.githubusercontent.com/RobRipley/lookout/main/AGENTS.md
