# Optional ICP MCP discovery

Lookout does not publish an ICP MCP discovery manifest by default. Publishing a valid manifest opts the application into ICP MCP and accepts the [ICP MCP App Operator Terms](https://internetcomputer.org/icp-mcp/app-operator-terms/). The app operator must decide whether to accept those terms before publishing it.

For an authorized ICP mainnet deployment using the standard canister gateway domains, set `LOOKOUT_DISCOVERY_OPT_IN=1`, `LOOKOUT_DISCOVERY_FRONTEND_ID`, and `LOOKOUT_DISCOVERY_BACKEND_ID` in the deployment build environment. Use the actual frontend and backend canister principals for that installation. The frontend build emits the extensionless `/.well-known/ic-architecture` JSON document and the `/.well-known/ii-derivation-origin` text document. The IDs are generated per installation rather than stored in public source. Never enable discovery accidentally during an unrelated asset deployment; a later deployment without the opt-in removes the files.

The declaration specifies the frontend's canonical `ic0.app` origin, matching Internet Identity's normalization of ICP gateway origins. It does not alter the frontend authentication settings or grant access. Nonstandard domains and local test origins require separate origin analysis; do not use this standard-gateway declaration for them.

After publication, verify both response bodies and content types, verify the backend's `candid:service` metadata, and test authenticated connector access under an existing authorized principal. Visibility of the manifest does not imply access to private board data; canister authorization still applies.
