// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off
import type { AnyRouter } from '@tanstack/react-router';
import type {
  RouterManagedTag,
  RouterMatchWithError,
  TanstackRouterWithServerSsr,
} from './ssrTypes';

export async function waitForRouterSerialization(
  tanstackRouter: TanstackRouterWithServerSsr,
) {
  const serverSsr = tanstackRouter.serverSsr;
  if (
    !serverSsr ||
    typeof serverSsr.onSerializationFinished !== 'function' ||
    serverSsr.isSerializationFinished?.()
  ) {
    return;
  }

  await new Promise<void>(resolve => {
    serverSsr.onSerializationFinished?.(resolve);
  });
}

function htmlEscapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function routerManagedTagToHtml(tag: unknown): string {
  if (!tag || typeof tag !== 'object') {
    return '';
  }

  const managedTag = tag as RouterManagedTag;
  if (!managedTag || managedTag.tag !== 'script') {
    return '';
  }

  const attrs: Record<string, unknown> = managedTag.attrs || {};
  const attrsStr = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => {
      const name = k === 'className' ? 'class' : k;
      if (v === true) {
        return name;
      }
      return `${name}="${htmlEscapeAttr(String(v))}"`;
    })
    .join(' ');

  const open = attrsStr.length ? `<script ${attrsStr}>` : '<script>';
  const children =
    typeof managedTag.children === 'string' ? managedTag.children : '';
  return `${open}${children}</script>`;
}

export function routerManagedTagsToHtml(tags: unknown): string[] {
  const normalizedTags = Array.isArray(tags) ? tags : [tags];
  return normalizedTags.map(routerManagedTagToHtml).filter(Boolean);
}

export function createGetSsrHref(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function collectRouterErrors(
  tanstackRouter: AnyRouter,
): Record<string, unknown> | undefined {
  const state = tanstackRouter.state as { matches?: unknown };
  const matches = Array.isArray(state.matches)
    ? (state.matches as RouterMatchWithError[])
    : [];
  const errors = matches.reduce((acc: Record<string, unknown>, match) => {
    if (!match.error) {
      return acc;
    }

    const routeId =
      typeof match.routeId === 'string'
        ? match.routeId
        : typeof match.route?.id === 'string'
          ? match.route.id
          : `match-${Object.keys(acc).length}`;

    acc[routeId] = match.error;
    return acc;
  }, {});

  return Object.keys(errors).length > 0 ? errors : undefined;
}

export async function attachServerSsrUtils(
  router: TanstackRouterWithServerSsr,
) {
  const { attachRouterServerSsrUtils } = await import(
    '@tanstack/router-core/ssr/server'
  );

  attachRouterServerSsrUtils({
    router,
    manifest: undefined,
  });
}
