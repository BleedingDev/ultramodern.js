import { Link } from '@modern-js/plugin-i18n/runtime';

declare module '@modern-js/plugin-i18n/runtime' {
  interface UltramodernCanonicalRoutes {
    '/': Record<string, never>;
    '/talks': Record<string, never>;
    '/talks/$slug': { slug: string };
  }
}

// --- valid uses ---

// Known route with required params: must compile.
const _a = <Link to="/talks/$slug" params={{ slug: 'x' }} />;

// Known route without params: must compile.
const _b = <Link to="/talks" />;

// Root route: must compile.
const _c = <Link to="/" />;

// Canonical path with hash suffix: must compile.
const _d = <Link to="/#work-with-me" />;

// Canonical path with query and hash: must compile.
const _e = <Link to="/talks?tag=x#abstract" />;

// Bare hash: must compile.
const _f = <Link to="#hash" />;

// External HTTPS URL: must compile.
const _g = <Link to="https://example.com" />;

// Dynamic (computed) value — escape hatch: must compile.
declare function compute(): string;
const dynamic: string = compute();
const _h = <Link to={dynamic} />;

// --- invalid uses (each preceded by @ts-expect-error) ---

// Unknown route.
// @ts-expect-error
const _i = <Link to="/talkz" />;

// Known param route but params prop is missing.
// @ts-expect-error
const _j = <Link to="/talks/$slug" />;

// Known route without params but params are provided (forbidden).
// @ts-expect-error
const _k = <Link to="/talks" params={{ slug: 'x' }} />;
