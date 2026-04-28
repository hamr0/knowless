# knowless documentation

Small, opinionated, full-stack passwordless authentication library
for Node.js services that don't need to email their users for
anything other than the sign-in link.

## Structure

| Tier | Path | What lives here |
|------|------|-----------------|
| **Product** | [`01-product/`](01-product/) | The PRD — what we're building, why, and what we're not |
| **Design** | [`02-design/`](02-design/) | The SPEC — exact wire formats, byte layouts, algorithms |

Future tiers (logs, process, ops) will appear as they earn their
place. Ops content currently lives in the SPEC pending OPS.md.

## Start here

1. **What is knowless and who is it for?** →
   [`01-product/PRD.md`](01-product/PRD.md) §1–§5.
2. **What does it deliberately refuse to do?** →
   [`01-product/PRD.md`](01-product/PRD.md) §14 (the NO-GO table)
   and §15 (sibling project candidates).
3. **How is it actually built — the wire formats, algorithms, and
   the sham-work pattern?** → [`02-design/SPEC.md`](02-design/SPEC.md).
4. **Why was X decided?** → [`01-product/PRD.md`](01-product/PRD.md) §16
   (decisions log). When PRD and SPEC disagree: PRD wins on intent,
   SPEC wins on mechanism.

## Document precedence

If the PRD and SPEC disagree:
- **Intent / philosophy / scope** → PRD wins. The SPEC must be
  brought back into alignment.
- **Mechanism / wire format / byte layout** → SPEC wins. The PRD
  was over-specifying.

Open questions in either document are tracked in their respective
§15 (PRD) and §15 (SPEC).
