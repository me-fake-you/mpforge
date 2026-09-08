# Credential security

Account YAML files contain aliases and environment-variable names, never values. Real values may come only from the operating-system credential manager, process environment, or an ignored `.env.local` file loaded by a server-side human session.

AppSecret, access tokens, cookies, passwords, private keys, authorization headers, and credential-bearing URLs must not appear in:

- Web state, bundles, source maps, or browser storage;
- operation events, plans, receipts, sanitized request/response files;
- normal logs, errors, test snapshots, Git, screenshots, or UI labels.

The UI receives only `configured`, `missing`, `invalid`, or `unverified`. It never displays a prefix, suffix, length, checksum, or other partial secret fingerprint.

Provider sanitizers recursively redact sensitive keys and query parameters before data crosses into logs or operation artifacts. CI scans repository candidates and built frontend assets. A scan failure blocks delivery; it must not be waived by putting a secret in an allowlist.
