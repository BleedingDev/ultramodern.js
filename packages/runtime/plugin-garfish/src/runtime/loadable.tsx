import { useCallback, useEffect, useState } from 'react';
import { logger } from '../util';
import type { LoadableConfig, MicroComponentProps } from './useModuleApps';

const DEFAULT_LOADABLE: LoadableConfig = {
  delay: 200,
  timeout: 10000,
  loading: null,
};

export interface MicroProps {
  setLoadingState: (state: { isLoading?: boolean; error?: unknown }) => void;
  [key: string]: any;
}

export function Loadable(WrapComponent: any) {
  return function (defaultLoadable?: LoadableConfig) {
    return function LoadableComponent(props: MicroComponentProps) {
      const { loadable = defaultLoadable ?? DEFAULT_LOADABLE, ...otherProps } =
        props;
      let delayTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const [state, setState] = useState(() => {
        const { delay, timeout } = loadable;
        const initState = {
          error: null,
          pastDelay: false,
          timedOut: false,
          isLoading: false,
        };

        if (typeof delay === 'number') {
          if (delay === 0) {
            initState.pastDelay = true;
          } else {
            delayTimer = setTimeout(() => {
              setStateWithMountCheck({
                pastDelay: true,
              });
            }, delay);
          }
        }

        if (typeof timeout === 'number') {
          timeoutTimer = setTimeout(() => {
            setStateWithMountCheck({
              timedOut: true,
            });
          }, timeout);
        }

        return initState;
      });

      const LoadingComponent = props.loadable?.loading;

      useEffect(() => {
        logger('Loadable render state', {
          state,
          props: otherProps,
          loadable,
          defaultLoadable,
        });

        return () => {
          setStateWithMountCheck({
            isLoading: false,
            error: null,
          });
          if (delayTimer) {
            clearTimeout(delayTimer);
            delayTimer = null;
          }
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
        };
      }, []);

      const retry = useCallback(() => {
        setState({
          ...state,
          error: null,
          isLoading: true,
          timedOut: false,
        });
      }, [state]);

      const setStateWithMountCheck = useCallback(
        (newState: Record<string, unknown>) => {
          setState(state => ({
            ...state,
            ...newState,
          }));
        },
        [state],
      );

      const showLoading = (state.isLoading || state.error) && LoadingComponent;

      return (
        <>
          {showLoading ? (
            <LoadingComponent
              isLoading={state.isLoading}
              pastDelay={state.pastDelay}
              timedOut={state.timedOut}
              error={state?.error}
              retry={retry}
            />
          ) : null}
          <WrapComponent
            style={{ display: showLoading ? 'none' : 'block' }}
            setLoadingState={(nextState: { error?: unknown }) => {
              if (nextState.error && !LoadingComponent) {
                throw nextState.error;
              }
              setStateWithMountCheck(nextState);
            }}
            {...otherProps}
          />
        </>
      );
    };
  };
}
