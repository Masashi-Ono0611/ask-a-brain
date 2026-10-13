# T0 runtime format

Node 24.13.0 executes `.ts` sources directly. `tsc` only checks types; it never
emits code. No role entrypoints exist in T0, so no build/launch pass is claimed.
T11 must supply the audited role copy lists and isolated `--self-check` launches;
T7 must verify the narrower buyer/worker transitive import closure.

`.local/` is already ignored. Runtime owners provision isolated `.local/` roots
with 0700 directories and 0600 secret files; the name is not a security boundary.
The foundation never creates or reads keys or wallets.
