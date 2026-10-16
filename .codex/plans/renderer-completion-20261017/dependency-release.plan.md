---
name: Observe the existing dependency publication to completion
overview: Keep the already authorized dependency release external to feature implementation and prevent a later feature release from overtaking it.
todos:
  - id: modernjs-2uw9v
    content: Reuse the existing dependency release and verify its completed publication result
    status: in_progress
isProject: false
---

# Observe the existing dependency publication to completion

## Execution notes

This node projects the existing task modernjs-2uw9v, not new implementation or authorization. Its owner publishes PR249 only from merged fork main-ultramodern through publish-bleedingdev.yml, publishes the exact parser sidecar if needed, waits the unchanged age policy and verifies the public cohort. Keep its chosen version/run and registry state authoritative. No feature lane or baseline depends on this task, so implementation proceeds after the merge gate during any dependency sidecar/acceptance wait. Only the final feature release waits for this existing release to finish.

## Success criteria

The dependency release task has its successful terminal workflow, verified complete cohort/dist-tags/release record and published consumer result, with no dispatch left pending. Reuse that issue's closure and mark this projection complete. A terminal failed publish with unfinished repair does not complete this node. Report and repair its owning task rather than allowing the feature release to hide it.

## Constraints

All live publish-bleedingdev.yml runs already share concurrency group publish-bleedingdev with cancel-in-progress:false. Preserve it. Before ANY feature sidecar or cohort dispatch, also inspect that no live dependency publish is queued/active and the existing owner has not reserved a next recovery dispatch. The feature integrator acquires publication ownership explicitly through the existing task notes before dispatch and records the run ID. Workflow locking prevents simultaneous mutation; the Beads gate prevents the final feature release overtaking the unfinished dependency release.

## Operator guidance

Do not recreate this task or publish a second dependency cohort. Continue independent feature work while its age/acceptance gate waits. This projection inherits canonical Beads status, never closes the task merely because planning finished.
