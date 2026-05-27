# UltraModern Cloudflare SSR Validation

Validates a Modern Cloudflare `.output` artifact without Zephyr credentials.

```bash
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-commerce \
  --expect-en "Commerce Remote" \
  --expect-cs "Obchodni remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/local-validation.json
```

The script checks the Worker entry, Wrangler ASSETS binding, MF manifest, locale
asset, optional Effect BFF worker bundle, SSR route responses, BFF JSON response,
and UI/API build-marker lockstep.
