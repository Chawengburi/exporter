# specs — pms-export

> The former name of `exporter/` before the 2026-09-28 rename (ADR-0004) — this spec set was written before the rename, so it keeps
> the `pms-export` name and the `PMS_*` prefix as they actually were at the time (they are now the `exporter` command and `HOTELTIME_*`).

The project's **decision** documents · kept separate from [`../recon/NOTES.md`](../recon/NOTES.md),
which holds **what was observed** while exploring the real sites.

> Rule: whatever was measured on the real site lives in `recon/NOTES.md` · what we *chose* to do,
> and why, lives here · every spec must cite its evidence back to NOTES rather than assert it.

| # | File | Covers |
|---|---|---|
| 01 | [01-spec-scope-and-architecture.md](./01-spec-scope-and-architecture.md) | Why this project exists · the "AI writes, scripts run" pattern · agreed scope and what is deliberately not done |
| 02 | [02-spec-hoteltime-constraints.md](./02-spec-hoteltime-constraints.md) | The 6 HotelTime constraints that force the design · **read before changing any code** |
| 03 | [03-spec-report-definition.md](./03-spec-report-definition.md) | Why `reports/` is TypeScript and not JSON · the `Report` contract · how to add a new report |
| 04 | [04-spec-verification.md](./04-spec-verification.md) | The 5 verification gates · the gate that was removed and why · bugs the verification layer actually caught |
| 05 | [05-spec-output-and-provenance.md](./05-spec-output-and-provenance.md) | `--format raw\|csv\|both` · merging into yearly files · `manifest.json` |
| 06 | [06-spec-credentials-and-session.md](./06-spec-credentials-and-session.md) | `.env` and precedence · keeping secrets from leaking · why it logs in again every run |
| 07 | [07-spec-audit-trail-export.md](./07-spec-audit-trail-export.md) | 🚧 **DRAFT** — pulling the Audit trail, which has **no export button** · the 500-row cap · what must change in the existing code |
| 08 | [08-spec-multi-site.md](./08-spec-multi-site.md) | 🚧 **DRAFT** — making it portable to other sites/instances · the `--profile` that can be done now · the `Site` layer that is **deliberately not built yet** |
| 09 | [09-spec-recon-schema-and-codegen.md](./09-spec-recon-schema-and-codegen.md) | 🔄 **REVISED (2026-09-18)** — cut the **tokens per new report** from ~100k to ~2k · recon schema + generator · real count: 66 pages have an export (measured by sweep, not estimated) · go/no-go: GO for §12 first, NO-GO for writing the generator yet |

**Reading order for someone new to the project:** 01 → 02 → 03 · read the rest when you touch that area.

Status: specs 01–06 **ACCEPTED (2026-09-08)** — written after all 3 reports had really run, every number was measured ·
spec 07 **DRAFT** — the real page was explored but no code has been written ·
spec 08 **DRAFT** — analysed from the existing code; there is no second site to explore yet ·
spec 09 **REVISED (2026-09-18)** — the original DRAFT content (2026-09-10) is intact; §0 and §15 were added
to explain what has actually been replaced (see ADR-0001) and the go/no-go revised from the real numbers (66 pages have an export,
not an estimate) · **always start at §12** (a retroactive experiment on the 3 reports whose answers are already known, free
— nobody has done it yet).
