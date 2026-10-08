---
'@modern-js/renderer-solid': patch
---

Render Solid router links with a blocked protocol (such as `javascript:`, including rewritten external URLs) without an href and stop them from navigating, and keep a reactive `to` live when it moves between external and internal targets.
