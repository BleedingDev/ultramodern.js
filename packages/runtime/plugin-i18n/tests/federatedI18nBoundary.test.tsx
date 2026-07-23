import { describe, expect, test } from '@rstest/core';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModernI18nProvider } from '../src/runtime/context';
import { FederatedI18nBoundary, useModernI18n } from '../src/runtime/core';

const C0_COPY = 'C0 copy bundled by the shell';
const C1_COPY =
  'C1 operational independence: inventory UI and localization moved together.';
const HOST_ONLY_INVENTORY_COPY = 'inventory copy owned only by the shell';
const HOST_ONLY_SHELL_COPY = 'private shell copy';

function InventoryCopy() {
  const { t } = useModernI18n();

  return (
    <p>
      {t('inventory.widgetBody')}|{t('inventory.hostOnly')}|{t('shell:private')}
    </p>
  );
}

describe('FederatedI18nBoundary', () => {
  test('renders remote-owned resources instead of stale host resources', async () => {
    const hostI18n = i18next.createInstance();
    await hostI18n.init({
      defaultNS: 'inventory',
      fallbackLng: 'en',
      initImmediate: false,
      lng: 'en',
      ns: ['inventory'],
      resources: {
        en: {
          inventory: {
            'inventory.hostOnly': HOST_ONLY_INVENTORY_COPY,
            'inventory.widgetBody': C0_COPY,
          },
          shell: {
            private: HOST_ONLY_SHELL_COPY,
          },
        },
      },
      supportedLngs: ['en', 'cs'],
    });

    const html = renderToStaticMarkup(
      <ModernI18nProvider
        value={{
          i18nInstance: hostI18n,
          language: 'en',
          languages: ['en', 'cs'],
        }}
      >
        <FederatedI18nBoundary
          defaultNamespace="inventory"
          resources={{
            en: {
              inventory: {
                'inventory.widgetBody': C1_COPY,
              },
            },
          }}
        >
          <InventoryCopy />
        </FederatedI18nBoundary>
      </ModernI18nProvider>,
    );

    expect(html).toContain(C1_COPY);
    expect(html).not.toContain(C0_COPY);
    expect(html).not.toContain(HOST_ONLY_INVENTORY_COPY);
    expect(html).not.toContain(HOST_ONLY_SHELL_COPY);
    expect(hostI18n.t('inventory.widgetBody')).toBe(C0_COPY);
    expect(hostI18n.t('inventory.hostOnly')).toBe(HOST_ONLY_INVENTORY_COPY);
    expect(hostI18n.t('shell:private')).toBe(HOST_ONLY_SHELL_COPY);
  });

  test('fails before mutation when cloneInstance does not isolate the host store', async () => {
    const hostI18n = i18next.createInstance();
    await hostI18n.init({
      defaultNS: 'inventory',
      initImmediate: false,
      lng: 'en',
      resources: {
        en: {
          inventory: {
            'inventory.widgetBody': C0_COPY,
          },
        },
      },
    });
    hostI18n.cloneInstance = () => hostI18n;

    expect(() =>
      renderToStaticMarkup(
        <ModernI18nProvider
          value={{
            i18nInstance: hostI18n,
            language: 'en',
            languages: ['en'],
          }}
        >
          <FederatedI18nBoundary
            defaultNamespace="inventory"
            resources={{
              en: {
                inventory: {
                  'inventory.widgetBody': C1_COPY,
                },
              },
            }}
          >
            <InventoryCopy />
          </FederatedI18nBoundary>
        </ModernI18nProvider>,
      ),
    ).toThrow(/did not isolate the host resource store/u);
    expect(hostI18n.t('inventory.widgetBody')).toBe(C0_COPY);
  });
});
