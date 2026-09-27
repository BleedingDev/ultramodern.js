---
'@modern-js/ultramodern-create': patch
---

Pin `@bleedingdev/mf-modern-js-v3` 2.9.2. Its SSR dev runtime plugin no longer renders a reload `<script>` inside the React tree, which React 19.3 reported on every client mount.
