# Purchasing Branch Scope Candidate

Review base: `fc7b9179d161134376141bcb4927ce7ddf5b954a`.

The original purchasing context and create/send/receive commands validate tenant membership and purchasing capability but do not enforce the authenticated non-owner's branch assignment. Cached send/receive results also do not bind the requested order path. Locked security rules require allowed-location validation. No live exploit or purchase receipt was executed.

Migration `20261017104117_purchasing_branch_scope` scopes order/location reads using the existing active-employee/assignment predicate, with shared tenant supplier/catalog configuration unchanged. Private command cores retain existing computations, locks and append-only behavior. Wrappers revalidate current membership, purchasing management and target branch before entering the command/replay core. Send/receive reject a cached result for a different order ID. API errors use safe 403/404/409 responses, not private database details or generic 500s for permission denial.

Six focused HTTP denial cases passed locally. Disposable SQL coverage checks assigned versus unassigned reads and commands, exact two-unit receiving, weighted average cost 357.14 from five units at 300 plus two at 500, once-only receipts, path-binding conflicts, removed assignment on completed retries, unchanged business effects after denials, foreign membership and private-core ACLs. Full exact candidate CI is required; no database success is claimed before execution.

This patch does not add supplier returns, transfer policy, new role grants, bank settlement or a new financial ledger. Shared Staging/Production are unchanged. Review and approved reviewed-main release, authenticated Staging UAT, reconciliation and separate Production rollout remain required. Do not roll back to an externally callable unscoped core; preserve business history and use a reviewed forward correction or pause.
