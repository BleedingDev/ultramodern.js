'use client';

import { use } from 'react';

type ModernRscClientRuntime = typeof import('@modern-js/runtime/rsc/client');
type ServerRscClientRuntime =
  typeof import('react-server-dom-rspack/client.edge');

let modernRscClientRuntimePromise: Promise<ModernRscClientRuntime> | undefined;

function loadModernRscClientRuntime() {
  modernRscClientRuntimePromise ??= import(
    '@modern-js/runtime/rsc/client'
  ).then(runtime => {
    runtime.setServerCallback(runtime.callServer);
    return runtime;
  });
  return modernRscClientRuntimePromise;
}

function createFromFlightStream(stream: ReadableStream<Uint8Array>) {
  if (typeof window === 'undefined') {
    return import('react-server-dom-rspack/client.edge').then(
      (runtime: ServerRscClientRuntime) =>
        runtime.createFromReadableStream(stream),
    );
  }

  return loadModernRscClientRuntime().then(runtime =>
    runtime.createFromReadableStream(stream, {
      callServer: runtime.callServer,
    }),
  );
}

export function createTreeGetterFromFlightStream(
  stream: ReadableStream<Uint8Array>,
) {
  let ready = false;
  let tree: unknown;
  const treePromise = createFromFlightStream(stream).then(value => {
    tree = value;
    ready = true;
    return value;
  });

  return () => {
    if (ready) {
      return tree;
    }
    return use(treePromise);
  };
}
