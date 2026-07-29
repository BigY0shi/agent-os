# Dev Journal — 2026-07-29

## Launchworks sending identity — Google Workspace domain recovery (in flight)

**No repo changes** — infra/DNS work via Claude-in-Chrome, logged here because
config changes get journal entries with rollback lines.

Decision: outreach sends from a **@launchworks.io** identity, not personal
gmail (brand + deliverability). Namecheap route abandoned after discovery:
launchworks.io has **no Private Email subscription** — its DNS pointed at
Private Email with no mailbox behind it (that's why SPF/DKIM was never
finished). Chose **Google Workspace** instead (best sender reputation; natural
future home for the Gmail-MCP draft queue).

Signup blocked: "domain already in use" — a stale Google tenant claims
launchworks.io (user never knowingly created one; likely an auto-created Cloud
Identity). Ran the Admin Toolbox **domain-in-use recovery**:
- Case **#73818186**, contact robbyjdenton@gmail.com.
- Ownership proven via DNS: added CNAME `73818186 → google.com` on
  launchworks.io (Namecheap Advanced DNS) — verified resolving via 8.8.8.8.
- Submitted **"free up domain"** (existing stale account gets renamed/removed).
  Google: ≤3 business days, email update within 1.

**Pending:** on the "freed up" email → user re-runs Workspace signup (account +
payment are the user's), then: MX cutover to Google, SPF swap to
`_spf.google.com`, DKIM generate+publish, DMARC `p=none`, external verification
of all records, and wire the address into Gmail send-as (or point the Gmail MCP
at the Workspace account).

**Rollback:** delete the `73818186` CNAME after the request completes (NOT
before — Google warns it's needed until processed). The domain's mail settings
are otherwise untouched.
