# Design-System Failure SOP

Use this SOP when the horizontal design-system remote or provider contract causes production token, API, SSR, hydration, or contract-version failures.

## Trigger

Start this SOP when production evidence shows:

1. A promoted design-system artifact breaks a vertical consumer.
2. Required tokens or APIs disappear, such as `color.checkout.warning` or `CheckoutSummary`.
3. A consumer receives the wrong contract version, such as a `ds-contract-v1.14` consumer receiving a `ds-contract-v1.15` artifact.
4. The design-system remote fails trust checks before activation and overlaps with design-system availability.

## Detection Evidence

Collect:

1. The design-system remote ID, normally `remote-design-system`.
2. Bad artifact ID and version.
3. Impacted and unaffected consumers from the contract diff.
4. Token/API diff and expected contract version for each consumer.
5. Pin evidence from the production equivalent of `uw2-03-design-system-bad-release`.

Wave 2 baseline: `artifact-remote-design-system-2026-04-22-013` at `1.15.0-wave2.0` broke `remote-commerce` by removing `CheckoutSummary` and `color.checkout.warning`, while `remote-identity` and `shell-super-app` remained unaffected.

## Immediate Mitigation

1. Freeze design-system promotion.
2. Confirm whether impact is consumer-specific or platform-wide.
3. Keep unaffected consumers on their observed good pins.
4. For affected consumers, pin back to the last compatible design-system artifact.
5. Page `design-platform-oncall` and the affected vertical owner.

Do not disable unrelated vertical remotes solely because a design-system contract broke one consumer.

## Rollback And Kill-Switch Sequence

1. Roll back the affected consumer pin to the last compatible artifact.
2. For the Wave 2 pattern, the compatible rollback target is `artifact-remote-design-system-2026-04-15-009`, `1.14.0-wave2.3`, `ds-contract-v1.14`.
3. If the design-system artifact is unsafe for all consumers, enable the topology kill switch for `remote-design-system`.
4. If the artifact is compromised or policy-violating, revoke it so LKG and overlays cannot select it.
5. Confirm fallback telemetry for affected consumers and rollback telemetry for the selected design-system pin.
6. Resume promotion only after contract evidence proves restored tokens, APIs, SSR stability, hydration stability, and compatibility metadata.

## Ownership And Escalation

1. `design-platform-oncall` owns design-system artifact rollback and replacement.
2. Affected vertical owners confirm consumer rendering and workflow recovery.
3. Runtime/platform owners validate topology selection, revocation, and fallback behavior.
4. Incident owner decides whether rollout is paused for all verticals or only for design-system promotion.

Escalate to platform owner approval when the failure touches shared primitives, trust metadata, compatibility digest, fallback behavior, or shell rendering.

## Verification

Before declaring mitigation complete:

1. Affected consumers render with all required tokens and APIs.
2. Unaffected consumers remain on their expected pins and do not regress.
3. SSR and hydration checks pass for shell and remote render paths.
4. The selected design-system artifact has complete trust metadata and compatibility digest.
5. Telemetry shows the rollback or fallback decision and no continuing contract-version skew.

## Post-Incident Evidence Updates

Attach these to the `uw3-03` certification package:

1. Bad artifact ID, rollback artifact ID, and contract versions.
2. Token/API diff and impacted consumer list.
3. Consumer pin evidence for affected and unaffected consumers.
4. Approval from `design-platform-oncall` and affected vertical owners.
5. Follow-up work for compatibility adapter, restored surface, or certification profile changes.
