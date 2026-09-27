// @effect-diagnostics strictBooleanExpressions:off
'use client';
import { RuntimeComponentResolverContext } from '@modern-js/runtime/context';
import React from 'react';
import {
  Helmet as AsyncHelmet,
  HelmetData as AsyncHelmetData,
  type HelmetDatum,
  type HelmetHTMLBodyDatum,
  type HelmetHTMLElementDatum,
  type HelmetProps,
  HelmetProvider,
  type HelmetServerState,
  type HelmetTags,
} from 'react-helmet-async';

export const Helmet = (props: React.PropsWithChildren<HelmetProps>) => {
  const resolveComponent = React.useContext(RuntimeComponentResolverContext);
  const Component =
    resolveComponent?.(AsyncHelmet, { name: 'head.Helmet' }) ?? AsyncHelmet;
  if (Component === Helmet) {
    throw new Error(
      'A component resolver cannot resolve head.Helmet to itself.',
    );
  }
  return React.createElement(Component, props);
};

const head = {
  Helmet,
  HelmetData: AsyncHelmetData,
  HelmetProvider,
};

export default head;

export type {
  HelmetDatum,
  HelmetHTMLBodyDatum,
  HelmetHTMLElementDatum,
  HelmetProps,
  HelmetServerState,
  HelmetTags,
};
