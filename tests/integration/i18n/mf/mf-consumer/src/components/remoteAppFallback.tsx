import React from 'react';

type RemoteAppFallbackInfo = {
  error?: {
    message?: string;
  };
  resetErrorBoundary?: () => void;
};

export const createRemoteAppErrorFallback =
  (boundaryId: string) => (info: RemoteAppFallbackInfo) => {
    const message = info?.error?.message || 'Unknown remote app load error';

    return (
      <div
        data-mf-app-ssr-fallback={boundaryId}
        data-mf-app-ssr-error={message}
        style={{
          padding: '20px',
          border: '1px solid red',
          borderRadius: '4px',
        }}
      >
        <h3>加载失败</h3>
        <p>{message}</p>
        <button
          data-mf-app-ssr-retry={boundaryId}
          onClick={() => info.resetErrorBoundary?.()}
        >
          重试
        </button>
      </div>
    );
  };

export const createRemoteAppLoadingFallback = (boundaryId: string) => (
  <div
    data-mf-app-loading={boundaryId}
    style={{ padding: '20px', textAlign: 'center' }}
  >
    <div>正在加载远程应用...</div>
  </div>
);
