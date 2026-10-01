# Complete declared dependency inventory

Captured on 2026-10-01. Targets are research candidates. The implementation must freeze a checked manifest/peer/alias/patch matrix before installing. `latest` is a dist-tag, and may identify a prerelease. Local and generated identities are included for coverage but are not npm upgrade requests. Consumer paths, selectors, ranges, engines and peer requirements are in [dependency-inventory.json](dependency-inventory.json).

| Dependency | Declared versions/ranges | npm latest | Candidate | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| @babel/core | ^7.29.7; ^8.0.6 | 8.0.6 | 8.0.6 | upgrade candidate | tooling |
| @babel/parser | ^8.0.6 | 7.29.9 | 7.29.9 | review older latest tag, never auto-downgrade | tooling |
| @babel/plugin-transform-modules-commonjs | ^8.0.1 | 8.0.1 | 8.0.1 | current or range/override review | tooling |
| @babel/preset-env | ^7.29.7 | 8.0.6 | 8.0.6 | upgrade candidate | tooling |
| @babel/preset-react | ^7.29.7 | 8.0.1 | 8.0.1 | upgrade candidate | tooling |
| @babel/preset-typescript | ^7.29.7 | 8.0.1 | 8.0.1 | upgrade candidate | tooling |
| @babel/traverse | ^8.0.6 | 8.0.6 | 8.0.6 | current or range/override review | tooling |
| @babel/types | ^8.0.6 | 8.0.6 | 8.0.6 | current or range/override review | tooling |
| @biomejs/biome | 1.9.4; 1.8.3; 2.5.3 | 2.5.15 | 2.5.15 | upgrade candidate | tooling |
| @bleedingdev/effect | 4.0.0-rc.117 | 4.0.0-rc.117 | 4.0.0-rc.117 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-bridge-react | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-cli | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-dts-plugin | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-enhanced | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-manifest | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-modern-js-v3 | 2.9.1 | 2.9.3 | 2.9.3 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-node | 2.7.51 | 2.7.52 | 2.7.52 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-rsbuild-plugin | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-rspack | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-runtime | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-runtime-core | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-runtime-tools | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @bleedingdev/mf-webpack-bundler-runtime | 2.9.1 | 2.9.2 | 2.9.2 | rebuild corrected artifact from chosen upstream | generator |
| @changesets/assemble-release-plan | ^6.0.10 | 7.0.0 | 7.0.0 | upgrade candidate | tooling |
| @changesets/cli | ^2.31.1 | 3.0.3 | 3.0.3 | upgrade candidate | tooling |
| @changesets/config | ^3.1.4 | 4.0.1 | 4.0.1 | upgrade candidate | tooling |
| @changesets/read | ^0.6.7 | 1.0.1 | 1.0.1 | upgrade candidate | tooling |
| @cloudflare/workers-types | 5.20260923.1 | 5.20261001.1 | 5.20261001.1 | upgrade candidate | generator |
| @codesandbox/sandpack-react | ^2.20.0 | 2.20.0 | 2.20.0 | current or range/override review | runtime |
| @commitlint/cli | ^21.2.3 | 21.2.3 | 21.2.3 | current or range/override review | tooling |
| @commitlint/config-conventional | ^21.2.3 | 21.2.3 | 21.2.3 | current or range/override review | tooling |
| @effect/opentelemetry | 4.0.0-rc.117 | 4.0.0 | 4.0.0 | upgrade candidate | effect |
| @effect/tsgo | 0.45.0 | 0.47.2 | 0.47.2 | upgrade candidate | effect |
| @fastify/accept-negotiator | ^2.0.1 | 2.1.0 | 2.1.0 | upgrade candidate | runtime |
| @isaacs/brace-expansion | >=5.0.1 | 5.0.1 | 5.0.1 | current or range/override review | runtime |
| @jest/types | ^30.5.1 | 30.5.1 | 30.5.1 | current or range/override review | runtime |
| @jridgewell/trace-mapping | ^0.3.31 | 0.3.31 | 0.3.31 | current or range/override review | runtime |
| @loadable/component | 5.16.7 | 5.16.7 | 5.16.7 | current or range/override review | runtime |
| @loadable/server | 5.16.7 | 5.16.7 | 5.16.7 | current or range/override review | runtime |
| @manypkg/get-packages | ^3.1.0 | 3.1.0 | 3.1.0 | current or range/override review | runtime |
| @modern-js/adapter-rstest | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/app-tools | workspace:*; workspace:^3.9.0; 2.66.0; 3.0.0; link:../../packages/solutions/app-tools | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/app-tools-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/backend-federation-contracts | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/bff-core | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/bff-effect | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/bff-runtime | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/builder | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/codesmith | 2.6.9 | 2.6.9 | 2.6.9 | current or range/override review | runtime |
| @modern-js/codesmith-api-handlebars | 2.6.9 | 2.6.9 | 2.6.9 | current or range/override review | runtime |
| @modern-js/codesmith-utils | 2.6.9 | 2.6.9 | 2.6.9 | current or range/override review | runtime |
| @modern-js/create | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/create-request | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/federation-runtime | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/i18n-integration | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/i18n-runtime-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/i18n-utils | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/image | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-bff | workspace:*; 3.0.0 | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-bff-build-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/plugin-bff-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/plugin-data-loader | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-i18n | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-polyfill | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-ssg | workspace:*; 3.0.0 | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-styled-components | workspace:*; 3.0.0 | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/plugin-tanstack | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/polyfill-lib | ^1.0.2 | 1.0.2 | 1.0.2 | current or range/override review | runtime |
| @modern-js/prod-server | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/render | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/rslib | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/runtime | workspace:*; workspace:^3.9.0; 2.66.0; 3.0.0; link:../../packages/runtime | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/runtime-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/runtime-renderer-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/runtime-utils | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/sandpack-react | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/server | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/server-core | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/server-runtime | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/server-runtime-extensions | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/server-utils | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/surface-resolution | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/tsconfig | workspace:*; 3.0.0 | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/types | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @modern-js/ultramodern-app-tools | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/ultramodern-create | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/ultramodern-sandpack-profile | workspace:* | none | none | local or fixture identity | runtime |
| @modern-js/utils | workspace:* | 3.9.3 | 3.9.3 | local or fixture identity | runtime |
| @module-federation/bridge-react | 2.9.1; npm:@bleedingdev/mf-bridge-react@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/cli | 2.9.1; npm:@bleedingdev/mf-cli@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/dts-plugin | npm:@bleedingdev/mf-dts-plugin@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/enhanced | 2.9.1; npm:@bleedingdev/mf-enhanced@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/manifest | npm:@bleedingdev/mf-manifest@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/modern-js-v3 | 2.9.1; npm:@bleedingdev/mf-modern-js-v3@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/node | 2.7.51; npm:@bleedingdev/mf-node@2.7.51 | 2.7.52 | 2.7.52 | upgrade candidate | build |
| @module-federation/rsbuild-plugin | npm:@bleedingdev/mf-rsbuild-plugin@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/rspack | npm:@bleedingdev/mf-rspack@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/runtime | 2.9.1; npm:@bleedingdev/mf-runtime@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/runtime-core | npm:@bleedingdev/mf-runtime-core@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/runtime-tools | 2.9.1; npm:@bleedingdev/mf-runtime-tools@2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @module-federation/webpack-bundler-runtime | npm:@bleedingdev/mf-webpack-bundler-runtime@2.9.1; 2.9.1 | 2.9.2 | 2.9.2 | upgrade candidate | build |
| @opentelemetry/api | 1.9.1 | 1.9.1 | 1.9.1 | current or range/override review | runtime |
| @opentelemetry/api-logs | 0.222.0 | 0.222.0 | 0.222.0 | current or range/override review | runtime |
| @opentelemetry/resources | 2.11.0 | 2.11.0 | 2.11.0 | current or range/override review | runtime |
| @opentelemetry/sdk-logs | 0.222.0 | 0.222.0 | 0.222.0 | current or range/override review | runtime |
| @opentelemetry/sdk-metrics | 2.11.0 | 2.11.0 | 2.11.0 | current or range/override review | runtime |
| @opentelemetry/sdk-trace-base | 2.11.0 | 2.11.0 | 2.11.0 | current or range/override review | runtime |
| @opentelemetry/sdk-trace-node | 2.11.0 | 2.11.0 | 2.11.0 | current or range/override review | runtime |
| @opentelemetry/sdk-trace-web | 2.11.0 | 2.11.0 | 2.11.0 | current or range/override review | runtime |
| @opentelemetry/semantic-conventions | 1.43.0 | 1.43.0 | 1.43.0 | current or range/override review | runtime |
| @playwright/test | ^1.63.0; 1.63.0 | 1.63.0 | 1.63.0 | current or range/override review | tooling |
| @remix-run/router | >=1.23.4 | 1.23.4 | 1.23.4 | current or range/override review | runtime |
| @remix-run/web-fetch | ^4.4.2 | 4.4.2 | 4.4.2 | current or range/override review | runtime |
| @rollup/plugin-json | 6.1.0 | 6.1.0 | 6.1.0 | current or range/override review | runtime |
| @rsbuild-image/core | 0.0.1-next.36 | 0.0.1-next.36 | 0.0.1-next.36 | preserve qualified prerelease contract | runtime |
| @rsbuild-image/react | 0.0.1-next.36 | 0.0.1-next.36 | 0.0.1-next.36 | preserve qualified prerelease contract | runtime |
| @rsbuild/core | 2.2.9 | 2.2.11 | 2.2.11 | upgrade candidate | build |
| @rsbuild/plugin-assets-retry | 2.0.2 | 2.0.2 | 2.0.2 | current or range/override review | build |
| @rsbuild/plugin-babel | 2.1.0 | 2.1.0 | 2.1.0 | fixture contract | build |
| @rsbuild/plugin-check-syntax | 2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | build |
| @rsbuild/plugin-css-minimizer | 2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | build |
| @rsbuild/plugin-less | 2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | build |
| @rsbuild/plugin-node-polyfill | ^1.4.6 | 1.4.6 | 1.4.6 | current or range/override review | build |
| @rsbuild/plugin-react | 2.1.0 | 2.1.1 | 2.1.1 | upgrade candidate | build |
| @rsbuild/plugin-rem | 1.0.6 | 1.0.6 | 1.0.6 | current or range/override review | build |
| @rsbuild/plugin-sass | 2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | build |
| @rsbuild/plugin-source-build | 1.0.7 | 1.0.7 | 1.0.7 | current or range/override review | build |
| @rsbuild/plugin-styled-components | 1.7.0 | 1.7.0 | 1.7.0 | current or range/override review | build |
| @rsbuild/plugin-svgr | 2.0.5 | 2.0.5 | 2.0.5 | current or range/override review | build |
| @rsbuild/plugin-tailwindcss | 2.0.3; ^2.0.3 | 2.0.3 | 2.0.3 | current or range/override review | build |
| @rsbuild/plugin-type-check | 1.6.0 | 1.6.0 | 1.6.0 | current or range/override review | build |
| @rsbuild/plugin-typed-css-modules | 1.2.4 | 1.2.4 | 1.2.4 | current or range/override review | build |
| @rsdoctor/rspack-plugin | ^1.6.4 | 1.6.4 | 1.6.4 | current or range/override review | runtime |
| @rslib/core | 1.0.2 | 1.0.3 | 1.0.3 | upgrade candidate | build |
| @rspress/core | 2.0.22 | 2.0.23 | 2.0.23 | upgrade candidate | build |
| @rspress/plugin-llms | 2.0.22 | 2.0.23 | 2.0.23 | upgrade candidate | build |
| @rspress/shared | 2.0.22 | 2.0.23 | 2.0.23 | upgrade candidate | build |
| @rstest/adapter-rsbuild | ^0.11.12 | 0.12.3 | 0.12.3 | upgrade candidate | build |
| @rstest/browser | 0.11.12 | 0.12.3 | 0.12.3 | upgrade candidate | build |
| @rstest/browser-react | 0.11.12 | 0.12.3 | 0.12.3 | upgrade candidate | build |
| @rstest/core | 0.11.12 | 0.12.3 | 0.12.3 | upgrade candidate | build |
| @scripts/build | workspace:* | none | none | local or fixture identity | runtime |
| @scripts/rstest-config | workspace:* | none | none | local or fixture identity | runtime |
| @shikijs/transformers | ^4.4.3 | 4.5.0 | 4.5.0 | upgrade candidate | runtime |
| @source-code-build/components | workspace:* | none | none | local or fixture identity | runtime |
| @source-code-build/utils | workspace:* | none | none | local or fixture identity | runtime |
| @storybook/addon-docs | ^10.6.0 | 10.6.1 | 10.6.1 | upgrade candidate | build |
| @storybook/addon-onboarding | ^10.6.0 | 10.6.1 | 10.6.1 | upgrade candidate | build |
| @storybook/react | ^10.6.0 | 10.6.1 | 10.6.1 | upgrade candidate | build |
| @svgr/core | 8.1.0 | 8.1.0 | 8.1.0 | current or range/override review | runtime |
| @svgr/plugin-jsx | 8.1.0 | 8.1.0 | 8.1.0 | current or range/override review | runtime |
| @svgr/plugin-svgo | 8.1.0 | 8.1.0 | 8.1.0 | current or range/override review | runtime |
| @swc/core | 1.16.2 | 1.16.13 | 1.16.13 | upgrade candidate | build |
| @swc/helpers | ^0.5.23 | 0.5.23 | 0.5.23 | current or range/override review | build |
| @swc/plugin-loadable-components | ^13.0.0 | 14.0.0 | 14.0.0 | upgrade candidate | build |
| @tailwindcss/postcss | ^4.3.3 | 4.3.3 | 4.3.3 | current or range/override review | runtime |
| @tanstack/history | 1.162.4 | 1.162.4 | 1.162.4 | current or range/override review | runtime |
| @tanstack/react-router | 1.170.39 | 1.170.41 | 1.170.41 | upgrade candidate | runtime |
| @tanstack/router-core | 1.171.32 | 1.171.34 | 1.171.34 | upgrade candidate | runtime |
| @testing-library/dom | ^10.4.2 | 10.4.2 | 10.4.2 | current or range/override review | tooling |
| @testing-library/jest-dom | ^6.9.1 | 7.0.1 | 7.0.1 | upgrade candidate | tooling |
| @testing-library/react | ^16.3.3 | 16.3.3 | 16.3.3 | current or range/override review | tooling |
| @tsconfig/strictest | 2.0.8 | 2.0.8 | 2.0.8 | current or range/override review | runtime |
| @types/babel__core | ^7.20.5 | 7.20.5 | 7.20.5 | current or range/override review | tooling |
| @types/babel__traverse | 7.28.0 | 7.28.0 | 7.28.0 | current or range/override review | tooling |
| @types/cloneable-readable | ^2.0.3 | 2.0.3 | 2.0.3 | current or range/override review | tooling |
| @types/connect | ^3.4.38 | 3.4.38 | 3.4.38 | current or range/override review | tooling |
| @types/connect-history-api-fallback | ^1.5.4 | 1.5.4 | 1.5.4 | current or range/override review | tooling |
| @types/cookie | 0.6.0 | 1.0.0 | 1.0.0 | replace or remove deprecated package | tooling |
| @types/debug | 4.1.13 | 4.1.13 | 4.1.13 | current or range/override review | tooling |
| @types/express | ^5.0.6 | 5.0.6 | 5.0.6 | current or range/override review | tooling |
| @types/fs-extra | 11.0.4 | 11.0.4 | 11.0.4 | current or range/override review | tooling |
| @types/glob | 7.2.0 | 9.0.0 | 9.0.0 | replace or remove deprecated package | tooling |
| @types/html-minifier-terser | ^7.0.2 | 7.0.2 | 7.0.2 | current or range/override review | tooling |
| @types/inquirer | 9.0.10 | 9.0.10 | 9.0.10 | current or range/override review | tooling |
| @types/invariant | ^2.2.37 | 2.2.37 | 2.2.37 | current or range/override review | tooling |
| @types/ioredis-mock | ^8.2.8 | 8.2.8 | 8.2.8 | current or range/override review | tooling |
| @types/jest | ~29.5.14; ^30.0.0 | 30.0.0 | 30.0.0 | upgrade candidate | tooling |
| @types/js-yaml | 4.0.9 | 4.0.9 | 4.0.9 | current or range/override review | tooling |
| @types/koa | ^2.15.2; 3.0.3 | 3.0.3 | 3.0.3 | upgrade candidate | tooling |
| @types/koa-compose | ^3.2.9 | 3.2.9 | 3.2.9 | current or range/override review | tooling |
| @types/less | 3.0.8 | 3.0.8 | 3.0.8 | current or range/override review | tooling |
| @types/loadable__component | ^5.13.10 | 5.13.10 | 5.13.10 | current or range/override review | tooling |
| @types/loadable__server | 5.12.11 | 5.12.11 | 5.12.11 | current or range/override review | tooling |
| @types/lodash | ^4.17.25 | 4.17.25 | 4.17.25 | current or range/override review | tooling |
| @types/lodash-es | ^4.17.12 | 4.17.12 | 4.17.12 | current or range/override review | tooling |
| @types/merge-deep | ^3.0.3 | 3.0.3 | 3.0.3 | current or range/override review | tooling |
| @types/mime-types | 3.0.1 | 3.0.1 | 3.0.1 | current or range/override review | tooling |
| @types/minimist | 1.2.5 | 1.2.5 | 1.2.5 | current or range/override review | tooling |
| @types/node | ^26.6.2; ^20.19.43; ^20 | 26.6.3 | 26.6.3 | upgrade candidate | tooling |
| @types/normalize-path | 3.0.2 | 3.0.2 | 3.0.2 | current or range/override review | tooling |
| @types/qs | ^6.15.1 | 6.15.1 | 6.15.1 | current or range/override review | tooling |
| @types/react | ^19.3.0; ^19.1.8 | 19.3.0 | 19.3.0 | current or range/override review | tooling |
| @types/react-dom | ^19.3.0; ^19.1.6 | 19.3.0 | 19.3.0 | current or range/override review | tooling |
| @types/react-helmet | ^6.1.11 | 6.1.11 | 6.1.11 | current or range/override review | tooling |
| @types/recursive-readdir | ^2.2.4 | 2.2.4 | 2.2.4 | current or range/override review | tooling |
| @types/semver | 7.8.0 | 7.8.0 | 7.8.0 | current or range/override review | tooling |
| @types/serve-static | ^2.2.0 | 2.2.0 | 2.2.0 | current or range/override review | tooling |
| @types/signal-exit | 3.0.4 | 4.0.0 | 4.0.0 | replace or remove deprecated package | tooling |
| @types/signale | 1.4.7 | 1.4.7 | 1.4.7 | current or range/override review | tooling |
| @types/styled-components | ^5.1.36 | 5.1.36 | 5.1.36 | current or range/override review | tooling |
| @types/supertest | ^7.2.1 | 7.2.1 | 7.2.1 | current or range/override review | tooling |
| @types/type-is | ^1.6.7 | 1.6.7 | 1.6.7 | current or range/override review | tooling |
| @types/ua-parser-js | ^0.7.39 | 0.7.39 | 0.7.39 | current or range/override review | tooling |
| @types/url-join | 4.0.3 | 5.0.0 | 5.0.0 | replace or remove deprecated package | tooling |
| @types/ws | ^8.18.1 | 8.18.2 | 8.18.2 | upgrade candidate | tooling |
| @typescript/native | npm:typescript@7.0.2 | none | none | npm alias label | tooling |
| @typescript/native-preview | 7.0.0-dev.20260707.2; >=7.0.0-dev.20260628.1 | 7.0.0-dev.20260707.2 | 7.0.0-dev.20260707.2 | preserve qualified prerelease contract | tooling |
| @vercel/ncc | 0.44.1 | 0.45.0 | 0.45.0 | upgrade candidate | runtime |
| @vitejs/plugin-react | ^6.1.1 | 6.1.1 | 6.1.1 | current or range/override review | runtime |
| @web-std/fetch | ^4.2.1 | 4.2.1 | 4.2.1 | current or range/override review | runtime |
| @web-std/file | ^3.0.3 | 3.0.3 | 3.0.3 | current or range/override review | runtime |
| @web-std/stream | ^1.0.3 | 1.0.3 | 1.0.3 | current or range/override review | runtime |
| address | 2.0.3 | 2.0.3 | 2.0.3 | current or range/override review | runtime |
| antd | ^5.29.3; ^6.6.5 | 6.6.5 | 6.6.5 | upgrade candidate | runtime |
| autoprefixer | 10.6.1 | 10.6.1 | 10.6.1 | current or range/override review | runtime |
| axios | ^1.20.0 | 1.20.0 | 1.20.0 | current or range/override review | runtime |
| babel-jest | ^29.7.0 | 30.5.2 | 30.5.2 | upgrade candidate | tooling |
| babel-plugin-macros | 3.1.0 | 3.1.0 | 3.1.0 | fixture contract | tooling |
| bff-api-app | workspace:* | none | none | local or fixture identity | runtime |
| brace-expansion | 1.1.18; 2.1.4; 5.0.12 | 5.0.12 | 5.0.12 | current or range/override review | runtime |
| broken-local-dep-xyz | file:./this-path-does-not-exist | none | none | local or fixture identity | runtime |
| browserslist | 4.29.0 | 4.29.3 | 4.29.3 | upgrade candidate | runtime |
| caniuse-lite | ^1.0.30001810 | 1.0.30001814 | 1.0.30001814 | upgrade candidate | runtime |
| chalk | 5.6.2 | 6.0.1 | 6.0.1 | upgrade candidate | runtime |
| check-dependency-version-consistency | 6.0.0 | 6.0.0 | 6.0.0 | current or range/override review | tooling |
| chokidar | 5.0.0 | 5.0.0 | 5.0.0 | current or range/override review | runtime |
| citty | ^0.1.6 | 0.2.2 | 0.2.2 | upgrade candidate | runtime |
| classnames | ^2.5.1 | 2.5.1 | 2.5.1 | current or range/override review | runtime |
| client-only | ^0.0.1 | 0.0.1 | 0.0.1 | current or range/override review | runtime |
| cloneable-readable | ^3.0.0 | 3.0.0 | 3.0.0 | current or range/override review | runtime |
| clsx | ^2.1.1 | 2.1.1 | 2.1.1 | current or range/override review | runtime |
| commander | 15.0.0 | 15.0.0 | 15.0.0 | current or range/override review | runtime |
| compression-webpack-plugin | ^12.0.0 | 12.0.0 | 12.0.0 | current or range/override review | runtime |
| connect | ^3.7.0 | 3.7.0 | 3.7.0 | current or range/override review | runtime |
| connect-history-api-fallback | ^2.0.0 | 2.0.0 | 2.0.0 | current or range/override review | runtime |
| consola | ^3.4.2 | 3.4.2 | 3.4.2 | current or range/override review | runtime |
| cookie | 2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | runtime |
| core-js | ^3.50.0 | 3.50.0 | 3.50.0 | current or range/override review | runtime |
| cross-env | ^10.1.0; 10.1.0 | 10.1.0 | 10.1.0 | current or range/override review | runtime |
| cross-spawn | ^7.0.6; >=7.0.6 | 7.0.6 | 7.0.6 | current or range/override review | runtime |
| cssnano | 9.0.5 | 9.1.2 | 9.1.2 | upgrade candidate | runtime |
| cypress | ^15.21.1 | 16.1.1 | 16.1.1 | upgrade candidate | tooling |
| debug | ^4.4.3; >=4.4.3 | 4.4.3 | 4.4.3 | current or range/override review | runtime |
| defu | ^6.1.4; >=6.1.7 | 6.1.7 | 6.1.7 | upgrade candidate | runtime |
| destr | ^2.0.5 | 2.0.5 | 2.0.5 | current or range/override review | runtime |
| devcert | ^1.2.3 | 1.2.3 | 1.2.3 | current or range/override review | runtime |
| diff | >=9.0.0 | 9.0.0 | 9.0.0 | current or range/override review | runtime |
| dompurify | >=3.4.15 | 3.4.16 | 3.4.16 | current or range/override review | runtime |
| dotenv | 17.4.2 | 18.0.5 | 18.0.5 | upgrade candidate | runtime |
| dotenv-expand | 13.0.0 | 1000.0.0 | 1000.0.0 | review new command execution before upgrade | runtime |
| drizzle-orm | 1.0.0-rc.4 | 0.45.3 | 0.45.3 | preserve qualified prerelease contract | runtime |
| dts-packer | 0.0.3 | 0.0.3 | 0.0.3 | current or range/override review | runtime |
| effect | 4.0.0-rc.117; npm:@bleedingdev/effect@4.0.0-rc.117 | 4.0.0 | 4.0.0 | upgrade candidate | effect |
| encoding | ^0.1.13 | 0.1.13 | 0.1.13 | current or range/override review | runtime |
| enhanced-resolve | 5.25.1 | 5.26.0 | 5.26.0 | upgrade candidate | runtime |
| entities | ^8.1.0 | 8.1.0 | 8.1.0 | current or range/override review | runtime |
| es-module-lexer | ^2.3.2 | 3.0.2 | 3.0.2 | upgrade candidate | runtime |
| esbuild | ^0.28.2; >=0.28.2 | 0.28.2 | 0.28.2 | current or range/override review | runtime |
| etag | ^1.8.1 | 1.8.1 | 1.8.1 | current or range/override review | runtime |
| execa | 9.6.1 | 10.0.1 | 10.0.1 | upgrade candidate | runtime |
| express | ^5.2.1 | 5.2.1 | 5.2.1 | current or range/override review | runtime |
| farrow-api | ^2.3.1 | 2.3.1 | 2.3.1 | current or range/override review | runtime |
| farrow-pipeline | ^2.3.0 | 2.3.0 | 2.3.0 | current or range/override review | runtime |
| farrow-schema | ^2.3.3 | 2.3.3 | 2.3.3 | current or range/override review | runtime |
| fast-glob | 3.3.3 | 3.3.3 | 3.3.3 | current or range/override review | runtime |
| fast-uri | 3.1.8 | 4.2.1 | 4.2.1 | current or range/override review | runtime |
| filesize | 11.0.24 | 11.0.25 | 11.0.25 | upgrade candidate | runtime |
| find-up | 8.0.0 | 8.0.0 | 8.0.0 | current or range/override review | runtime |
| flatted | ^3.4.4 | 3.4.4 | 3.4.4 | current or range/override review | runtime |
| follow-redirects | >=1.16.0 | 1.16.0 | 1.16.0 | current or range/override review | runtime |
| fs-extra | ^11.4.1; 11.4.1 | 11.4.1 | 11.4.1 | current or range/override review | runtime |
| get-port | 7.2.0 | 7.2.0 | 7.2.0 | current or range/override review | runtime |
| gh-pages | ^6.3.0 | 6.3.0 | 6.3.0 | current or range/override review | runtime |
| glob | 13.0.6 | 13.0.6 | 13.0.6 | current or range/override review | runtime |
| globby | 16.2.4 | 16.2.4 | 16.2.4 | current or range/override review | runtime |
| gzip-size | 7.0.0 | 7.0.0 | 7.0.0 | current or range/override review | runtime |
| h3 | ^1.15.3; >=1.15.11 | 2.0.1-rc.32 | 1.15.11 | keep supported stable 1.x cohort | runtime |
| handlebars | >=4.7.9 | 4.7.9 | 4.7.9 | current or range/override review | runtime |
| happy-dom | ^20.14.5 | 20.14.5 | 20.14.5 | current or range/override review | tooling |
| hono | ^4.13.8 | 4.13.12 | 4.13.12 | upgrade candidate | runtime |
| html-minifier-terser | ^7.2.0 | 7.2.0 | 7.2.0 | current or range/override review | runtime |
| http-compression | 1.1.3 | 1.1.3 | 1.1.3 | current or range/override review | runtime |
| http-proxy-middleware | ^4.2.0 | 4.2.0 | 4.2.0 | current or range/override review | runtime |
| husky | ^9.1.7 | 9.1.7 | 9.1.7 | current or range/override review | tooling |
| i18next | 26.4.2; >=25.7.4 | 26.4.2 | 26.4.2 | current or range/override review | runtime |
| i18next-browser-languagedetector | ^8.2.1 | 8.2.1 | 8.2.1 | current or range/override review | runtime |
| i18next-chained-backend | ^5.0.6 | 5.0.6 | 5.0.6 | current or range/override review | runtime |
| i18next-fs-backend | ^2.6.8 | 2.6.8 | 2.6.8 | current or range/override review | runtime |
| i18next-http-backend | ^4.0.2 | 4.0.2 | 4.0.2 | current or range/override review | runtime |
| i18next-http-middleware | ^3.9.9 | 3.9.9 | 3.9.9 | current or range/override review | runtime |
| image-meta | ^0.2.1 | 0.3.0 | 0.3.0 | upgrade candidate | runtime |
| image-size | ^2.0.3 | 2.0.4 | 2.0.4 | upgrade candidate | runtime |
| import-lazy | 4.0.0 | 4.0.0 | 4.0.0 | current or range/override review | runtime |
| import-meta-resolve | ^4.2.0 | 4.2.0 | 4.2.0 | current or range/override review | runtime |
| inquirer | 14.2.2 | 14.2.2 | 14.2.2 | current or range/override review | runtime |
| invariant | ^2.2.4 | 2.2.4 | 2.2.4 | current or range/override review | runtime |
| ioredis | ^5.11.1 | 6.0.0 | 6.0.0 | upgrade candidate | runtime |
| ioredis-mock | ^8.13.1 | 8.13.1 | 8.13.1 | current or range/override review | runtime |
| ipx | ^3.1.1; >=3.0.3; 3.1.1 | 4.0.0-beta.1 | 3.1.1 | use stable version, exclude prerelease latest | runtime |
| isbot | 5.2.2 | 5.2.2 | 5.2.2 | current or range/override review | runtime |
| jest | ^29.7.0 | 30.5.2 | 30.5.2 | upgrade candidate | tooling |
| jest-environment-jsdom | ^29.7.0 | 30.5.2 | 30.5.2 | upgrade candidate | tooling |
| jiti | ^2.7.0 | 2.7.0 | 2.7.0 | current or range/override review | runtime |
| js-yaml | 5.4.2; 3.15.2; 4.3.2 | 5.4.2 | 5.4.2 | current or range/override review | runtime |
| jsdom | ^25.0.1 | 30.1.1 | 30.1.1 | upgrade candidate | tooling |
| json5 | 2.2.3 | 2.2.3 | 2.2.3 | current or range/override review | runtime |
| kill-port | ^2.0.1 | 2.0.1 | 2.0.1 | current or range/override review | runtime |
| knitwork | ^1.2.0 | 1.3.0 | 1.3.0 | upgrade candidate | runtime |
| koa | ^2.16.4; 3.2.1 | 3.2.1 | 3.2.1 | upgrade candidate | runtime |
| koa-compose | ^4.1.0 | 4.1.0 | 4.1.0 | current or range/override review | runtime |
| lefthook | ^2.1.14 | 2.1.15 | 2.1.15 | upgrade candidate | tooling |
| less | 4.9.1 | 4.9.1 | 4.9.1 | current or range/override review | runtime |
| lint-staged | ~17.5.1 | 17.6.0 | 17.6.0 | upgrade candidate | tooling |
| listhen | ^1.9.0 | 1.10.1 | 1.10.1 | upgrade candidate | runtime |
| lodash | ^4.18.1 | 4.18.1 | 4.18.1 | current or range/override review | runtime |
| lodash-es | ^4.18.1; >=4.18.1 | 4.18.1 | 4.18.1 | current or range/override review | runtime |
| lru-cache | ^11.5.3 | 11.5.3 | 11.5.3 | current or range/override review | runtime |
| memfs | ^4.79.0 | 4.80.0 | 4.80.0 | upgrade candidate | runtime |
| mermaid | ^11.17.2 | 12.0.0 | 12.0.0 | upgrade candidate | runtime |
| micromatch | ^4.0.8 | 4.0.8 | 4.0.8 | current or range/override review | runtime |
| mime-types | ^2.1.35; 3.0.2 | 3.0.2 | 3.0.2 | upgrade candidate | runtime |
| miniflare | 5.20260921.0-alpha | 5.20260930.0-alpha | 5.20260930.0-alpha | follow verified Wrangler cohort | generator |
| minimatch | ^10.2.6 | 10.2.6 | 10.2.6 | current or range/override review | runtime |
| minimist | 1.2.8 | 1.2.8 | 1.2.8 | current or range/override review | runtime |
| mlly | ^1.8.2 | 1.8.2 | 1.8.2 | current or range/override review | runtime |
| nanoid | 5.1.16 | 6.0.1 | 6.0.1 | upgrade candidate | runtime |
| ndepe | ^0.1.13 | 0.1.13 | 0.1.13 | current or range/override review | runtime |
| nock | ^14.0.17 | 14.0.17 | 14.0.17 | current or range/override review | runtime |
| node-fetch | ^3.3.2 | 3.3.2 | 3.3.2 | current or range/override review | runtime |
| node-forge | >=1.4.0 | 1.4.0 | 1.4.0 | current or range/override review | runtime |
| node-mocks-http | ^1.18.1 | 1.18.1 | 1.18.1 | current or range/override review | runtime |
| normalize-path | 3.0.0 | 3.0.0 | 3.0.0 | current or range/override review | runtime |
| nx | ^23.2.1 | 23.2.1 | 23.2.1 | current or range/override review | tooling |
| ofetch | ^1.4.1 | 1.5.1 | 1.5.1 | upgrade candidate | runtime |
| ora | 9.4.1 | 9.4.1 | 9.4.1 | current or range/override review | runtime |
| oxfmt | 0.66.0; 0.70.0 | 0.71.0 | 0.71.0 | upgrade candidate | tooling |
| oxlint | 1.85.0 | 1.86.0 | 1.86.0 | upgrade candidate | tooling |
| p-map | 7.0.8 | 7.0.8 | 7.0.8 | current or range/override review | runtime |
| path-serializer | 0.7.0 | 0.7.0 | 0.7.0 | current or range/override review | runtime |
| path-to-regexp | ^8.4.2 | 8.4.2 | 8.4.2 | current or range/override review | runtime |
| pathe | ^2.0.3 | 2.0.3 | 2.0.3 | current or range/override review | runtime |
| picomatch | 2.3.2; 4.0.7 | 4.0.7 | 4.0.7 | current or range/override review | runtime |
| pkg-types | ^2.3.3 | 2.3.3 | 2.3.3 | current or range/override review | runtime |
| pkg-up | 3.1.0 | 5.0.0 | 5.0.0 | replace or remove deprecated package | runtime |
| playwright | ^1.63.0 | 1.63.0 | 1.63.0 | current or range/override review | runtime |
| plugin-a | * | none | none | fixture contract | runtime |
| pnpm | 11.27.1 | 12.8.1 | 12.8.1 | upgrade candidate | tooling |
| postcss | ^8.5.28 | 8.5.28 | 8.5.28 | current or range/override review | runtime |
| postcss-custom-properties | 15.0.1 | 15.0.3 | 15.0.3 | upgrade candidate | runtime |
| postcss-flexbugs-fixes | 5.0.2 | 5.0.2 | 5.0.2 | current or range/override review | runtime |
| postcss-font-variant | 5.0.0 | 5.0.0 | 5.0.0 | current or range/override review | runtime |
| postcss-initial | 4.0.1 | 3.0.4 | 3.0.4 | review older latest tag, never auto-downgrade | runtime |
| postcss-media-minmax | 5.0.0 | 5.0.0 | 5.0.0 | current or range/override review | runtime |
| postcss-nesting | 14.0.1 | 14.0.2 | 14.0.2 | upgrade candidate | runtime |
| postcss-page-break | 3.0.4 | 3.0.4 | 3.0.4 | current or range/override review | runtime |
| postcss-value-parser | 4.2.0 | 4.2.0 | 4.2.0 | current or range/override review | runtime |
| prettier | ~3.9.9; ~2.8.8 | 3.9.9 | 3.9.9 | upgrade candidate | tooling |
| puppeteer | ^25.11.0 | 25.12.0 | 25.12.0 | upgrade candidate | runtime |
| qs | ^6.16.0; >=6.16.0 | 6.16.0 | 6.16.0 | current or range/override review | runtime |
| react | ^19.3.0; ^19.2.8; >=16.9.0; ^18.3.1; 19.3.0 | 19.3.0 | 19.3.0 | current or range/override review | runtime |
| react-dom | ^19.3.0; ^19.2.8; >=16.9.0; 19.3.0 | 19.3.0 | 19.3.0 | current or range/override review | runtime |
| react-helmet | ^6.1.0 | 6.1.0 | 6.1.0 | current or range/override review | runtime |
| react-helmet-async | 3.0.0 | 3.0.0 | 3.0.0 | current or range/override review | runtime |
| react-i18next | 17.0.15; >=15.7.4 | 17.0.15 | 17.0.15 | current or range/override review | runtime |
| react-is | ^19.3.0 | 19.3.0 | 19.3.0 | current or range/override review | runtime |
| react-router | ^7.18.4; 7.18.4; 8.4.0; 7.18.2; 8.3.1 | 8.4.0 | 8.4.0 | upgrade candidate | runtime |
| react-router-dom | ^7.18.4; 7.18.4 | 7.18.4 | 7.18.4 | current or range/override review | runtime |
| react-server-dom-rspack | 0.1.0 | 0.1.0 | 0.1.0 | current or range/override review | runtime |
| recursive-readdir | ^2.2.3 | 2.2.3 | 2.2.3 | current or range/override review | runtime |
| reflect-metadata | ^0.2.2 | 0.2.2 | 0.2.2 | current or range/override review | runtime |
| resolve.exports | 2.0.3 | 2.0.3 | 2.0.3 | current or range/override review | runtime |
| rimraf | ^6.1.3; ~3.0.2 | 6.1.3 | 6.1.3 | upgrade candidate | runtime |
| rollup | ^4.63.4 | 4.63.6 | 4.63.6 | upgrade candidate | runtime |
| rsbuild-plugin-open-graph | 1.1.3 | 1.1.3 | 1.1.3 | current or range/override review | build |
| rsbuild-plugin-rsc | 0.1.1 | 0.1.1 | 0.1.1 | current or range/override review | build |
| rslog | ^1.1.0; ^2.3.0 | 2.3.0 | 2.3.0 | upgrade candidate | runtime |
| rspack-manifest-plugin | 5.2.2 | 5.2.2 | 5.2.2 | current or range/override review | runtime |
| rxjs | 7.8.2 | 7.8.2 | 7.8.2 | current or range/override review | runtime |
| sass | 1.105.0 | 1.105.1 | 1.105.1 | upgrade candidate | runtime |
| sass-embedded | 1.105.0 | 1.105.1 | 1.105.1 | upgrade candidate | runtime |
| semver | 7.8.5 | 7.8.5 | 7.8.5 | current or range/override review | runtime |
| serialize-javascript | >=7.1.1 | 7.1.2 | 7.1.2 | current or range/override review | runtime |
| serve-static | ^2.2.1 | 2.2.1 | 2.2.1 | current or range/override review | runtime |
| server-only | ^0.0.1 | 0.0.1 | 0.0.1 | current or range/override review | runtime |
| sharp | ^0.35.4; >=0.35.4 | 0.35.5 | 0.35.5 | upgrade candidate | runtime |
| signal-exit | 4.1.0 | 4.1.0 | 4.1.0 | current or range/override review | runtime |
| signale | 1.4.0 | 1.4.0 | 1.4.0 | current or range/override review | runtime |
| slash | 5.1.0 | 5.1.0 | 5.1.0 | current or range/override review | runtime |
| smol-toml | >=1.9.0 | 1.9.0 | 1.9.0 | current or range/override review | runtime |
| socket.io-parser | 4.2.7 | 4.2.7 | 4.2.7 | current or range/override review | runtime |
| source-map | 0.7.6 | 0.8.0 | 0.8.0 | upgrade candidate | runtime |
| std-env | 4.2.0 | 4.3.0 | 4.3.0 | upgrade candidate | runtime |
| storybook | ^10.6.0 | 10.6.1 | 10.6.1 | upgrade candidate | build |
| storybook-addon-modernjs | 3.6.0 | 3.6.0 | 3.6.0 | current or range/override review | build |
| storybook-react-rsbuild | 3.6.0 | 3.6.0 | 3.6.0 | current or range/override review | build |
| strip-ansi | 7.2.0 | 7.2.0 | 7.2.0 | current or range/override review | runtime |
| styled-components | ^6.5.3 | 6.5.3 | 6.5.3 | current or range/override review | runtime |
| supertest | ^7.3.0 | 7.3.0 | 7.3.0 | current or range/override review | runtime |
| svgo | ^4.0.0; 3.3.5; 4.1.0 | 4.1.0 | 4.1.0 | upgrade candidate | runtime |
| tailwindcss | ^4.3.3; ^2.2.19; ^3.4.19; 4.3.3 | 4.3.3 | 4.3.3 | current or range/override review | runtime |
| tar | >=7.5.22 | 7.5.22 | 7.5.22 | current or range/override review | runtime |
| terser | ^5.51.2 | 5.51.2 | 5.51.2 | current or range/override review | runtime |
| test-a | * | 1.0.0 | 1.0.0 | local or fixture identity | runtime |
| test-b | * | 1.0.0 | 1.0.0 | fixture contract | runtime |
| tmp | >=0.2.7 | 0.2.7 | 0.2.7 | local or fixture identity | runtime |
| tree-kill | ^1.2.2 | 1.2.2 | 1.2.2 | current or range/override review | runtime |
| ts-deepmerge | 8.0.0 | 8.0.0 | 8.0.0 | current or range/override review | runtime |
| ts-node | ~10.9.2; ^10.9.2 | 10.9.2 | 10.9.2 | current or range/override review | runtime |
| tsconfig-paths | ~3.15.0; 3.15.0; ^4.2.0; 4.2.0; >=4.2.0 | 4.2.0 | 4.2.0 | upgrade candidate | runtime |
| tsm | 2.3.0 | 2.3.0 | 2.3.0 | current or range/override review | runtime |
| tsx | ^4.23.15 | 4.23.15 | 4.23.15 | current or range/override review | runtime |
| twin.macro | ^3.4.1 | 3.4.1 | 3.4.1 | fixture contract | runtime |
| type-fest | 5.10.0; ^4.37.0 | 5.10.0 | 5.10.0 | upgrade candidate | runtime |
| type-is | ^2.1.0 | 3.0.0 | 3.0.0 | upgrade candidate | runtime |
| typescript | ^7.0.2; ~5.7.3; ~5.0.4; 7.0.2; ^5 | 7.0.2 | 7.0.2 | upgrade candidate | tooling |
| ua-parser-js | ^2.0.10 | 2.0.10 | 2.0.10 | current or range/override review | runtime |
| ufo | ^1.6.1; ^1.3.0 | 1.6.4 | 1.6.4 | upgrade candidate | runtime |
| ultracite | 7.12.0 | 7.12.2 | 7.12.2 | upgrade candidate | tooling |
| unstorage | ^1.16.1 | 1.17.5 | 1.17.5 | upgrade candidate | runtime |
| upath | 3.0.8 | 3.0.8 | 3.0.8 | current or range/override review | runtime |
| url-join | 5.0.0 | 5.0.0 | 5.0.0 | current or range/override review | runtime |
| uuid | 14.0.2 | 14.0.2 | 14.0.2 | current or range/override review | runtime |
| vite | ^8.3.0 | 8.3.2 | 8.3.2 | upgrade candidate | runtime |
| vitest | ^4.1.11 | 5.0.3 | 5.0.3 | upgrade candidate | tooling |
| vue | ^3.5.43 | 3.5.43 | 3.5.43 | current or range/override review | runtime |
| websocket | ^1.0.35 | 1.0.35 | 1.0.35 | current or range/override review | runtime |
| workerd | 1.20260921.1 | 1.20261001.1 | 1.20261001.1 | upgrade candidate | generator |
| wrangler | 4.137.0 | 4.145.0 | 4.145.0 | upgrade candidate | generator |
| ws | ^8.21.3; >=8.21.3 | 8.22.0 | 8.22.0 | upgrade candidate | runtime |
| xss | ^1.0.15 | 1.0.15 | 1.0.15 | current or range/override review | runtime |
| yaml | 2.9.1; >=2.9.1 | 2.9.1 | 2.9.1 | current or range/override review | runtime |
| zephyr-agent | 1.4.0 | 1.4.2 | 1.4.2 | upgrade candidate | build |
| zephyr-modernjs-plugin | 1.4.0 | 1.4.2 | 1.4.2 | upgrade candidate | build |
| zephyr-rspack-plugin | 1.4.0 | 1.4.2 | 1.4.2 | upgrade candidate | build |
| zod | ^4.4.3; ^4.6.5; ^4.5.4; 4.6.5 | 4.6.5 | 4.6.5 | upgrade candidate | runtime |
