---
'@modern-js/federation-runtime': patch
'@modern-js/ultramodern-create': patch
---

`createDistributedSsrComponent` passes the `createLazyComponent` options it owns (`export: 'default'`, the fallback, `loading: null` and `injectLink: false`) to the `createComponent` factory, so the Module Federation bridge no longer renders a second remote CSS `<link>` into SSR HTML in any build format. Generated shells spread them:

```tsx
createDistributedSsrComponent<AddToCartProps>({
  createComponent: options =>
    createLazyComponent<RemoteComponentModule<AddToCartProps>, 'default'>({
      ...options,
      instance: getInstance(),
      loader: () => import('checkout/AddToCart'),
    }),
  expose: './AddToCart',
  fallback,
  remote: 'checkout',
});
```

The signature is unchanged: shells whose factory takes no options still type-check and render.
