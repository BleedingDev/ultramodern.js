import { expect, test } from '@rstest/core';
import i18next, { type i18n } from 'i18next';
import { act, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
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
  const { t } = useModernI18n();

  return <p data-testid="inventory-copy">{t('inventory.widgetBody')}</p>;
}

function Host({ hostI18n }: { hostI18n: i18n }) {
  const [language, setLanguage] = useState('en');

  return (
    <ModernI18nProvider
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
  ).toBe('C1 inventory surface owned by the MicroVertical.');

  await act(async () => {
    (container.querySelector('button') as HTMLButtonElement).click();
  });
  expect(
    container.querySelector('[data-testid="inventory-copy"]')?.textContent,
  ).toBe('C1 skladová plocha vlastněná MicroVerticalem.');
  expect(hydrationErrors).toEqual([]);

  await act(async () => root.unmount());
  container.remove();
});
