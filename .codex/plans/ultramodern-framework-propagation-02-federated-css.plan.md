---
name: ultramodern-framework-propagation-02-federated-css
overview: Replace Tractor's hardcoded remote stylesheet workaround with a framework-level federated CSS first-paint strategy derived from topology and build manifests, preserving SSR and no-JS styling without disabling asset hashing.
todos:
  - id: audit-remote-css-assets
    content: "Inspect generated Modern.js and Module Federation asset metadata for shell and vertical CSS outputs, including hashed and non-hashed builds."
    status: pending
  - id: design-topology-driven-css-contract
    content: "Define how shell SSR discovers and emits remote stylesheet links from topology, public URL envs, and build manifests without app-local hardcoded paths."
    status: pending
  - id: implement-framework-css-injection
    content: "Implement the chosen framework or generated-template mechanism for remote CSS first paint, avoiding duplicate links and preserving no-JS SSR styling."
    status: pending
  - id: remove-filename-hash-requirement
    content: "Eliminate the need for generated apps or Tractor to set output.filenameHash=false by resolving actual CSS asset URLs from reliable metadata."
    status: pending
  - id: test-css-isolation-and-no-flicker
    content: "Add validation that prefixed Tailwind v4 classes, remote CSS loading, SSR output, and JS-disabled rendering do not flicker or collide across shell and verticals."
    status: pending
  - id: document-css-propagation-rule
    content: "Document that app demos should use framework federated CSS behavior rather than injecting async-index.css or stylesheet plugins locally."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-02-federated-css

## Execution Notes

The demo currently injects styles with `shellStylesheetPlugin`, `Helmet` links, `ULTRAMODERN_*_URL` globals, and hardcoded `/static/css/async/async-index.css`. That made the demo usable, but it is the wrong abstraction boundary. CSS first paint is a framework concern for SSR Module Federation.

The target is a native UltraModern path: generated apps should get correct SSR CSS from topology and manifests, with Tailwind v4 prefixes still preventing class collisions.

## Constraints

Avoid non-Tailwind CSS in app code unless absolutely necessary. Do not rely on magic string paths like `async-index.css`. Do not globally disable filename hashing just to make links predictable. Do not let shell CSS override remote styles through load-order accidents.

## Operator Guidance

This lane can run in parallel with Cloudflare deploy and i18n/boundary work. It should feed the scaffold validation lane with a concrete assertion: JS-disabled pages render styled shell and vertical content without demo-local CSS injection.
