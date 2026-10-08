---
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
---

Send native data envelopes for loaders that answered HTTP 206 as HTTP 200, keeping 206 in the envelope, and render a disabled Solid router Link to an external URL without an href so it cannot be followed.
