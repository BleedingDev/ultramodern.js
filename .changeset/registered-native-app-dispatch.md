---
'@modern-js/ultramodern-create': patch
---

Dispatch app generation through the registered renderer's generation kind so native owners emit their own templates without falling back to React.

Use the explicit renderer projection contract when validating workspace artifacts instead of a native renderer name list.

Generate API-only configs without React i18n or routing plugins and aliases so the headless source passes renderer validation.
