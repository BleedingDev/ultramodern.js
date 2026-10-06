import { Errored, flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import { federatedComponent } from '../../src/federation';

const settle = async () => {
  for (let index = 0; index < 3; index++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
};

describe('federated Solid components', () => {
  test('render the fallback, then the remote component with live props', async () => {
    const element = document.createElement('div');
    let release!: () => void;
    const load = rstest.fn(
      () =>
        new Promise<{ default: (props: { label: string }) => HTMLElement }>(
          resolve => {
            release = () =>
              resolve({
                default: props => {
                  const button = document.createElement('button');
                  button.textContent = props.label;
                  return button;
                },
              });
          },
        ),
    );
    const Widget = federatedComponent(load, {
      fallback: () => <span data-fallback="">loading</span>,
    });
    const dispose = mountApplication(() => <Widget label="remote" />, element);
    await settle();
    expect(element.querySelector('[data-fallback]')).not.toBeNull();
    release();
    await settle();
    expect(element.querySelector('button')?.textContent).toBe('remote');
    expect(element.querySelector('[data-fallback]')).toBeNull();
    dispose();

    // A later mount reuses the loaded module instead of loading again.
    const second = document.createElement('div');
    mountApplication(() => <Widget label="again" />, second)();
    expect(load).toHaveBeenCalledTimes(1);
  });

  const captureFailure = async (Widget: () => unknown) => {
    const element = document.createElement('div');
    const failures: unknown[] = [];
    const dispose = mountApplication(
      () => (
        <Errored
          fallback={(error: () => unknown) => {
            failures.push(error());
            return <p data-failed="">{String(error())}</p>;
          }}
        >
          <Widget />
        </Errored>
      ),
      element,
    );
    await settle();
    // The boundary must render its fallback, not merely observe the error.
    if (failures.length)
      expect(element.querySelector('[data-failed]')?.textContent).toBe(
        String(failures.at(-1)),
      );
    dispose();
    return failures;
  };

  test('a load failure reaches the nearest Errored boundary and is retried', async () => {
    const load = rstest.fn(() => Promise.reject(new Error('remote offline')));
    const Widget = federatedComponent(load);
    expect(String(await captureFailure(Widget))).toContain('remote offline');
    await captureFailure(Widget);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a module without a default component is rejected', async () => {
    const Widget = federatedComponent(
      () => Promise.resolve({ default: 'nope' }) as never,
    );
    expect(String(await captureFailure(Widget))).toContain(
      'must default-export a component',
    );
  });

  test('requires a remote id or a loader function', () => {
    expect(() => federatedComponent('Widget')).toThrow("'remote/Widget'");
    expect(() => federatedComponent(42 as never)).toThrow("'remote/Widget'");
  });

  test('a remote id without a federation runtime fails at load time', async () => {
    const Widget = federatedComponent('remote/Widget');
    expect(String(await captureFailure(Widget))).toContain(
      'no Module Federation runtime',
    );
  });
});
