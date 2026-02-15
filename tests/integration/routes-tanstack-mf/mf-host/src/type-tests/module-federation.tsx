import * as React from 'react';
import { lazyRemoteComponent } from '../routes/mf/remoteLoader';

export function ModuleFederationTypeTests() {
  const Widget = lazyRemoteComponent('remote/Widget');
  const Mutator = lazyRemoteComponent('remote/Mutator');
  const Panel = lazyRemoteComponent('remote2/Panel');

  // @ts-expect-error unknown remote key should fail type-check
  const UnknownRemote = lazyRemoteComponent('remote/Unknown');

  // @ts-expect-error remote/Widget only exposes default export
  // biome-ignore format: keep this on one line so @ts-expect-error applies.
  const WrongExport = lazyRemoteComponent('remote/Widget', { exportName: 'Widget' });

  return (
    <>
      <Widget />
      <Mutator />
      <Panel />
      <UnknownRemote />
      <WrongExport />
    </>
  );
}
