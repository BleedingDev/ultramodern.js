import { Outlet } from '@modern-js/runtime/router';
import { useEffect } from 'react';

export default () => {
  // Tests wait for html[data-hydrated] before interacting with the page.
  useEffect(() => {
    document.documentElement.dataset.hydrated = '';
  }, []);
  return (
    <div>
      <Outlet />
    </div>
  );
};
