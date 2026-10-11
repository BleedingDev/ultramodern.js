---
"@modern-js/ultramodern-app-tools": patch
---

Preserve registered SDK renderer IDs in selected profile and build manifest types while keeping generic renderer transport open. Reject a registration whose generation profile identifies a different renderer before returning selected metadata or resolving installed providers.

Keep public renderer selection declarations independent of the owning CLI and runtime types by projecting their identifiers from the actual registrations.
