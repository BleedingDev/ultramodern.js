import { createRoot, onCleanup } from 'solid-js';
import { mountApplication } from '../../src/client';

describe('native Solid application ownership', () => {
  test('rejects a duplicate root and disposes the native owner exactly once', () => {
    const element = document.createElement('div');
    const cleanup = rstest.fn();
    const dispose = mountApplication(() => {
      onCleanup(cleanup);
      return document.createElement('button');
    }, element);
    expect(element.querySelectorAll('button')).toHaveLength(1);
    expect(() => mountApplication(() => null, element)).toThrow(
      'already owns this mount element',
    );
    dispose();
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(element.childNodes).toHaveLength(0);
    mountApplication(() => 'remounted', element)();
  });

  test('a stale HMR disposer cannot dispose a replacement application', () => {
    const element = document.createElement('div');
    const callbacks: (() => void)[] = [];
    const hot = { dispose: (callback: () => void) => callbacks.push(callback) };
    const firstCleanup = rstest.fn();
    mountApplication(
      () => {
        onCleanup(firstCleanup);
        return 'first';
      },
      element,
      { hot },
    );
    callbacks[0]?.();
    const secondCleanup = rstest.fn();
    const dispose = mountApplication(
      () => {
        onCleanup(secondCleanup);
        return 'second';
      },
      element,
      { hot },
    );
    callbacks[0]?.();
    expect(element.textContent).toBe('second');
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).not.toHaveBeenCalled();
    dispose();
    expect(secondCleanup).toHaveBeenCalledTimes(1);
  });

  test('the application owner outlives the owner that creates it', () => {
    const element = document.createElement('div');
    const cleanup = rstest.fn();
    let disposeApplication = () => {};
    const disposeParent = createRoot(dispose => {
      disposeApplication = mountApplication(() => {
        onCleanup(cleanup);
        return 'independent';
      }, element);
      return dispose;
    });
    disposeParent();
    expect(element.textContent).toBe('independent');
    expect(cleanup).not.toHaveBeenCalled();
    disposeApplication();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('failed HMR registration releases the mounted native root', () => {
    const element = document.createElement('div');
    const cleanup = rstest.fn();
    expect(() =>
      mountApplication(
        () => {
          onCleanup(cleanup);
          return 'first';
        },
        element,
        {
          hot: {
            dispose: () => {
              throw new Error('registration failed');
            },
          },
        },
      ),
    ).toThrow('registration failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    mountApplication(() => 'next', element)();
  });
});
