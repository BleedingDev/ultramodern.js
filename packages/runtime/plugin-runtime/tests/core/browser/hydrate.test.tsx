// @rstest-environment happy-dom

import { SSR_HYDRATION_ID_PREFIX } from '@modern-js/utils/universal/constants';
import { act, useId, useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
  hydrateRoot,
  hydrateWithReact,
} from '../../../src/core/browser/hydrate';
import type { TRuntimeContext } from '../../../src/core/context/runtime';

const App = () => {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <label htmlFor={id}>Name</label>
      <input id={id} />
      <button onClick={() => setSubmitted(true)} type="button">
        {submitted ? 'Submitted' : 'Submit'}
      </button>
    </>
  );
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('React DOM hydration', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('adopts server markup, preserves useId labels, and remains interactive', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<App />, {
      identifierPrefix: SSR_HYDRATION_ID_PREFIX,
    });
    document.body.appendChild(container);

    let root: Awaited<ReturnType<typeof hydrateWithReact>>;
    await act(async () => {
      root = await hydrateWithReact(<App />, container);
    });

    const label = container.querySelector('label');
    const input = container.querySelector('input');
    expect(label?.htmlFor).toBe(input?.id);

    await act(async () => {
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('button')?.textContent).toBe('Submitted');

    root!.unmount();
  });
});

describe('string SSR hydration with an unknown render level', () => {
  afterEach(() => {
    delete (window as { _SSR_DATA?: unknown })._SSR_DATA;
    rstest.restoreAllMocks();
  });

  test('warns on the host console and falls back to client render', async () => {
    (window as { _SSR_DATA?: unknown })._SSR_DATA = {
      mode: 'string',
      renderLevel: 1,
    };
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    const root = document.createElement('div');
    const render = rstest.fn(async () => root);
    const hydrate = rstest.fn(async () => root);

    await hydrateRoot(<div />, {} as TRuntimeContext, render, hydrate);

    expect(warnSpy).toHaveBeenCalledWith(
      'unknow render level: 1, execute render()',
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
});
