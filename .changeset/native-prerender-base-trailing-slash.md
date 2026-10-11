---
'@modern-js/ultramodern-app-tools': patch
---

Native prerendering matches a `server.baseUrl` written with a trailing slash, such as `/shop/`, against its routes, and still passes the configured value to function-valued SSG options.
