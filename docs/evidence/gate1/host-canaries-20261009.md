# Host canary probe (T7 lead probe step 3), 2026-10-09 (JST)

Scope: a PROBE image only, not the real buyer/worker roles (those need the audited bridge launcher, not yet provisioned).
Host: dedicated disposable Colima VM profile `aab-probe` (aarch64, 2 CPU, 4 GiB, home not mounted: `ls /Users` fails inside the VM).
Base image: node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f.
Probe image id: sha256:cd09b47000c023136a3a5a494cbbba62f241f93e1abb8e6e90a4a819d625f278. Code revision: aec466f. Canary files are synthetic dummies under /probe-denied (VM only).

| Run | Flags | Result |
|---|---|---|
| CONTROL (deliberately accessible) | internal network with listener, /probe-denied mounted read-only | passed=false, all 8 files readable (denied=false), adminDenied=false, networkDenied=false, positive=true (expected: the probe fires when isolation is absent) |
| ISOLATED | --network none, read-only rootfs, --cap-drop=ALL, no-new-privileges, uid 65532, no /probe-denied mount | passed=true, all 8 denied, adminDenied=true, networkDenied=true, capsDropped, noNewPrivileges, unprivileged, positive=true |

Listener (isolated subnet 192.0.2.0/24) connection counter after both runs: 2 per port, all from the CONTROL run; the isolated run added none.
A first control attempt used a mistyped dummy name (docker.so) so the docker.sock row was trivially "denied"; it was corrected (docker.sock created) and the control rerun before the numbers above.

NOT established: isolation of the actual buyer MCP and seller worker roles, mounts/UID separation of the real broker, egress from the real worker,
resource/OOM/restart evidence, Codex capability inventory, native token cap, the three injection directions through the runtime.
Gate 1 item c therefore remains UNVERIFIED. Paid mode and mainnet remain disabled.
