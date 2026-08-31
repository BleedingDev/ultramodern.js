// @effect-diagnostics strictBooleanExpressions:off
'use client';
import * as runtimeHead from '@modern-js/runtime-extensions';
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
import { InternalRuntimeContext } from '../core/context';
import { ensureHelmetContext } from '../core/context/helmetContext';

const collectServerHelmet = (
  runtimeContext: object,
  props: React.PropsWithChildren<HelmetProps>,
) => {
  const helmetContext = ensureHelmetContext(runtimeContext);
  const createRecord = () => runtimeHead.createHelmetRecord(React, props);
  const deriveState = (records: runtimeHead.HelmetCompatRecord[]) =>
    runtimeHead.deriveHelmetServerState(React, records) as HelmetServerState;
  const marker = runtimeHead.collectHeadState(
    runtimeContext,
    createRecord,
    deriveState,
    helmetContext,
  );
  if (marker !== undefined) return marker;
  helmetContext.helmet = runtimeHead.collectImmediateHelmetState(
    React,
    helmetContext,
    createRecord(),
  ) as HelmetServerState;
};

export const Helmet = (props: React.PropsWithChildren<HelmetProps>) => {
  const runtimeContext = React.useContext(InternalRuntimeContext);
  if (runtimeContext !== null && runtimeContext.isBrowser === false) {
    return runtimeHead.renderHeadMarker(
      React,
      collectServerHelmet(runtimeContext, props),
    );
  }
  return React.createElement(AsyncHelmet, props);
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
