# Dependency freeze

`pins.json` repeats the reviewed direct dependency set; only the lead may revise
it together with the manifest and lock. `assert-toolchain.ts` checks the exact
runtime/npm/TypeScript versions, direct sets, every locked installed package,
and absence of install lifecycle hooks. Hoisted transitive packages are checked
against the lock; they are not additional direct dependencies.

No install or network audit is performed by the T0 worker. Registry integrity,
licence inventory, remote advisories, scanner binary checksum, GitHub Action
SHAs, and target-host compatibility remain lead verification tasks. Gitleaks
8.30.1 must be on PATH; absence/version mismatch fails closed. The scanner
launcher suppresses findings output and scans git history plus the working tree.
Its inert bad/clean control proves invocation, not scanner completeness; T5 owns
publication rules and independent English/Japanese business-marker checks.
