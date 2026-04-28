export const DESIGN_SYSTEM_MODES = [
  'off',
  'tokens',
  'components',
  'strict',
] as const;

export const DESIGN_SYSTEM_OVERRIDE_LAYERS = [
  'brand',
  'vertical',
  'application',
] as const;

export type DesignSystemMode = (typeof DESIGN_SYSTEM_MODES)[number];

export type DesignSystemOverrideLayer =
  (typeof DESIGN_SYSTEM_OVERRIDE_LAYERS)[number];

export type DesignSystemTokenValue = string | number;

export interface DesignSystemTokenPack {
  id: string;
  version: string;
  brand: string;
  tokens: Record<string, DesignSystemTokenValue>;
}

export interface DesignSystemOverride {
  layer: DesignSystemOverrideLayer;
  tokens?: Record<string, DesignSystemTokenValue>;
  reason?: string;
}

export interface DesignSystemConsumerContract {
  id: string;
  requiredTokens?: string[];
  unsupportedModes?: DesignSystemMode[];
  tokenPackVersions?: Record<string, string>;
}

export interface DesignSystemRollbackMetadata {
  tokenPack: string;
  version: string;
  reason: string;
}

export interface DesignSystemPinMetadata {
  tokenPack: string;
  version: string;
  rollback: DesignSystemRollbackMetadata;
}

export interface DesignSystemVerticalContract {
  mode: DesignSystemMode;
  tokenPack?: string;
  overrides?: DesignSystemOverride[];
  pin?: DesignSystemPinMetadata;
  consumers?: DesignSystemConsumerContract[];
}

export interface DesignSystemContract {
  tokenPacks: DesignSystemTokenPack[];
  verticals: Record<string, DesignSystemVerticalContract>;
}

export interface DesignSystemValidationIssue {
  path: string;
  message: string;
}

export interface DesignSystemValidationResult {
  valid: boolean;
  issues: DesignSystemValidationIssue[];
}

const VALID_MODES = new Set<DesignSystemMode>(DESIGN_SYSTEM_MODES);
const VALID_OVERRIDE_LAYERS = new Set<DesignSystemOverrideLayer>(
  DESIGN_SYSTEM_OVERRIDE_LAYERS,
);

const createValidationResult = (
  issues: DesignSystemValidationIssue[],
): DesignSystemValidationResult => ({
  valid: issues.length === 0,
  issues,
});

const addIssue = (
  issues: DesignSystemValidationIssue[],
  path: string,
  message: string,
) => {
  issues.push({ path, message });
};

export const createDesignSystemTokenPackMap = (
  tokenPacks: DesignSystemTokenPack[],
): Map<string, DesignSystemTokenPack> =>
  new Map(tokenPacks.map(tokenPack => [tokenPack.id, tokenPack]));

export const validateDesignSystemConsumerCompatibility = (
  vertical: DesignSystemVerticalContract,
  tokenPack: DesignSystemTokenPack | undefined,
  path = 'vertical',
): DesignSystemValidationResult => {
  const issues: DesignSystemValidationIssue[] = [];
  const consumers = vertical.consumers ?? [];

  for (const [consumerIndex, consumer] of consumers.entries()) {
    const consumerPath = `${path}.consumers[${consumerIndex}]`;

    if (consumer.unsupportedModes?.includes(vertical.mode)) {
      addIssue(
        issues,
        `${consumerPath}.unsupportedModes`,
        `consumer "${consumer.id}" does not support "${vertical.mode}" mode`,
      );
    }

    if (!tokenPack) {
      continue;
    }

    const expectedVersion = consumer.tokenPackVersions?.[tokenPack.id];
    if (expectedVersion && expectedVersion !== tokenPack.version) {
      addIssue(
        issues,
        `${consumerPath}.tokenPackVersions.${tokenPack.id}`,
        `consumer "${consumer.id}" requires "${tokenPack.id}" version "${expectedVersion}" but received "${tokenPack.version}"`,
      );
    }

    for (const tokenName of consumer.requiredTokens ?? []) {
      if (!(tokenName in tokenPack.tokens)) {
        addIssue(
          issues,
          `${consumerPath}.requiredTokens`,
          `consumer "${consumer.id}" requires missing token "${tokenName}" from "${tokenPack.id}"`,
        );
      }
    }
  }

  return createValidationResult(issues);
};

