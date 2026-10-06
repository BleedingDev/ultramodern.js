import { Outlet } from '@modern-js/plugin-tanstack/runtime';
import { useEffect } from 'react';

export default function RootLayout() {
  // Tests wait for html[data-hydrated] before interacting with the page.
  useEffect(() => {
    document.documentElement.dataset.hydrated = '';
  }, []);
  return <Outlet />;
}
