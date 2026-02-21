- **Type:** `boolean | { enabled?: boolean; disableClientServer?: boolean }`
- **Default:** enabled in production build, disabled in development build

Configure [Rsdoctor](https://rsdoctor.dev/) diagnostics for build.

- This config only takes effect when using the Rspack provider.
- `disableClientServer` defaults to `true` to avoid hanging the build process after report generation.

### Example

```js
export default {
  performance: {
    rsdoctor: {
      enabled: true,
      disableClientServer: true,
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
