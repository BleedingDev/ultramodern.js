---
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-i18n': patch
---

Keep generated MicroVertical translation catalogs out of the shell delivery unit and scope federated UI to remote-owned i18n resources, so changing one MicroVertical updates its localized SSR and browser surfaces without rebuilding the shell.
