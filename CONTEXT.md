# UltraModern MicroVertical Context

This context defines language for UltraModern MicroVertical work. Implementation choices belong in ADRs; this file only defines the vocabulary.

## Language

**MicroVertical**: A business vertical delivered as one versioned unit. Its user-facing surface and server capability come from the same source revision and are promoted together, so incompatible frontend/backend combinations are not valid states. A shell may compose multiple MicroVertical delivery units, but each MicroVertical remains indivisible.
_Avoid_: Independent frontend remote, independently released backend, version-skewed vertical.

**Delivery Unit**: The indivisible release boundary for one **MicroVertical**. A delivery unit may produce multiple runtime artifacts, but those artifacts represent one source revision and are validated as one vertical.
_Avoid_: Deployment bundle when it implies a platform-specific package, independent service release.

**Federated Surface**: A runtime composition boundary exposed by a **Delivery Unit** for another part of the system to consume. Federation changes how a unit is composed at runtime; it does not permit mixing artifacts from different delivery units.
_Avoid_: Independently deployable remote, arbitrary swappable part.

**Platform Surface**: A supported runtime environment for the same **Delivery Unit**. Platform surfaces may use different adapters, but they preserve the MicroVertical's delivery-unit identity.
_Avoid_: Separate product architecture, separate version stream.

## Flagged Ambiguities

**Remote**: Existing docs sometimes use remote to imply an independently released application. In MicroVertical discussions, remote should mean a **Federated Surface** of a **Delivery Unit** unless explicitly discussing a legacy or horizontal remote.

**Swappable**: Existing language may imply swapping frontend/backend versions independently. In MicroVertical discussions, swappable means choosing a platform/runtime adapter or replacing an entire **Delivery Unit**, not mixing frontend and backend artifacts from different source revisions.

## Example Dialogue

Developer: "Can I deploy the checkout frontend remote without its server capability?"

Domain expert: "No. Checkout is a MicroVertical, so its federated surfaces belong to one Delivery Unit."

Developer: "Can the checkout Delivery Unit run on different platform surfaces?"

Domain expert: "Yes, if each platform surface preserves the same delivery-unit identity and rejects mixed frontend/backend revisions."
