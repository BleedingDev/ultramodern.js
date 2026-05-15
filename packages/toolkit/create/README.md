<p align="center">
  <a href="https://modernjs.dev" target="blank"><img src="https://lf3-static.bytednsdoc.com/obj/eden-cn/ylaelkeh7nuhfnuhf/modernjs-cover.png" width="300" alt="Modern.js Logo" /></a>
</p>

<h1 align="center">Modern.js</h1>

<p align="center">
  A Progressive React Framework for modern web development.
</p>

## Getting Started

Please follow [Quick Start](https://modernjs.dev/en/guides/get-started/quick-start) to get started with Modern.js.

### Router Template

You can scaffold a TanStack Router first template:

```bash
npx @modern-js/create my-app --router tanstack
```

### Tailwind Template

You can scaffold Tailwind CSS v4 setup (PostCSS + starter utility classes):

```bash
npx @modern-js/create my-app --tailwind
```

You can combine both options:

```bash
npx @modern-js/create my-app --router tanstack --tailwind
```

### BFF Runtime Template

You can scaffold BFF APIs with the current default runtime:

```bash
npx @modern-js/create my-app --bff
```

You can explicitly scaffold Effect HttpApi runtime for BFF:

```bash
npx @modern-js/create my-app --bff-runtime effect
```

To scaffold Hono runtime explicitly:

```bash
npx @modern-js/create my-app --bff-runtime hono
```

Generated starters expose `presetUltramodern(...)` as the public opinionated
config wrapper when you want the full Ultramodern setup surface in
`modern.config.ts`.

You can combine TanStack Router + Tailwind + Effect BFF in one command:

```bash
npx @modern-js/create my-app --router tanstack --tailwind --bff-runtime effect
```

### Micro Vertical Workspace Recipes

Use the existing create flags to scaffold packages inside a Micro Vertical
workspace. The shell and remotes use TanStack Router; services use Effect by
default, with Hono kept as an explicit compatibility lane.

```bash
npx @modern-js/create apps/shell --router tanstack --tailwind --workspace --sub
npx @modern-js/create apps/remotes/catalog --router tanstack --tailwind --workspace --sub
npx @modern-js/create apps/remotes/design-system --router tanstack --tailwind --workspace --sub
npx @modern-js/create services/catalog-api --bff-runtime effect --workspace --sub
npx @modern-js/create services/legacy-api --bff-runtime hono --workspace --sub
```

When a design system needs independent deployment, treat it as a horizontal
Module Federation remote with the same topology, trust, SSR, compatibility, and
fallback expectations as feature remotes. Otherwise shared packages should be
regular workspace packages for tokens, primitives, generated clients, or
domain-neutral utilities. Keep feature composites and workflow logic owned by a
shell, remote, or service package.

See
`docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`
for the canonical workspace topology and local orchestration model.

### Local Monorepo Testing

When testing unreleased Modern.js packages from a local monorepo checkout, use
workspace protocol dependencies:

```bash
npx @modern-js/create my-app --router tanstack --bff-runtime effect --workspace
```

## Documentation

- [English Documentation](https://modernjs.dev/en/)
- [中文文档](https://modernjs.dev)

## Contributing

Please read the [Contributing Guide](https://github.com/web-infra-dev/modern.js/blob/main/CONTRIBUTING.md).

## License

Modern.js is [MIT licensed](https://github.com/web-infra-dev/modern.js/blob/main/LICENSE).
