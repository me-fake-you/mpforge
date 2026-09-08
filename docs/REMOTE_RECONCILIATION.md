# Remote reconciliation

Reconciliation is read-only. It queries exact identifiers when available, otherwise lists candidate drafts using a bounded time window and frozen title/content evidence.

Only three results exist:

- `CONFIRMED_CREATED`: one exact or uniquely strong match; record the remote identifier and move to `RECONCILED_SUCCEEDED` without creating again.
- `CONFIRMED_NOT_CREATED`: evidence proves no draft was created; a later attempt starts from a new Prepare and, for real mode, a new side-effect approval.
- `AMBIGUOUS`: zero proof or multiple plausible matches; remain in `UNKNOWN_REMOTE_STATE`, instruct the user to inspect the WeChat console, and block retries.

Title similarity alone is never sufficient when multiple candidates exist. Pagination, response sanitization, and account binding apply to every reconciliation call.
