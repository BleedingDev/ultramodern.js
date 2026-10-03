import type { JSX } from '@solidjs/web';
import { HydrationScript, useHead } from '@solidjs/web';
import type { AssetCrossOriginConfig } from '@tanstack/router-core';
import { toHeadTags, useTags } from './headContentUtils';

export interface HeadContentProps {
  assetCrossOrigin?: AssetCrossOriginConfig;
}

/**
 * @description The `HeadContent` component registers the current route's meta
 * tags, links, and scripts with Solid's head registry, which owns emission
 * into `<head>` (SSR splicing/streaming and client-side patching alike). It
 * can be rendered anywhere in the tree, though placing it inside the `<head>`
 * of your document keeps the hydration script in the right place.
 */
export function HeadContent(props: HeadContentProps): JSX.Element {
  const tags = useTags(props.assetCrossOrigin);

  useHead(() => toHeadTags(tags()));

  return <HydrationScript />;
}
