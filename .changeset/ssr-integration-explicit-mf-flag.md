---
'@modern-js/ultramodern-app-tools': patch
---

The SSR integration plugin no longer guesses Module Federation from `MF_SSR_PRJ`, `REMOTE_IP_STRATEGY`/`FEDERATION_IPV4` defines or a plugin named `*ModuleFederation*`, and `MODERN_MF_APP_SSR_REQUIRE_EXPLICIT` is gone. `server.ssr.moduleFederationAppSSR` alone drives `process.env.MODERN_MF_APP_SSR`, and Module Federation turns server `splitChunks` off itself (module-federation/core#5156).
