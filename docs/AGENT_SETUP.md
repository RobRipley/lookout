# Deploy and use your own Lookout

Give your coding agent this URL:

https://raw.githubusercontent.com/RobRipley/lookout/main/docs/AGENT_SETUP.md

Lookout is a private dashboard for projects your agents already manage: Kanban boards, readable status reports, blockers, ranked priorities, and explanations of unfamiliar terms. Your existing project boards stay authoritative; Lookout mirrors selected information from them.

This guide helps an agent deploy an independent copy for its owner. Each owner supplies their own deployment identities, canisters, and cycles. No access to the author's workspace is included. The code is source-available under [FSL-1.1-ALv2](../LICENSE.md); read the license for permitted uses.

## 1. Prepare a fresh checkout

Use Git, Node.js 22.12 or later, npm, `icp`, `ic-wasm`, and Mops. See the [ICP CLI installation instructions](https://github.com/dfinity/icp-cli#installation) and [Mops documentation](https://docs.mops.one/). With the owner's normal authorization to install development tools, missing tools can be installed using:

```sh
npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops
```

Check `node --version`, `icp --version`, `ic-wasm --version`, and `mops --version`. These commands were checked against `icp` 1.3.0. If your installed CLI differs, consult its `--help` rather than substituting legacy `dfx` commands. Keep the compiler and recipes pinned in `mops.toml` and `icp.yaml`. Do not add platform-specific Rollup packages as direct dependencies.

From the owner's chosen development folder:

```sh
git clone https://github.com/RobRipley/lookout.git
cd lookout
npm ci
mops install
npm test
npm run build
```

If a checkout already exists, inspect its status first and preserve its work and private files. Use a separate fresh checkout for a new production instance instead of replacing another instance's installation arguments or mappings.

## 2. Create the owner's deployment identity

The CLI deployment identity controls upgrades and backend recovery. It is separate from the human's Internet Identity browser login. Agents that only publish boards get narrower identities later.

```sh
mkdir -p work
(umask 077; icp identity new lookout-owner --output-seed work/lookout-owner-recovery.txt)
node scripts/init-local.mjs lookout-owner
icp identity principal --identity lookout-owner
```

`lookout-owner` is an example local identity name; choose a distinct name if it already exists. Never replace or import someone else's identity. `--output-seed` keeps recovery words out of terminal output. Do not read or paste that file into chat; arrange a private backup with the owner.

Despite its name, `init-local.mjs` also prepares a fresh mainnet installation. It creates `work/install-args.did` and `work/owner-invite.txt` with private permissions and refuses to overwrite them. It does not deploy, spend funds, or contact an existing Lookout instance. Never reuse a test invitation in production.

## 3. Check funding and deploy to ICP

```sh
icp cycles balance -n ic --identity lookout-owner
icp token balance -n ic --identity lookout-owner
```

Creation and operation consume cycles. There are two canisters, `backend` and `frontend`. Inspect `icp deploy --help` for the initial funding default and budget for both plus applicable fees. There is no subscription to the author or author-funded hosting.

Use already-funded cycles when available. If funds are missing, give the owner their deployment identity's public principal and explain what funding is needed. If their wallet needs a ledger account identifier, use `icp identity account-id --identity lookout-owner`. Follow the official [cycles funding guide](https://docs.internetcomputer.org/guides/canister-management/cycles-management/). Converting ICP with `icp cycles mint` spends the owner's ICP: only do so within an amount they have authorized, then recheck the balance. Do not use another person's accounts or funds.

Once deployment and funding are authorized:

```sh
icp deploy -e ic --identity lookout-owner
icp canister status backend -e ic --identity lookout-owner
icp canister status frontend -e ic --identity lookout-owner
```

This builds the app, creates the owner's two canisters, installs them, and uploads frontend assets. Record their actual IDs and the frontend URL from the deployment. Use the mappings generated in this checkout. No production IDs need to be pasted into frontend source: `ic_env` supplies the backend configuration automatically.

Back up `.icp/` and `work/` privately; this repository ignores them. Losing a local mapping does not delete a canister. Restore the mapping from your records instead of accidentally creating a replacement.

If deployment fails, inspect actual status before retrying. For a completed installation with an interrupted frontend upload, confirm the correct frontend is running, then use `icp sync frontend -e ic --identity lookout-owner`. Do not reinstall the backend or create new canisters to fix an asset upload.

## 4. Let the human claim browser ownership

The owner opens their new frontend URL, appends `#invite=` followed by the invitation from their private `work/owner-invite.txt`, and signs in with Internet Identity. Assemble or open that link privately. Do not paste the invitation, full invitation URL, installation arguments, or recovery words into logs, public issues, repositories, or agent transcripts.

The app removes the fragment from the address bar and redeems the invitation once. A visitor who merely signs in cannot claim ownership. The agent cannot complete the human's passkey or identity-provider ceremony for them. After redemption, use the ordinary frontend URL without the invitation.

Verify that the owner can enter the workspace. An empty workspace is expected before the first project is published. If access is pending, check the invitation and identity actually used; do not weaken access controls or reinstall.

## 5. Connect a project with a scoped publisher

Give each project a stable ID and dedicated publishing identity. The example below uses fictional website work; adapt it to the owner's real project.

```sh
(umask 077; icp identity new lookout-website-publisher --output-seed work/website-publisher-recovery.txt)
icp identity principal --identity lookout-website-publisher
```

Replace `PUBLISHER_PRINCIPAL` below with the **public principal** returned above, then grant access using the owner's identity:

```sh
icp canister call backend setPublisher '("website", principal "PUBLISHER_PRINCIPAL", true)' -e ic --identity lookout-owner
```

This grants access to `website` only. Do not distribute the owner identity or give publishing agents controller/admin rights. Publisher identities need no individual cycles for ordinary board calls; the backend pays. For agents on other machines, provision identities there and grant their public principals instead of sending recovery keys through chat.

Start from the included fictional examples:

```sh
mkdir -p .local/website
cp examples/board.json examples/presentation.json examples/priorities.json examples/completions.json .local/website/
cp examples/publisher.local.json .local/website/publisher.json
```

Edit `.local/website/publisher.json`:

- Set `projectId` to `website`, matching the grant, plus the real title, lead, and source `repository`.
- Keep `canister` as `backend`, set `environment` to `ic`, and set `identity` to `lookout-website-publisher`. Run from this deployment checkout so `backend` resolves to its mapping.
- Keep `source.kind` as `curated-json` initially. Set `source.path` to `.local/website/board.json` when running from the deployment checkout root, or use its absolute path. Presentation, priority, and completion paths remain `presentation.json`, `priorities.json`, and `completions.json`, beside the manifest.
- Replace fictional content with an accurate projection of the existing project board. Preserve stable card IDs and source states. Update priority card references and genuine completion times with it; use an empty completion `entries` array if no actual completion date is known.

For a publisher outside the deployment checkout, use the owner's actual backend ID in `canister`, set `network` to `ic`, and remove `environment`. Never copy the author's deployment IDs. Important: `source.path` resolves from the publisher process working directory; presentation, priority, and completion paths resolve from the manifest directory. Absolute source paths avoid ambiguity. Select only the maintained, sanitized source.

```sh
node scripts/publisher.mjs --config .local/website/publisher.json --dry-run
node scripts/publisher.mjs --config .local/website/publisher.json --publish
node scripts/publisher.mjs --config .local/website/publisher.json --dry-run
```

Review the first dry run. The final dry run must report unchanged board, presentation, Plain English summary, priorities, repository association, and configured completion metadata. Then refresh the owner's browser and verify the project, cards, summaries, priorities, and task details. A CLI readback does not prove browser login worked.

For Markdown source sections, full schemas, metadata limits, and more projects, read [Publishing](PUBLISHING.md). Maintain these files alongside the project's actual coordination workflow rather than creating a competing board.

## 6. Establish supervision and save the upkeep rule

Use the [supervisor and subproject orchestration standard](ORCHESTRATION.md) with the team's available orchestration skills. The supervisor is accountable for the project board, subproject priorities, and resource allocation. Each subproject orchestrator populates and maintains its task queue and coordinates workers within that allocation. Seed enough actionable work for the next useful milestone and refine the backlog as discoveries emerge. Priorities guide effort across projects; they are neither an exclusive rank-1 lock nor a command to run every task in parallel. Account for model usage, builds, CI, shared resources, and review capacity without imposing an arbitrary task-count cap. Reuse existing coordinators and publishing ownership.

The owner should authorize ongoing sanitized updates to **their particular private backend and project** as part of setup. Their deployment request may already provide this authority; do not invent repeated approval questions when it does. Save the actual scope, manifest path, and existing publishing owner. An instruction template:

> After meaningful task movement, update the canonical board and its sanitized Lookout projection, both summaries, priorities, and known completion dates. Use the existing project-scoped manifest and identity. Dry-run, publish changed content, then verify exact no-op readback. Publish when state, owner, blocker, next action, completion, or priority changes. Keep source, tests, merge, deployment, and actual execution distinct. Write the Plain English summary in two or three ordinary sentences: what works, what is stuck, and what happens next. Exclude credentials, private keys, sensitive addresses/balances, transaction payloads, raw logs, and unrelated private information. Do not fabricate completion dates or refresh unchanged content to make it look recent. Work on the highest-ranked actionable priority; when blocked, record why and move to the next, returning when the higher priority becomes actionable. Rankings do not grant deployment or financial authority.

Include the same rule in an existing supervisor workflow if one exists. The publisher does not discover agents or run itself. Do not add another timer, writer, or watcher unless the owner wants one. On an unknown upload outcome, read back before retrying. Fix ordinary schema/length errors as data errors. If a tool genuinely rejects an action, preserve its reason and resolve the scope issue; do not switch executor, identity, or destination to bypass it.

## 7. Maintain the instance and hand it over

Check each canister's cycles with `icp canister status`; the owner funds ongoing operation. Top up only within their authorized budget. Browser exports help back up boards but do not replace canonical source, identity recovery, and deployment-mapping backups.

For upgrades, preserve mappings and installation arguments, review the source changes, run relevant checks, and use:

```sh
npm ci
npm test
icp deploy -e ic --no-create --identity lookout-owner
```

Check persistent-state and Candid compatibility when backend code changes. Never use `--mode reinstall` against a workspace you care about. Run `tests/backend.integration.mjs` only on a disposable local installation; it intentionally changes state and grants. Local trials use a separate checkout, identity, and invitation; see [Setup](SETUP.md).

Finish by giving the owner their frontend URL, both canister IDs, source commit, project manifest and upkeep instruction paths, current cycles, private backup locations, and a clear statement of what was deployed, read back, and actually verified in the browser. Never print backup secrets. Identify any real remaining funding or human sign-in step.

Current scope: one private workspace per backend, up to 30 projects, 500 cards per project, and 12 columns. Lookout is a read-only mirror with no hosted public signup or billing. See [Setup](SETUP.md) and [Publishing](PUBLISHING.md) for operation and schema details.
