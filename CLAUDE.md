# CLAUDE.md

Agent context for working on knowless. Auto-loaded by Claude Code.
Repo-only — not shipped via npm. Read this before proposing changes.

## Doctrine: walk-away at v1.0.0

knowless walked away at v1.0.0. The only changes that ship after
that are:

- Security fixes
- Bug fixes that don't change the API surface
- Documentation corrections
- Helper exports that pull existing mechanism back into the library
  (precedent: v1.1.0 `dropShamRecipient`)

Default to **no** when asked to add anything else. Burden of proof
is on adding, not on omitting. Every option carried into v1.0.0 must
stay stable through v1.x's maintenance window.

## Two-test lens for "should X go in knowless?"

1. **Walk-away test.** Not in one of the four carve-outs above? Push
   back.
2. **Policy-lives-with-mechanism test.** Mechanism in knowless,
   policy in the adopter (curation, override list, threshold tuning,
   cron, branding) = wrong seam. Both belong together. Worked
   examples in `knowless.context.md` § "What's NOT in knowless, and
   why".

When in doubt, default out. Less surface, less carrying cost.

## Adopter feature requests are usually README discoverability bugs

When an adopter (plato, addypin, gitdone, bareagent, bareguard)
files a "missing feature" issue, run this triage before treating it
as a real gap:

1. **Already shipped?** grep `src/` and `GUIDE.md` for the API the
   adopter says is missing. Many requests target hooks/options that
   landed in v0.2.x but aren't surfaced in `README.md`.
2. **Deliberately refused?** See the most-litigated refusals below
   or PRD §16.
3. **Still missing?** Apply the two-test lens.

If 1 or 2 fires, the fix is `README.md` / `GUIDE.md` routing — not
new code or API surface.

## Most-litigated refusals

If an adopter requests one of these, push back with the
corresponding PRD §16 anchor for the long-form reasoning. **Do not
relitigate without a fundamentally new argument.**

- **Vendor SMTP** (Mailgun / Postmark / SES / Resend) — PRD §16.2.
  Vendor relationships invite reusing the mailer for non-auth mail;
  localhost-only is the one-mail-purpose enforcement.
- **Built-in DKIM/SPF** — PRD §16.7. MTA's job. Different problem
  shape (inbound auth), different deployment ergonomics.
- **Templatable login form** — PRD §16.12. Templating is a slope
  ending in "embed a JS framework." Fork or override the route
  entirely.
- **Allowlist tables** — PRD §16.8. Schema growth into user-model
  territory. ~6-line operator recipe is the boundary.
- **Pin commitments / password equivalents** — PRD §16.1. Recreates
  the password problem. Magic-link round-trip is non-negotiable.
- **App-tenure / account-age in the library** — PRD §16.19 +
  `knowless.context.md` § "What's NOT". Wrong number; app-derived
  first-seen is what should drive trust. Returning age data is
  itself an enumeration leak.
- **Disposable-domain blocking in the library** — `knowless.context.md`
  § "What's NOT". Public list, mechanism + policy belong with
  adopter.
- **Per-IP hashcash / proof-of-work** — `knowless.context.md` §
  "What's NOT". Already covered by per-IP caps; perimeter layer's
  job (Caddy / Cloudflare).
- **HTML email / tracking pixels / click-rewriting** — PRD §16.17.
  Deliverability + privacy + simplicity converge on plain text.
- **Unicode / non-ASCII email body** — PRD §16.23. ASCII-only is an
  anti-spoofing invariant (kills bidi/RTL override, homoglyphs,
  zero-width injection), not just an encoding choice. Allowing Unicode
  reverses a defended posture in the auth path to free only the footer.
  "Easy to encode" is not a new argument.

## Where deeper rationale lives

- **`docs/01-product/PRD.md` §16 — Decisions log.** 21 entries
  covering every contested decision. Internal/repo-only — not
  shipped via npm, not linked from `README.md`. Load when triage
  above doesn't resolve a request.
- **`knowless.context.md`** — adopter-facing single-file reference.
  Has "What's NOT in knowless, and why" § for the three agent-
  pushback cases (disposable-domain blocking, app-tenure, hashcash).
  Ships via npm.
- **`docs/02-design/SPEC.md`** — implementation contracts (FR-N
  functional requirements, AF-N audit findings).
- **`docs/03-tasks/TASKS.md`** — task ledger.
- **`.claude/memory/AGENT_RULES.md`** — cross-project dev/test
  standards (POC-first, dependency hierarchy, lightweight-over-
  complex, open-source-only).

## Decision-revisit protocol

PRD §16's preamble: *"If the user asks for something that
contradicts a decision here, push back first by referencing the
recorded reasoning; only change if the user provides a new reason
that wasn't considered originally."*

Apply this to anything in PRD §16 OR in the refusals list above.
The decisions are recorded because revisiting them costs more than
respecting them.

## Code standards (condensed)

For full standards see `.claude/memory/AGENT_RULES.md`.

- **POC first.** Validate logic with a ~15-min proof-of-concept
  before building. Cover happy path + common edges. POC works →
  design properly → build with tests. Never ship the POC.
- **Build incrementally.** Small independent modules, one at a time.
- **Dependency hierarchy:** vanilla → stdlib → external (only when
  stdlib can't do it in <100 lines). knowless is at one production
  dep (`nodemailer`) — adding a second requires explicit
  justification against this rule.
- **Lightweight over complex.** Simple > clever. Readable > elegant.
- **Open-source only.** No vendor lock-in. No speculative code, no
  premature abstractions.
