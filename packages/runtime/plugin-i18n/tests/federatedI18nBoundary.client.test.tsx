import { expect, test } from '@rstest/core';
import i18next, { type i18n } from 'i18next';
import { act, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ModernI18nProvider } from '../src/runtime/context';
import { FederatedI18nBoundary, useModernI18n } from '../src/runtime/core';

const remoteResources = {
  cs: {
    inventory: {
      'inventory.widgetBody': 'C1 skladová plocha vlastněná MicroVerticalem.',
    },
  },
  en: {
    inventory: {
      'inventory.widgetBody':
        'C1 inventory surface owned by the MicroVertical.',
    },
  },
};

function InventoryCopy() {
  const modernI18n = useModernI18n<i18n>();
  const reactI18n = useTranslation('inventory');
  const reactI18nInstance = reactI18n.i18n as i18n & { __original?: i18n };
  const sharesScopedInstance =
    reactI18nInstance === modernI18n.i18nInstance ||
    reactI18nInstance.__original === modernI18n.i18nInstance;

  return (
    <p data-testid="inventory-copy">
      {modernI18n.t('inventory.widgetBody')}|
      {reactI18n.t('inventory.widgetBody')}|{String(sharesScopedInstance)}
    </p>
  );
}

function Host({ hostI18n }: { hostI18n: i18n }) {
  const [language, setLanguage] = useState('en');

  return (
    <ModernI18nProvider
      i18nextProvider={I18nextProvider}
      value={{
        i18nInstance: hostI18n,
        language,
        languages: ['en', 'cs'],
      }}
    >
      <button
        onClick={async () => {
          await hostI18n.changeLanguage('cs');
          setLanguage('cs');
        }}
        type="button"
      >
        cs
      </button>
      <FederatedI18nBoundary
        defaultNamespace="inventory"
        fallbackLanguage="en"
        resources={remoteResources}
        supportedLanguages={['en', 'cs']}
      >
        <InventoryCopy />
      </FederatedI18nBoundary>
    </ModernI18nProvider>
  );
}

async function createHostI18n() {
  const instance = i18next.createInstance();
  await instance.init({
    defaultNS: 'inventory',
    fallbackLng: 'en',
    initImmediate: false,
    lng: 'en',
    resources: {
      cs: {
        inventory: {
          'inventory.widgetBody': 'stale host Czech copy',
        },
      },
      en: {
        inventory: {
          'inventory.widgetBody': 'stale host English copy',
        },
      },
    },
    supportedLngs: ['en', 'cs'],
  });
  return instance;
}

test('hydrates remote-owned copy and follows the host language', async () => {
  const serverI18n = await createHostI18n();
  const container = document.createElement('div');
  container.innerHTML = renderToString(<Host hostI18n={serverI18n} />);
  document.body.appendChild(container);

  const clientI18n = await createHostI18n();
  const hydrationErrors: unknown[] = [];
  const root = hydrateRoot(container, <Host hostI18n={clientI18n} />, {
    onRecoverableError: error => hydrationErrors.push(error),
  });

  await act(async () => undefined);
  expect(
    container.querySelector('[data-testid="inventory-copy"]')?.textContent,
  ).toBe(
    'C1 inventory surface owned by the MicroVertical.|C1 inventory surface owned by the MicroVertical.|true',
  );

  await act(async () => {
    (container.querySelector('button') as HTMLButtonElement).click();
  });
  expect(
    container.querySelector('[data-testid="inventory-copy"]')?.textContent,
  ).toBe(
    'C1 skladová plocha vlastněná MicroVerticalem.|C1 skladová plocha vlastněná MicroVerticalem.|true',
  );
  expect(clientI18n.t('inventory.widgetBody')).toBe('stale host Czech copy');
  expect(hydrationErrors).toEqual([]);

  await act(async () => root.unmount());
  container.remove();
});
