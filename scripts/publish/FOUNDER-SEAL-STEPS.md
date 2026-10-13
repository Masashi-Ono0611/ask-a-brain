# Founder seal ceremony (offline, Node 24.13.0)
Run personally in a real controlling terminal, outside AI/recorded sessions.
First read every inert review byte, finalize metadata, and check original scans,
private lineage, current source hashes, rights and withdrawals. Scans are not consent.
Lead supplies frozen PROJECTION_DIR, MANIFEST, REVIEW_TXT and SCAN_ATTESTATION paths.
For this packet those are .local/projection/real, manifest.json, review.txt and
scan-attestation-live.json (the latter three inside .local/projection).
Choose an existing canonical absolute directory outside every repo/worktree,
the OS temporary directory, /tmp and cloud sync; it must be founder-owned mode 0700.
Keep it inaccessible to agents/candidates. Set KEYFILE, OUT_APPROVAL and OUT_SIGNED
to new absolute paths there. The helper never overwrites any file.

```sh
node scripts/publish/founder-seal-helper.ts init-key "$KEYFILE"
node scripts/publish/founder-seal-helper.ts approve "$PROJECTION_DIR" "$MANIFEST" "$REVIEW_TXT" "$SCAN_ATTESTATION" "$OUT_APPROVAL"
node scripts/publish/founder-seal-helper.ts sign "$KEYFILE" "$MANIFEST" "$OUT_SIGNED"
```

init-key prints only the base58 public key and SHA-256 of its raw 32 public bytes.
KEYFILE is Ed25519 PKCS8 DER, mode 0600; it is not a payment-wallet keypair.
approve shows manifest JCS/raw hashes, review JCS/raw hashes, inventory hash,
scan-file hash and attestation verdict. Compare the independently reviewed pins.
Type each separate exact line: `yes review`, `yes originals`, `yes lineage`,
`yes rights`, `yes download`, `yes cc-by`. Wrong input or changed bytes aborts.
Record the resulting raw approval-file SHA-256 in protected operator configuration.
sign shows the manifest JCS hash; type `sign <that exact hash>` only after approval.
It verifies before writing; its public signing_key has id `seller-<public SHA-256>`.
Lead pins this exact signing_key plus approval path/hash in the protected JOB,
with the final worksheet, verified scanner pins and deployment; seal_actor is human.
Lead sets SIGNED_MANIFEST to OUT_SIGNED and computes the raw JOB_SHA256, then runs:

```sh
node scripts/publish/operator.ts seal "$JOB" "$JOB_SHA256" "$SIGNED_MANIFEST" "$SEALED_JSON"
node scripts/publish/operator.ts list "$JOB" "$JOB_SHA256" "$SEALED_JSON" "$PROPOSAL_TXT"
```

Expected: SEALED_INACTIVE, then suspended proposal requiring founder repin.
Refresh approval before each session/within the M03 age bound using a NEW file/pin.
NEVER paste, print, commit or cloud-sync key material; NEVER store keys in a repo.
Real host isolation, real scanner evidence, activation and registry repin remain separate.
