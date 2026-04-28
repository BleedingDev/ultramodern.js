# Remote Failure SOP

Use this SOP when a production Micro Vertical remote fails to load, times out, or becomes unavailable while the shell and unrelated remotes should stay available.

## Trigger

Start this SOP when any production signal shows one of the Wave 2 remote failure modes:

1. `remote-timeout` with fallback `reason=timeout`, `code=MV_TIMEOUT`, `phase=load`.
2. `network-failure` with fallback `reason=entry_load_failed`, `code=MV_ENTRY_LOAD_FAILED`, `phase=load`.
3. A route subtree backed by a remote fails while `shell-super-app` should keep serving unaffected components.

## Detection Evidence

Collect these before mitigation when possible, but do not wait if the user-facing blast radius is active:

1. `mv.remote.fallback` telemetry for the affected remote.
2. Affected topology reference ID, such as `remote-commerce` or `remote-identity`.
3. Current production environment overlay and selected artifact ID.
4. Shell survivability proof showing `shell-super-app` and unrelated remotes still render.
5. Wave 2 comparison evidence from `wave2-remote-failure-drills`, especially `uw2-02-timeout-remote-commerce` or `uw2-02-network-remote-identity`.

## Immediate Mitigation

1. Confirm the issue is isolated to the affected remote and does not indicate shell startup failure.
2. Keep the shell online and preserve unrelated remote traffic.
3. Route the affected subtree to the declared fallback surface.
4. Stop new promotion for the affected remote until the owner team confirms a good artifact.
5. Page the owning vertical from the topology or remediation evidence: `commerce-experience` for `remote-commerce`, `identity-platform` for `remote-identity`.

## Rollback And Kill-Switch Sequence

Apply the production equivalent of `uw2-05-rollback-kill-switch-slo`:

1. Mark the incident severity and start the rollback timer.
2. Select the fallback order `current -> environment-overlay -> lkg -> csr-fallback`.
3. If current and environment-overlay artifacts are bad or unreachable, enable the remote kill switch by topology ID.
4. Force LKG when the LKG artifact is not revoked and still satisfies trust metadata.
5. Use CSR fallback only when LKG is absent, expired, revoked, or also failing.
6. Revoke the bad current or overlay artifact when reuse would re-trigger the incident.
7. Confirm `mv.manifest.fallback.selected` and `mv.rollback.kill_switch.slo` telemetry record the selected stage.

## Ownership And Escalation

1. Owning vertical handles artifact diagnosis and replacement.
2. Platform runtime owner handles topology selection, LKG, CSR fallback, and kill-switch behavior.
3. Incident owner approves rollout pause, artifact revocation, and production resume.
4. Escalate to platform owners when the failure affects shell survivability, fallback telemetry, trust enforcement, or multiple remotes.

## Verification

Before declaring mitigation complete:

1. The affected route renders fallback, LKG, or CSR fallback without taking down `shell-super-app`.
2. Unaffected component IDs from the topology remain available.
3. Fallback telemetry is present with the canonical reason, code, and phase.
4. The selected artifact is not revoked.
5. Production health checks pass for shell, unaffected remotes, and the affected fallback path.

## Post-Incident Evidence Updates

Attach these to the `uw3-03` certification package:

1. Incident timeline with detection, mitigation, and total elapsed time.
2. Topology manifest before and after mitigation.
3. Kill-switch or LKG selection evidence.
4. Revocation record for bad artifacts, if used.
5. Owner approval to resume rollout and any follow-up issue for permanent repair.
