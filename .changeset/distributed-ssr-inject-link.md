---
'@modern-js/federation-runtime': patch
'@modern-js/ultramodern-create': patch
---

`createDistributedSsrComponent` now creates the native remote itself and always passes `injectLink: false`, so the Module Federation bridge no longer renders a second remote CSS `<link>` into SSR HTML in any build format. Callers pass `createLazyComponent`, `getInstance` and `loader` instead of a `createComponent` thunk:

```tsx
createDistributedSsrComponent({
  createLazyComponent,
  expose: './AddToCart',
  fallback,
  getInstance,
  loader: () => import('checkout/AddToCart'),
  remote: 'checkout',
});
```

Generated shells use the new form.
