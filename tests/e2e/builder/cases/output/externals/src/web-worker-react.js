import React from 'react';

self.postMessage({
  canCreateElement: typeof React.createElement === 'function',
});
