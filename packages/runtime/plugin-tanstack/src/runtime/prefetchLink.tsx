import {
  type AnyRouter,
  type LinkComponentProps,
  type RegisteredRouter,
  useLinkProps,
} from '@tanstack/react-router';
import type { AnchorHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

export type PrefetchBehavior = 'intent' | 'render' | 'viewport' | 'none';

function resolvePreloadFromPrefetch(
  prefetch: PrefetchBehavior | undefined,
  preload: unknown,
) {
  if (typeof preload !== 'undefined') {
    return preload;
  }

  if (prefetch === 'none') {
    return false;
  }

  if (
    prefetch === 'intent' ||
    prefetch === 'render' ||
    prefetch === 'viewport'
  ) {
    return prefetch;
  }

  return 'viewport';
}

export type LinkProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = '.',
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = '.',
> = LinkComponentProps<'a', TRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
  prefetch?: PrefetchBehavior;
};

export type NavLinkProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = '.',
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = '.',
> = LinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

type LinkComponent = <
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = '',
>(
  props: LinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
) => ReactElement;

type LinkComponentImplProps = LinkProps<
  AnyRouter,
  string,
  string | undefined,
  string,
  string
> & { ref?: Ref<HTMLAnchorElement> };

const LinkComponentImpl = (props: LinkComponentImplProps) => {
  const {
    prefetch,
    preload,
    'aria-current': ariaCurrentProp,
    ref,
    children,
    ...rest
  } = props as LinkComponentImplProps & {
    children?:
      | ReactNode
      | ((state: { isActive: boolean; isTransitioning: boolean }) => ReactNode);
  };
  const hasAriaCurrentOverride = 'aria-current' in props;

  // Children are rendered by us, not by useLinkProps() — the hook filters
  // unknown/function props out of its return value, so anything routed
  // through it would be silently dropped.
  const linkOptions = {
    ...rest,
    preload: resolvePreloadFromPrefetch(
      prefetch,
      preload,
    ) as LinkComponentImplProps['preload'],
  } as LinkComponentImplProps;

  // TanStack Router's useLinkProps() unconditionally spreads
  // STATIC_ACTIVE_PROPS = { "data-status": "active", "aria-current": "page" }
  // as the LAST entry of the props object it returns for an active link
  // (@tanstack/react-router dist/esm/link.js:369 `...isActive &&
  // STATIC_ACTIVE_PROPS`, defined at line 379-382, spread after
  // `...propsSafeToSpread`, `...resolvedActiveProps`, and
  // `...resolvedInactiveProps`). That means any caller-supplied aria-current
  // -- whether passed directly or via activeProps -- is always clobbered by
  // the time <Link>/createLink render the anchor; there is no props-merge
  // order that lets a caller win from inside <Link>. So instead of
  // delegating rendering to <Link>, we call useLinkProps() ourselves and
  // re-apply the caller's original aria-current (including `false`, meaning
  // "suppress the attribute entirely") as the final word on the anchor we
  // render.
  const linkProps = useLinkProps(
    linkOptions as Parameters<typeof useLinkProps>[0],
    ref as Parameters<typeof useLinkProps>[1],
  ) as AnchorHTMLAttributes<HTMLAnchorElement> & {
    disabled?: boolean;
    type?: string;
  };

  // TanStack's own Link strips `type` and `disabled` before rendering the
  // anchor (link.js:449-452) — mirror that.
  const { disabled: _disabled, type: _type, ...anchorProps } = linkProps;

  if (hasAriaCurrentOverride) {
    if (ariaCurrentProp === false || typeof ariaCurrentProp === 'undefined') {
      delete anchorProps['aria-current'];
    } else {
      anchorProps['aria-current'] = ariaCurrentProp;
    }
  }

  // TanStack's Link resolves render-prop children with the active state
  // (link.js:450) — without this, function children reach React as an
  // invalid child and crash the render.
  const resolvedChildren =
    typeof children === 'function'
      ? children({
          isActive:
            (anchorProps as Record<string, unknown>)['data-status'] ===
            'active',
          isTransitioning:
            (anchorProps as Record<string, unknown>)['data-transitioning'] ===
            'transitioning',
        })
      : children;

  return <a {...anchorProps}>{resolvedChildren}</a>;
};

export const Link = LinkComponentImpl as LinkComponent;

export const NavLink = LinkComponentImpl as LinkComponent;
