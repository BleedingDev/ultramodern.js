---
name: ultramodern-framework-propagation-03-i18n-boundaries-scaffold
overview: Strengthen generated i18n and native boundary debugging so new UltraModern apps get translation-tool-friendly resources, persisted debug boundaries, and no confusing page overlays without Tractor-specific runtime code.
todos:
  - id: audit-generated-i18n-runtime
    content: "Compare generated i18n runtime, locale JSON files, route metadata, and Tractor's inline resources to identify duplicate, non-extractable, or manually split strings."
    status: pending
  - id: standardize-json-i18n-template
    content: "Update the scaffold to generate translation-tool-friendly JSON resources with namespaces, supported languages, full phrases, route labels, and plural-capable examples."
    status: pending
  - id: remove-manual-language-logic-patterns
    content: "Add generation and validation rules that prevent manual language ternaries and literal split phrases in scaffolded code."
    status: pending
  - id: harden-boundary-debugger-runtime
    content: "Make native boundary debugging persist state across language changes, render nothing visible when disabled, and show clear non-overlapping ownership boundaries when enabled."
    status: pending
  - id: expose-boundary-debugger-as-framework-feature
    content: "Ensure generated apps can use boundary debugging through UltraModern runtime metadata without hand-written overlay components."
    status: pending
  - id: test-i18n-and-boundaries
    content: "Add scaffold/runtime validation for SSR i18n, language switching, plural-ready copy, and boundary state persistence across routes and locales."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-03-i18n-boundaries-scaffold

## Execution Notes

Generated apps already have an UltraModern boundary debugger plugin, but the demo still needed custom behavior to make boundaries usable. Tractor also moved toward i18next JSON resources, but still carries large duplicated inline `resources` in `modern.runtime.ts`; that is not a clean scaffold pattern.

This lane makes i18n and boundaries first-class framework defaults rather than demo-specific UX patches.

## Constraints

Use native i18n resources that external translation tools can process. Support plurals. Do not generate manual `language === 'en' ? ... : ...` logic. Do not generate visible app copy as split fragments that translators cannot reorder.

Boundary debugging must be optional debug UI, not part of normal page flow. When off, no border or label should remain visible.

## Operator Guidance

This lane can run in parallel with Cloudflare deploy and CSS. It blocks generated scaffold validation because validation must cover language switching and persisted boundary state in a fresh app.
