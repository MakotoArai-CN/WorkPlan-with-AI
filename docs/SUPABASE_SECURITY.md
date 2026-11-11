# Supabase deployment and incident response

## Deployment responsibility

A table being in schema `public` is normal for a PostgREST API;
**RLS disabled is not**. Frontend query
filters, encryption, hiding a URL, or rebuilding the app cannot enable RLS.

Installing or updating the app does not change hosted database policies.
The project owner must apply and verify the migration in Supabase SQL Editor. Never put
database passwords, `service_role`/`sb_secret_` keys, or Management API tokens
in Vite variables, a desktop app, Git, chat, or browser code.

## Immediate actions (project owner)

1. If exposure is ongoing, temporarily restrict the Data API or revoke API-role
   table privileges in the dashboard while investigating. Do not destroy data.
2. Preserve a private backup and relevant API/database logs. Review the time
   window when RLS was disabled, exported data, unexpected writes/deletions,
   API keys, Edge Functions, and any public security-definer RPCs. An exposed
   `user_key` is an account credential in this application.
3. In the **correct project's SQL Editor**, run `docs/sql/rls_security.sql` as
   database owner. It is transactional, idempotent, retains rows, replaces all
   old policies only on the explicit WorkPlan table allowlist, enables and
   forces RLS, grants only CRUD to `anon`/`authenticated`, and restricts both
   `USING` and `WITH CHECK`. The legacy `planpro_data` table does not require
   first creating the normalized future schema.
4. If Settings uses a custom table name, review and explicitly add that table
   to the migration allowlist. Unrelated public tables are deliberately not
   modified. Review *all* public tables in Security Advisor separately.
5. Inspect the migration's final result: each present WorkPlan table must have
   `rowsecurity=true`, `force_rowsecurity=true`, and `policy_count=1`. Review
   `pg_policies` to ensure the sole policy matches the intended bearer key.
6. Run `docs/sql/verify_rls.sql` unchanged. It uses `SET LOCAL ROLE anon` and
   only random, transaction-local fixtures, then rolls them all back. It must
   reject cross-key insert/update/delete, deny missing-header and other-key
   reads, and permit own-key CRUD for task and encrypted-domain record keys.
   Do not validate using the SQL Editor owner role alone: it can bypass RLS.
7. From an isolated client account, verify task sync, encrypted notes/vault/
   worklog sync, and an explicitly requested account deletion if needed. Then re-enable normal API access.
   Refresh Security Advisor after deployment. A repository test pass is not
   proof that the production project is fixed.

## Treat previously public credentials as compromised

RLS does **not** revoke access to an already leaked account key. The app uses
`x-workplan-key` as a bearer capability: a caller may freely choose the header.
The policy only checks that the row's `user_key` equals that header. A person
who knows an account/record key can read, replace, or delete that record. This
is not an authenticated Supabase user identity and cannot prevent that caller
from forging a known key. Long random keys reduce guessing; they do not undo
an earlier leak. Client validation alone cannot enforce their entropy.

- Plan a backed-up per-account access-key rotation. Do not blindly SQL-rename
  keys: v2 wrapped account keys and encrypted domain envelopes bind the access
  key in AES-GCM additional authenticated data. Renaming only `user_key` makes
  old encrypted data undecryptable. A migration must unwrap/re-encrypt on a
  trusted, unlocked client with the master password, upload and verify every
  domain under a fresh key, and only then retire old records and credentials.
  Legacy v1 domain derivation also depends on the access key. No automatic
  credential/data migration is performed by these files.
- Treat unencrypted tasks and other formerly public content as disclosed.
  Rotate API tokens, website passwords, recovery codes, or other external
  secrets if exposed directly or if the vault master password may be weak or
  compromised. Verify offline backup integrity before replacing records.
- If a privileged Supabase key was ever shipped, rotate it through the project
  owner immediately and audit usage. A publishable key is intentionally public;
  rotating it alone does not fix disabled RLS or leaked account capabilities.
- Plan migration to real Supabase Auth or a trusted backend issuing short-lived
  signed JWTs with owner identity. Policies should bind rows to `auth.uid()` or
  a server-signed account claim, not a client-supplied header. That requires a
  coordinated identity/data migration; it cannot be silently substituted into
  existing key-only accounts.

## Remaining limitations

RLS does not stop request floods, offline ciphertext guessing, an already
authorized bearer, compromised devices, or a `BYPASSRLS`/service-role backend.
Use gateway rate limiting, monitoring, least-privilege server credentials, and
database-side identity checks. The client now rejects recognizable privileged
keys before HTTP requests, but opaque gateway credentials remain the gateway
owner's responsibility. Do not describe this as absolute protection.
