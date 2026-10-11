---
'@modern-js/ultramodern-create': patch
---

`ultramodern validate` checks a React app's authored React and router dependencies against the compatible ranges the React framework packages declare (their peer ranges, and the patch line of an exact framework dependency such as `@tanstack/react-router` through `@modern-js/plugin-tanstack`) instead of requiring the generator's exact pins. Apps that pin an earlier `@tanstack/react-router` 1.170.x or React 19.2.x validate again; Solid and Octane keep their exact renderer pins.
