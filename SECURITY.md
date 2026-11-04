# Security

## Reporting

Please report suspected vulnerabilities through GitHub Security Advisories
("Report a vulnerability" on the repository Security tab) instead of opening a
public issue with exploit details.

## Supabase / PostgREST

The public `anon` / publishable key is shipped in the client and is not a
secret. **Row Level Security is the only database authorization boundary.**

For a Supabase project:

1. Run `docs/sql/cloud_schema.sql`.
2. Run `docs/sql/rls_security.sql` in the SQL Editor.
3. Confirm every WorkPlan table reports `rowsecurity = true` and exactly one
   `workplan_owner` policy.
4. Never put a `service_role` key in the client, CI logs, screenshots, or the
   repository.

The desktop client sends its per-account access key in the
`x-workplan-key` request header. The RLS helper reads either that header or a
JWT claim named `workplan_key`. This is a bearer-key model: a leaked account
key is equivalent to a leaked password for that account. Use the 24-character
generated keys rather than short, human-chosen keys.

Clients that talk to a custom PostgREST/HTTP gateway must enforce the same
header check server-side. A custom server that ignores `x-workplan-key` is not
protected by these policies.

## Client hardening

- Production CSP disallows remote script execution and framing.
- Markdown/HTML is sanitized with DOMPurify before rendering.
- Markdown links are restricted to `http`, `https`, `mailto`, and `tel`.
- External URLs are restricted to `http`/`https`.
- Local file reads are restricted to paths explicitly selected by the user or
  directories authorized in Settings; the backend keeps that allowlist.
- AI file reading blocks credential-shaped filenames and redacts secret-shaped
  content before sending it to a model.
- Password-vault payloads use authenticated encryption (AES-CBC + HMAC) and
  the verifier uses PBKDF2-SHA256 at 600k iterations.
- Backup packages use AES-GCM with PBKDF2-SHA256 at 210k iterations.

## Known boundaries

- Account access keys are bearer secrets; RLS cannot turn a weak user-chosen
  key into a strong credential.
- The Tauri HTTP capability is intentionally broad to support user-configured
  AI/PostgREST endpoints. Treat untrusted model output and untrusted custom
  endpoints as hostile.
- The application does not claim to protect data from a compromised operating
  system, a malicious local administrator, or a compromised WebView runtime.
