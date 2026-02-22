- **Type:** `boolean | { enabled?: boolean; disableClientServer?: boolean; reportDir?: string; mode?: 'normal' | 'brief' | 'lite' }`
- **Default:** enabled in production build, disabled in development build

Configure [Rsdoctor](https://rsdoctor.dev/) diagnostics for build.

- This config only takes effect when using the Rspack provider.
- `disableClientServer` defaults to `true` to avoid hanging the build process after report generation.
- `reportDir` lets you move diagnostics artifacts to a deterministic directory.
- `mode` controls RsDoctor report mode (`normal`, `brief`, `lite`).
- Modern.js writes a machine-readable diagnostics contract artifact to:
  - `<reportDir or outputPath>/.rsdoctor/ultramodern-diagnostics.json`
  - This contract points coding agents and tools to `.rsdoctor/manifest.json`.

### Example

```js
export default {
  performance: {
    rsdoctor: {
      enabled: true,
      disableClientServer: true,
      reportDir: './artifacts',
      mode: 'brief',
    },
  },
};
```

You can also use a boolean:

```js
export default {
  performance: {
    rsdoctor: false,
  },
};
```