export const validateDesignSystemContract = (
  contract: DesignSystemContract,
): DesignSystemValidationResult => {
  const issues: DesignSystemValidationIssue[] = [];
  const tokenPackMap = createDesignSystemTokenPackMap(contract.tokenPacks);

  for (const [tokenPackIndex, tokenPack] of contract.tokenPacks.entries()) {
    const tokenPackPath = `tokenPacks[${tokenPackIndex}]`;

    if (tokenPackMap.get(tokenPack.id) !== tokenPack) {
      addIssue(
        issues,
        `${tokenPackPath}.id`,
        `duplicate token pack id "${tokenPack.id}"`,
      );
    }

    if (Object.keys(tokenPack.tokens).length === 0) {
      addIssue(
        issues,
        `${tokenPackPath}.tokens`,
        `token pack "${tokenPack.id}" must define at least one token`,
      );
    }
  }

  for (const [verticalName, vertical] of Object.entries(contract.verticals)) {
    const verticalPath = `verticals.${verticalName}`;
    const tokenPack = vertical.tokenPack
      ? tokenPackMap.get(vertical.tokenPack)
      : undefined;

    if (!VALID_MODES.has(vertical.mode)) {
      addIssue(
        issues,
        `${verticalPath}.mode`,
        `unsupported design system mode "${vertical.mode}"`,
      );
    }

    if (vertical.mode !== 'off' && !vertical.tokenPack) {
      addIssue(
        issues,
        `${verticalPath}.tokenPack`,
        `vertical "${verticalName}" must select a token pack when mode is "${vertical.mode}"`,
      );
    }

    if (vertical.tokenPack && !tokenPack) {
      addIssue(
        issues,
        `${verticalPath}.tokenPack`,
        `unknown token pack "${vertical.tokenPack}"`,
      );
    }

    for (const [overrideIndex, override] of (
      vertical.overrides ?? []
    ).entries()) {
      if (!VALID_OVERRIDE_LAYERS.has(override.layer)) {
        addIssue(
          issues,
          `${verticalPath}.overrides[${overrideIndex}].layer`,
          `override layer "${override.layer}" is not approved`,
        );
      }
    }

    if (vertical.pin) {
      const pinnedTokenPack = tokenPackMap.get(vertical.pin.tokenPack);
      const rollbackTokenPack = tokenPackMap.get(
        vertical.pin.rollback.tokenPack,
      );

      if (!pinnedTokenPack) {
        addIssue(
          issues,
          `${verticalPath}.pin.tokenPack`,
          `unknown pinned token pack "${vertical.pin.tokenPack}"`,
        );
      } else if (pinnedTokenPack.version !== vertical.pin.version) {
        addIssue(
          issues,
          `${verticalPath}.pin.version`,
          `pinned version "${vertical.pin.version}" does not match token pack "${vertical.pin.tokenPack}" version "${pinnedTokenPack.version}"`,
        );
      }

      if (vertical.tokenPack && vertical.pin.tokenPack !== vertical.tokenPack) {
        addIssue(
          issues,
          `${verticalPath}.pin.tokenPack`,
          `pinned token pack "${vertical.pin.tokenPack}" must match selected token pack "${vertical.tokenPack}"`,
        );
      }

      if (!rollbackTokenPack) {
        addIssue(
          issues,
          `${verticalPath}.pin.rollback.tokenPack`,
          `unknown rollback token pack "${vertical.pin.rollback.tokenPack}"`,
        );
      } else if (rollbackTokenPack.version !== vertical.pin.rollback.version) {
        addIssue(
          issues,
          `${verticalPath}.pin.rollback.version`,
          `rollback version "${vertical.pin.rollback.version}" does not match token pack "${vertical.pin.rollback.tokenPack}" version "${rollbackTokenPack.version}"`,
        );
      }

      if (!vertical.pin.rollback.reason) {
        addIssue(
          issues,
          `${verticalPath}.pin.rollback.reason`,
          'rollback metadata must include a reason',
        );
      }
    }

    const compatibility = validateDesignSystemConsumerCompatibility(
      vertical,
      tokenPack,
      verticalPath,
    );
    issues.push(...compatibility.issues);
  }

  return createValidationResult(issues);
};
