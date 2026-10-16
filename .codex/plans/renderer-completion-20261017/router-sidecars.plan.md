---
name: Publish required router sidecars before native adoption
overview: Prepare the reviewed router producer as soon as navigation qualifies its recipe and finish bootstrap, publication and maturity independently.
todos:
  - id: modernjs-dnpv3.58.12.2
    content: Publish and age required authenticated router sidecars or prove no new sidecar is needed
    status: pending
isProject: false
---

# Publish required router sidecars before native adoption

## Execution notes

Before native source adopts new router aliases, identify which new router-core sidecars are actually required. Their names @bleedingdev/tanstack-router-core and @bleedingdev/tanstack-router-core-octane may not yet exist. The cohort integrator is the single sidecar publication owner. Start producer preparation as soon as navigation qualifies the necessary patch recipe, while the other feature lanes continue; do not wait for this downstream convergence task to become runnable. Track preparation, bootstrap and the age deadline under modernjs-dnpv3.58.12.2. Navigation closes on its local-pack criteria; this separate prerequisite remains open until accepted sidecar maturity or an evidence-backed no-sidecar disposition. Prepare an independent reviewed producer PR on current Modern main with a closed router sidecar profile, exact source/recipe/provenance and isolated package acceptance, then merge it through canonical checks. This prerequisite PR must not include the unfinished feature or pin unavailable packages. The existing workflow currently offers only parser and mf-sdk profiles, so the needed router profile and its CLI/security/consumer checks must land before dispatch.

Check registry existence and authenticated trust before dispatch. If a required name is absent, finish all reviewable preparation first and use the existing explicit first-package bootstrap contract: obtain user authorization for those exact package names, let the authenticated maintainer initialize the allowed deprecated0.0.0-bootstrap package and configure trust to the exact fork repository/workflow, and record its provenance.grandfatheredVersions entry through a reviewed source change. Request an OTP/token only through the host's secret input, never chat or logs; if no safe authenticated path is available, leave only that concrete setup blocked and continue independent work. Do not attempt real-version local publishing or bypass OIDC. Verify current npm documentation and installed CLI behavior at execution time rather than assuming automation can create a name. References: https://docs.npmjs.com/cli/v11/commands/npm-trust/ and https://docs.npmjs.com/trusted-publishers/ .

Acquire the shared publication slot described in dependency-release.plan.md before each sidecar dispatch. Publish the real accepted sidecar from its merged producer through OIDC once, verify immutable bytes and registry timestamp, and wait its full1440-minute age and any new transitive deadline before final installed acceptance. This gate precedes adoption of that package in native catalog/framework release pins. If the current supported closure needs no new name, record evidence and skip bootstrap.

## Success criteria

Every required router sidecar has an accepted merged producer, authenticated OIDC publication, exact archive/provenance verification and full1440-minute maturity. If no new sidecar is needed, record the exact supported closure and skip with evidence. The navigation local-pack lane can close independently; this issue blocks cohort adoption. Use its same single integrator, publication slot and normal fork/source rules.

## Constraints

Use the strict1440-minute pnpm flags and post-install baseline exclusion comparison defined in cohort.plan.md for every install or lockfile update; automatic new exemptions never qualify a consumer.

Read README.md and dependency-release.plan.md. Do not publish real versions locally, bypass first-name authentication, widen age exemptions, or merge unfinished feature source into the independent producer PR. No maintainer nudges or secret values in chat. Preserve all other sessions' work.
