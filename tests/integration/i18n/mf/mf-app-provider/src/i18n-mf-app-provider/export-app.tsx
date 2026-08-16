import '@modern-js/runtime/registry/index';
import { createNestedAppRenderer } from '@modern-js/runtime/browser';
import { createRoot } from '@modern-js/runtime/react';
import { createBridgeComponent } from '@module-federation/modern-js-v3/react-v19';
import type { ReactElement } from 'react';

const ModernRoot = createRoot();
const renderNestedApp = createNestedAppRenderer();

export const provider = createBridgeComponent({
  rootComponent: ModernRoot,
  render: (Component, dom) =>
    renderNestedApp(Component as ReactElement<{ basename: string }>, dom),
});

export default provider;
