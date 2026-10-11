---
'@modern-js/ultramodern-create': patch
---

Generated Octane apps keep their `Counter` and `Stable` component state in `useState` instead of `useSignal$`. Once a streamed-signal module has run, `@octanejs/rspack-plugin` reloads the whole document on every hot update, so signal state could not survive an edit; hook state does.
