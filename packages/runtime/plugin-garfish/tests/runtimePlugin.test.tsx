import GarfishInstance from 'garfish';
import React from 'react';
import { createRoot } from 'react-dom/client';
import garfishRuntimePlugin from '../src/runtime/plugin';

const generateAppsMock = rstest.fn();
const generateMAppMock = rstest.fn();
const setExternalMock = rstest.fn();

rstest.mock('../src/runtime/utils/apps', () => ({
  __esModule: true,
  generateApps: (...args: unknown[]) => generateAppsMock(...args),
}));

rstest.mock('../src/runtime/utils/MApp', () => ({
  __esModule: true,
  generateMApp: (...args: unknown[]) => generateMAppMock(...args),
}));

rstest.mock('../src/runtime/utils/setExternal', () => ({
  __esModule: true,
  default: (...args: unknown[]) => setExternalMock(...args),
}));

describe('plugin-garfish runtime plugin', () => {
  afterEach(() => {
    rstest.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('emits compatibility fallback telemetry and keeps the shell alive on strict digest mismatch', async () => {
    const eventHandler = rstest.fn();
    const setOptionsSpy = rstest.spyOn(GarfishInstance, 'setOptions');
    const registerAppSpy = rstest.spyOn(GarfishInstance, 'registerApp');
    window.addEventListener(
      'modernjs:test-mf-fallback',
      eventHandler as EventListener,
    );

    const plugin = garfishRuntimePlugin({
      apps: [
        {
          name: 'dashboard',
          entry: 'https://remote.example.com/dashboard/remoteEntry.js',
          runtimeDigest: 'remote-v2',
        },
      ],
      runtimeCompatibility: {
        hostDigest: 'host-v1',
        mode: 'strict',
      },
      fallbackTelemetry: {
        eventName: 'modernjs:test-mf-fallback',
        emitConsole: false,
        reportToServer: false,
      },
    } as any);

    const runtime = plugin.setup();
    const Shell = () => <div id="shell-still-alive">shell</div>;
    const wrapped = runtime.hoc?.({ App: Shell }, input => input);
    const container = document.createElement('div');
    const root = createRoot(container);
    document.body.appendChild(container);

    expect(wrapped?.App).toBeTruthy();
    root.render(React.createElement(wrapped!.App));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (eventHandler.mock.calls.length === 1) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 2000) {
          reject(new Error('Expected compatibility fallback event'));
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });

    const emittedEvent = eventHandler.mock.calls[0][0] as CustomEvent;
    expect(emittedEvent.detail).toMatchObject({
      reason: 'runtime_incompatible',
      phase: 'compatibility',
      appName: 'dashboard',
      code: 'MV_RUNTIME_INCOMPATIBLE',
      runtimeSurface: 'module-federation',
      trustDecision: 'trusted',
      compatibilityDecision: 'incompatible',
      parityClaimId: 'mv-runtime-parity',
      metadata: {
        source: 'plugin-garfish:init',
      },
    });
    expect(String(emittedEvent.detail.message)).toContain('dashboard');

    expect(setExternalMock).toHaveBeenCalledTimes(1);
    expect(setOptionsSpy).toHaveBeenCalledTimes(1);
    expect(registerAppSpy).not.toHaveBeenCalled();
    expect(generateAppsMock).not.toHaveBeenCalled();
    expect(generateMAppMock).not.toHaveBeenCalled();
    expect(document.querySelector('#shell-still-alive')?.textContent).toBe(
      'shell',
    );
    root.unmount();

    window.removeEventListener(
      'modernjs:test-mf-fallback',
      eventHandler as EventListener,
    );
  });
});
