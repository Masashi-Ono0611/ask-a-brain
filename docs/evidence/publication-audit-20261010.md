# Pre-publication audit (read-only), 2026-10-10

Revision audited: 9049adf on impl/t0-foundation (98 commits, one author). Nothing was pushed or created remotely.

| Check | Command / method | Result |
|---|---|---|
| Full check | `npm run check` | 1001 tests pass, 0 fail, 0 skipped; secret scan PASS (history + working tree) |
| Private files tracked or ever committed | `git ls-files` and `git log --all --name-only` filtered for `.local/`, `.der`, `.pem`, `.key`, `auth.json`, `.env` | none |
| Local home paths / employer addresses in tracked files | `git grep` for `/Users/masashi`, `masashi.ono`, employer email domains | none |
| Largest tracked file | `du -k` | about 104 KB; nothing large |
| Code licence | `LICENSE` | MIT, "Masashi Ono" |
| Content licence | `docs/evidence/content/approval-index.md` | founder approved L1-L5 as CC BY 4.0 (D12) |
| Dependency licences (7 direct) | `node_modules/*/package.json` | MIT x5, Apache-2.0 x2 |
| Dependency licences (lockfile, 146 packages) | `package-lock.json` license field | MIT 134, ISC 7, Apache-2.0 2, BSD-3 2, BSD-2 1; no UNKNOWN |

## Not a defect, but the founder should decide before publishing
1. Commit author is `masashi.ono.0611@gmail.com` on all 98 commits. Public history will show it.
2. Design docs named the founder's employer organisations as forbidden data sources (now reworded to generic "Org data") (`docs/design/00-brief.md`, `01`, `02`, `03`, `04`). This reveals employer names; remove or keep.
3. The five approved lessons are inside the repo (`fixtures/eval/approved/lessons/`), so the "paid answer" text becomes free to read. Approved as CC BY 4.0; the private grading rubrics are not in the repo (`.local`).
4. `README.md` is 51 lines and not yet written for judges.

## Not covered
Third-party licence text of transitive packages was read from the lockfile field only, not from each package. Presidio/other scanners were not run. The remote does not exist yet.
