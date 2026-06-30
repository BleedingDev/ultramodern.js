'@modern-js/app-tools': patch

Dispatch Cloudflare SSR and BFF document requests before falling back to the bound
Assets handler, so Cloudflare's SPA index fallback cannot bypass route workers and
drop SSR markup or federated remote CSS links.
