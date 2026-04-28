# Trust-Policy Failure SOP

Use this SOP when production remote selection fails because an artifact violates origin, integrity, attestation, runtime digest, compatibility, or revocation policy.

## Trigger

Start this SOP when any production signal shows:

1. `integrity-mismatch` with fallback `reason=integrity_mismatch`, `code=MV_INTEGRITY_MISMATCH`, `phase=integrity`.
2. Origin allowlist rejection before MF app registration.
3. Missing or invalid provenance attestation.
4. Runtime digest or compatibility mismatch between host and remote.
5. Selection of a revoked artifact is attempted by current, environment-overlay, or LKG state.

## Detection Evidence

Collect:

1. Failing topology reference ID and artifact ID.
2. Trust check result: origin, SRI, digest, attestation, runtime compatibility, or revocation.
3. `mv.remote.fallback` telemetry for integrity or policy rejection.
4. Selected environment overlay and candidate fallback stage.
5. Revocation policy and evidence reference, using the `uw2-05-rollback-kill-switch-slo` shape when rollback is required.

Wave 2 baseline: `uw2-02-integrity-remote-design-system` proves that an integrity mismatch on `remote-design-system` is rejected before activation while shell and unrelated remotes survive.

## Immediate Mitigation

1. Block activation of the failing artifact.
2. Preserve shell rendering and unrelated remotes.
3. Treat trust failures as platform-owned until proven to be a benign metadata publishing error.
4. Page the artifact owner and platform runtime owner.
5. If compromise is possible, revoke the artifact before selecting any fallback.

Do not bypass digest, integrity, attestation, origin, or runtime compatibility checks to restore traffic.

## Rollback And Kill-Switch Sequence

1. Add the failed artifact to the revocation list when it is compromised, incompatible, policy-violating, or operator-disabled.
2. Re-run selection in the required order: `current -> environment-overlay -> lkg -> csr-fallback`.
3. Skip every revoked stage, including LKG if it references the revoked artifact.
4. Enable the kill switch for the affected topology ID when policy rejection continues after selection.
5. Select LKG only when its artifact is unrevoked and satisfies the same trust shape as production.
6. Select CSR fallback when no trusted remote artifact remains.
7. Confirm `mv.manifest.fallback.selected`, `mv.remote.fallback`, and revocation evidence are recorded.

## Ownership And Escalation

1. Platform runtime owner owns policy enforcement, fallback selection, and kill-switch execution.
2. Artifact owner owns rebuild, provenance, digest, SRI, and attestation correction.
3. Security or release owner approves revocation removal and artifact re-admission.
4. Incident owner owns rollout pause and resume decision.

Escalate immediately if the failure involves unknown origin, unexpected digest drift, missing provenance for a production artifact, or any attempt to select a revoked artifact.

## Verification

Before declaring mitigation complete:

1. The rejected artifact cannot be selected from current, overlay, or LKG state.
2. The active fallback artifact has valid URL, digest, SRI, attestation, and runtime compatibility metadata.
3. Shell and unaffected remotes remain available.
4. Fallback telemetry includes canonical reason, code, and phase for integrity failures.
5. Revocation evidence proves that revocation overrides cache and LKG.

## Post-Incident Evidence Updates

Attach these to the `uw3-03` certification package:

1. Trust-check failure details and rejected artifact metadata.
2. Revocation list diff and policy approval.
3. Fallback decision evidence and selected artifact metadata.
4. Rebuild or republish evidence for corrected artifacts.
5. Security or release approval before removing revocation or resuming promotion.
