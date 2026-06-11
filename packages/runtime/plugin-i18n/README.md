<p align="center">
  <a href="https://modernjs.dev" target="blank"><img src="https://lf3-static.bytednsdoc.com/obj/eden-cn/ylaelkeh7nuhfnuhf/modernjs-cover.png" width="300" alt="Modern.js Logo" /></a>
</p>

<h1 align="center">@modern-js/plugin-i18n</h1>

<p align="center">
  Internationalization plugin for Modern.js, providing multi-language support with locale-aware routing and navigation.
</p>

## Features

- **Locale detection**: Supports detection from URL path, Cookie, LocalStorage, request headers, browser settings, and other sources.
- **Resource loading**: Supports HTTP static files, file system loading for SSR, custom SDK functions, and chained backend progressive loading.
- **Routing integration**: Automatically adds locale path prefixes and provides the `Link` component for language-agnostic navigation.
- **SSR support**: Detects the language on the server and injects it into the page to avoid language flicker.
- **TypeScript support**: Provides complete type definitions and type-safe route navigation.

## Getting Started

For full documentation, see the [Modern.js Internationalization Guide](https://modernjs.dev/en/guides/advanced-features/international/).

## Link Component

The `Link` component is the standard way to create navigation links in i18n-enabled applications. It automatically localizes language-agnostic canonical paths and provides type-safe navigation with params validation.

### Basic Usage

```tsx
import { Link } from '@modern-js/plugin-i18n/runtime';

function Navigation() {
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/about">About</Link>
      <Link to="/talks/$slug" params={{ slug: 'my-talk' }} />
      <Link to="/#work-with-me" />
    </nav>
  );
}
```

### Key Features

**Canonical path localization**: `to` accepts language-agnostic canonical paths. The Link automatically adds the locale prefix and applies `localisedUrls` slug mappings:

```tsx
// When current language is 'cs' and localisedUrls maps '/platform' to '/platforma':
<Link to="/platform" />
// renders as: <a href="/cs/platforma">...</a>
```

**Hash and query preservation**: Hash fragments and query strings in `to` are preserved during localization:

```tsx
<Link to="/#work-with-me" />  // Cross-page anchor → /cs#work-with-me
<Link to="/talks?sort=date" /> // Search params preserved
```

**Typed routes and params**: When used with TanStack Router codegen, `to` accepts typed canonical route paths with validated params:

```tsx
// Route /talks/$slug exists → TypeScript validates this:
<Link to="/talks/$slug" params={{ slug: 'my-talk' }} />

// TypeScript error: route does not exist
<Link to="/talkz" />

// TypeScript error: missing required param
<Link to="/talks/$slug" />
```

**Language-invariant active state**: The link is marked active when the location matches any localized variant of the canonical route:

```tsx
// Matches /en/talks/my-talk, /cs/prednaska/muj-pohovor, etc.
<Link to="/talks/$slug" params={{ slug: 'my-talk' }} activeProps={{ className: 'active' }} />
```

**Active state props and classes**:

```tsx
<Link
  to="/about"
  activeProps={{ className: 'active-link' }}
  activeOptions={{ exact: false }} // Nested routes also match
/>
// When active, renders: <a href="..." className="active-link" data-status="active" aria-current="page">
```

**External URLs and bare anchors render as plain `<a>` tags**:

```tsx
<Link to="https://example.com" /> // → <a href="https://example.com">
<Link to="#contact" />           // → <a href="#contact">
```

### Props

- `to` (string): Canonical (language-agnostic) target path, optionally with `#hash` and `?query` suffixes.
- `params` (object, optional): Route param values for dynamic segments (e.g., `$slug`).
- `hash` (string, optional): Hash fragment (overrides any `#hash` in `to`).
- `search` (string | object, optional): Query string or object (overrides any `?query` in `to`).
- `hashScrollIntoView` (boolean | ScrollIntoViewOptions, optional): TanStack Router scroll behavior.
- `activeProps` (object, optional): Props applied when the link is active.
- `activeOptions` (object, optional): `{ exact?: boolean }` for active state matching.
- All standard `<a>` HTML attributes (className, style, onClick, etc.).

## Localization Utilities

### `localizePath(pathname, language, config)`

Localize a canonical pathname for a given language, applying language prefix and `localisedUrls` mapping:

```tsx
import { localizePath } from '@modern-js/plugin-i18n/runtime';

localizePath('/about', 'cs', {
  languages: ['en', 'cs'],
  localisedUrls: { '/about': { en: '/about', cs: '/o-nas' } }
})
// → '/cs/o-nas'
```

### `canonicalPath(target, config)`

Reverse of `localizePath`: strip language prefix and reverse `localisedUrls` mapping:

```tsx
import { canonicalPath } from '@modern-js/plugin-i18n/runtime';

canonicalPath('/cs/o-nas', {
  languages: ['en', 'cs'],
  localisedUrls: { '/about': { en: '/about', cs: '/o-nas' } }
})
// → '/about'
```

### `useLocalizedPaths()`

Hook for context-bound `localizePath` and `canonicalPath` (reads plugin config automatically):

```tsx
import { useLocalizedPaths } from '@modern-js/plugin-i18n/runtime';

function MyComponent() {
  const { localizePath, canonicalPath } = useLocalizedPaths();
  
  const localized = localizePath('/about', 'cs');
  const canonical = canonicalPath('/cs/o-nas');
}
```

### `useLocalizedLocation()`

Hook for hreflang tags and language switchers. Returns the current location's canonical path and per-language hrefs:

```tsx
import { useLocalizedLocation } from '@modern-js/plugin-i18n/runtime';

function HrefLang() {
  const { language, canonical, alternates } = useLocalizedLocation();
  
  return (
    <>
      <link rel="canonical" href={alternates['en']} />
      {Object.entries(alternates).map(([lang, href]) => (
        <link key={lang} rel="alternate" hrefLang={lang} href={href} />
      ))}
    </>
  );
}

function LanguageSwitcher() {
  const { alternates } = useLocalizedLocation();
  
  return (
    <select onChange={(e) => window.location.href = alternates[e.target.value]}>
      {Object.entries(alternates).map(([lang, href]) => (
        <option key={lang} value={lang}>{lang}</option>
      ))}
    </select>
  );
}
```

## Migration from Deprecated I18nLink

The deprecated `I18nLink` component is now an alias for `Link`. Update your code:

| Old Pattern | New Pattern | Notes |
|-------------|-------------|-------|
| `import { I18nLink }` | `import { Link }` | Drop the `I18n` prefix. |
| `<I18nLink to="/">` | `<Link to="/">` | Identical props and behavior. |
| Hand-rolled `localizePath` helper | `useLocalizedPaths()` hook | Reads config from context automatically. |
| Hand-rolled `matchPattern` for active state | `Link` with `activeProps`/`activeOptions` | Language-invariant matching. |
| Manual hreflang blocks | `useLocalizedLocation()` hook | Generates per-language hrefs automatically. |

**I18nLink deprecation notice:** `I18nLink` is deprecated and will be removed in a future version. A one-time development console warning is logged when used.

```tsx
// ❌ Old
import { I18nLink } from '@modern-js/plugin-i18n/runtime';
<I18nLink to="/about">About</I18nLink>

// ✅ New
import { Link } from '@modern-js/plugin-i18n/runtime';
<Link to="/about">About</Link>
```

## Exported Types

For TypeScript projects, the following types are exported from `@modern-js/plugin-i18n/runtime`:

- `LinkProps<TTo>`: Props type for the `Link` component with typed `to` and `params`.
- `LinkBaseProps`: Base props shared across router frameworks.
- `LinkParams`: Record of route param values.
- `LinkActiveOptions`: Active state matching options.
- `UltramodernCanonicalRoutes`: Canonical route map (emitted by TanStack Router codegen).
- `CanonicalRoutePath`: Typed canonical route path.
- `AllowedLinkTarget`: Union of all valid canonical routes (when codegen is active).

## Exported Utilities

- `buildLocalizedUrl(pathname, language, languages, localisedUrls)`: Localize a pathname (used internally by `Link`).
- `splitUrlTarget(urlString)`: Parse a URL into pathname, search, and hash.

## Documentation

For complete documentation, including locale detection, resource loading, SSR, and custom route configuration, see:

- [English Documentation](https://modernjs.dev/en/guides/advanced-features/international/)
- [中文文档](https://modernjs.dev/guides/advanced-features/international/)

## Contributing

Please read the [Contributing Guide](https://github.com/web-infra-dev/modern.js/blob/main/CONTRIBUTING.md).

## License

Modern.js is [MIT licensed](https://github.com/web-infra-dev/modern.js/blob/main/LICENSE).
