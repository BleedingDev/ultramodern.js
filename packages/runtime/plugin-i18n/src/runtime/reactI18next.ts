import type React from 'react';

export interface ReactI18nextIntegration {
  I18nextProvider: React.ComponentType<any> | null;
  initReactI18next: any | null;
}

export type LoadReactI18nextIntegration =
  () => Promise<ReactI18nextIntegration | null>;

export const resolveReactI18nextIntegration = async (
  reactI18next: boolean,
  loadReactI18nextIntegration?: LoadReactI18nextIntegration,
): Promise<ReactI18nextIntegration | null> => {
  if (!reactI18next) {
    return null;
  }

  return loadReactI18nextIntegration?.() ?? null;
};
