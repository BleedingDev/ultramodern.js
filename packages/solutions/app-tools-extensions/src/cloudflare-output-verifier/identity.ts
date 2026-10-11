import {
  DELIVERY_UNIT_IDENTITY_FIELDS,
  type DeliveryUnitIdentity,
  deliveryUnitIdentityFieldValue,
  validateRendererIdentity,
  validateRendererProfile,
  validateRendererProfileCompatibility,
} from '@modern-js/backend-federation-contracts';
import type { TopologyUiSurface } from '../cloudflare/delivery-unit';
import { isRecord } from '../cloudflare/utils';
import type { CloudflareOutputVerifierIssue, JsonObject } from './issues';
import { addIssue, assertEqual } from './issues';

export type CloudflareDeliveryUnitIdentity = DeliveryUnitIdentity & {
  surfaces?: {
    ui?: TopologyUiSurface;
    api?: DeliveryUnitIdentity & { surface: 'api' };
  };
};

export const verifyDeliveryUnitIdentity = (
  issues: CloudflareOutputVerifierIssue[],
  manifest: JsonObject,
  manifestPath: string,
  declared: CloudflareDeliveryUnitIdentity | undefined,
) => {
  const stamped = manifest?.deliveryUnit;
  const hasStamp = isRecord(stamped);

  if (declared) {
    if (!hasStamp) {
      addIssue(issues, {
        code: 'missing-delivery-unit',
        message: `Cloudflare worker manifest is missing the delivery-unit identity declared by the workspace topology (expected unitId ${declared.unitId}, buildMarker ${declared.buildMarker}).`,
        path: manifestPath,
      });
      return;
    }

    for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
      const stampedValue = deliveryUnitIdentityFieldValue(stamped, field);
      assertEqual(issues, stampedValue, declared[field], {
        code: 'delivery-unit-drift',
        message: `Cloudflare worker manifest deliveryUnit.${field} must match the topology delivery-unit record (expected ${declared[field]}, received ${
          stampedValue ?? 'undefined'
        }).`,
        path: manifestPath,
      });
    }
  }

  // Every profile-declared surface must derive from the one stamped record;
  // profiles must not claim a UI/API surface they do not emit.
  if (hasStamp) {
    if (!isRecord(stamped.surfaces)) {
      addIssue(issues, {
        code: 'missing-delivery-unit',
        message:
          'Cloudflare worker manifest is missing delivery-unit surface markers.',
        path: manifestPath,
      });
      return;
    }
    for (const surface of Object.keys(stamped.surfaces)) {
      if (surface !== 'ui' && surface !== 'api') {
        addIssue(issues, {
          code: 'delivery-unit-drift',
          message: `Cloudflare worker manifest declares an unsupported ${surface} delivery-unit surface.`,
          path: manifestPath,
        });
      }
    }
    if (
      !declared?.surfaces &&
      !Object.hasOwn(stamped.surfaces, 'ui') &&
      !Object.hasOwn(stamped.surfaces, 'api')
    ) {
      addIssue(issues, {
        code: 'missing-delivery-unit',
        message:
          'Cloudflare worker manifest is missing delivery-unit surface markers.',
        path: manifestPath,
      });
      return;
    }
    for (const surface of ['ui', 'api'] as const) {
      const marker = stamped.surfaces[surface];
      const expected = declared?.surfaces?.[surface];

      if (!expected && !marker) {
        continue;
      }

      if (declared?.surfaces && !expected) {
        if (marker) {
          addIssue(issues, {
            code: 'delivery-unit-drift',
            message: `Cloudflare worker manifest declares an unexpected ${surface} delivery-unit surface for this topology profile.`,
            path: manifestPath,
          });
        }
        continue;
      }

      if (!isRecord(marker)) {
        addIssue(issues, {
          code: 'missing-delivery-unit',
          message: `Cloudflare worker manifest is missing the ${surface} delivery-unit surface marker.`,
          path: manifestPath,
        });
        continue;
      }

      assertEqual(issues, marker.surface, surface, {
        code: 'delivery-unit-drift',
        message: `Cloudflare worker manifest ${surface} surface must declare surface "${surface}".`,
        path: manifestPath,
      });
      for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
        const markerValue = deliveryUnitIdentityFieldValue(marker, field);
        const stampedValue = deliveryUnitIdentityFieldValue(stamped, field);
        assertEqual(issues, markerValue, stampedValue, {
          code: 'delivery-unit-drift',
          message: `Cloudflare worker manifest ${surface} surface deliveryUnit.${field} must derive from one delivery-unit record (expected ${
            stampedValue ?? 'undefined'
          }, received ${markerValue ?? 'undefined'}).`,
          path: manifestPath,
        });
      }

      if (surface === 'api') {
        for (const field of ['rendererIdentity', 'rendererProfile']) {
          if (Object.hasOwn(marker, field)) {
            addIssue(issues, {
              code: 'delivery-unit-drift',
              message: `Cloudflare worker manifest API surface must not declare ${field}.`,
              path: manifestPath,
            });
          }
        }
        continue;
      }
      const identity = marker.rendererIdentity;
      const profile = marker.rendererProfile;
      const errors = [
        ...validateRendererIdentity(identity).errors,
        ...validateRendererProfile(profile).errors,
      ];
      for (const error of errors) {
        addIssue(issues, {
          code: 'delivery-unit-drift',
          message: `Cloudflare worker manifest UI ${error.path} ${error.message}`,
          path: manifestPath,
        });
      }
      if (errors.length || !isRecord(identity) || !isRecord(profile)) {
        continue;
      }
      assertEqual(issues, identity.buildId, marker.buildMarker, {
        code: 'delivery-unit-drift',
        message:
          'Cloudflare worker manifest UI rendererIdentity.buildId must match its surface buildMarker.',
        path: manifestPath,
      });
      assertEqual(issues, identity.appId, marker.appId, {
        code: 'delivery-unit-drift',
        message:
          'Cloudflare worker manifest UI rendererIdentity.appId must match its surface appId.',
        path: manifestPath,
      });
      assertEqual(issues, marker.appId, stamped.appId, {
        code: 'delivery-unit-drift',
        message:
          'Cloudflare worker manifest UI surface appId must match its delivery-unit appId.',
        path: manifestPath,
      });
      for (const field of ['renderer', 'protocolVersion']) {
        assertEqual(issues, identity[field], profile[field], {
          code: 'delivery-unit-drift',
          message: `Cloudflare worker manifest UI rendererProfile.${field} must match its renderer identity.`,
          path: manifestPath,
        });
      }
      const expectedUi = declared?.surfaces?.ui;
      // A topology without a renderer projection declares no identity to match.
      if (expectedUi?.rendererIdentity) {
        for (const field of [
          'renderer',
          'appId',
          'entryName',
          'protocolVersion',
          'buildId',
        ] as const) {
          assertEqual(
            issues,
            identity[field],
            expectedUi.rendererIdentity[field],
            {
              code: 'delivery-unit-drift',
              message: `Cloudflare worker manifest UI rendererIdentity.${field} must match the topology renderer identity.`,
              path: manifestPath,
            },
          );
        }
        for (const error of validateRendererProfileCompatibility(
          expectedUi.rendererProfile,
          profile,
        ).errors) {
          addIssue(issues, {
            code: 'delivery-unit-drift',
            message: `Cloudflare worker manifest UI ${error.path} ${error.message}`,
            path: manifestPath,
          });
        }
      }
    }
  }
};
