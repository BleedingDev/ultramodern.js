import hostEffectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import * as React from 'react';
import { lazyRemoteComponent, RemoteErrorBoundary } from './remoteLoader';
import { RemoteOneRuntimeApp, RemoteTwoRuntimeApp } from './remoteRuntimeApps';
import {
  REMOTE_SSR_FALLBACK_CONTRACT,
  REMOTE_SSR_FALLBACK_METADATA,
  serializeRemoteSsrFallbackMetadata,
} from './remoteSsrFallback';
import './page.css';

const RemoteWidget = lazyRemoteComponent('remote/Widget');
const RemoteMutator = lazyRemoteComponent('remote/Mutator');
const RemotePanel = lazyRemoteComponent('remote2/Panel');

export default function MfPage() {
  const match = useMatch({ from: '/mf' });
  const msg = match.loaderData!.msg;
  const count = match.loaderData!.count;
  const [clientReady, setClientReady] = React.useState(false);
  const [effectMessage, setEffectMessage] = React.useState('pending');
  const hostBootIdentity = React.useId();

  React.useEffect(() => {
    let canceled = false;
    setClientReady(true);

    hostEffectBff.client.greetings
      .hello({})
      .then(data => {
        if (!canceled) {
          setEffectMessage(data.message);
        }
      })
      .catch(() => {
        if (!canceled) {
          setEffectMessage('error');
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div id="mf">
      <div id="host-loader">{msg}</div>
      <div id="host-mf-count">host-mf-count:{count}</div>
      <div id="host-effect-message">host-effect:{effectMessage}</div>
      <div id="host-boot-identity">
        {clientReady ? hostBootIdentity : 'pending'}
      </div>
      {!clientReady ? (
        <>
          <div
            id="remote-ssr-fallback-contract"
            data-ssr-contract={REMOTE_SSR_FALLBACK_CONTRACT}
            data-runtime-boundary="tanstack-mf-client-hydration"
            data-expected-remotes="remote/Widget,remote/Mutator,remote2/Panel"
            data-fallback-metadata-id="remote-ssr-fallback-metadata"
            data-hydration-owner="client"
          >
            remote-ssr:client-hydration-fallback
          </div>
          <script
            id="remote-ssr-fallback-metadata"
            type="application/json"
            // The server shell emits the official fallback contract before
            // hydration so clients and tests can verify replacement ownership.
            dangerouslySetInnerHTML={{
              __html: serializeRemoteSsrFallbackMetadata(
                REMOTE_SSR_FALLBACK_METADATA,
              ),
            }}
          />
          {REMOTE_SSR_FALLBACK_METADATA.remotes.map(remote => (
            <div
              key={remote.id}
              id={remote.placeholderId}
              data-remote-id={remote.id}
              data-runtime-boundary={remote.runtimeBoundary}
              data-fallback-strategy={remote.strategy}
              data-fallback-reason={remote.reason}
              data-fallback-classification={remote.classification}
              data-telemetry-event={remote.telemetryEvent}
              data-hydration-owner={REMOTE_SSR_FALLBACK_METADATA.hydrationOwner}
            >
              {remote.id === 'remote/Widget'
                ? 'remote-widget:pending'
                : remote.id === 'remote/Mutator'
                  ? 'remote-mutator:pending'
                  : 'remote2-panel:pending'}
            </div>
          ))}
        </>
      ) : (
        <>
          <RemoteErrorBoundary fallbackId="remote-error" remote="remote/Widget">
            <React.Suspense fallback={<div id="remote-loading">loading</div>}>
              <RemoteWidget />
            </React.Suspense>
          </RemoteErrorBoundary>
          <RemoteErrorBoundary
            fallbackId="remote-mutator-error"
            remote="remote/Mutator"
          >
            <React.Suspense
              fallback={<div id="remote-mutator-loading">loading</div>}
            >
              <RemoteMutator />
            </React.Suspense>
          </RemoteErrorBoundary>
          <RemoteErrorBoundary
            fallbackId="remote2-error"
            remote="remote2/Panel"
          >
            <React.Suspense fallback={<div id="remote2-loading">loading</div>}>
              <RemotePanel />
            </React.Suspense>
          </RemoteErrorBoundary>
          <div id="remote-runtime-realms">
            <RemoteOneRuntimeApp basename="/mf" />
            <RemoteTwoRuntimeApp basename="/mf" />
          </div>
        </>
      )}
    </div>
  );
}
