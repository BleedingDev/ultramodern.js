import {
  DELIVERY_UNIT_IDENTITY_FIELDS,
  type DeliveryUnitIdentity,
  deliveryUnitIdentityFieldValue,
} from '@modern-js/utils/universal';
import type { CloudflareOutputVerifierIssue, JsonObject } from './issues';
import { addIssue, assertEqual } from './issues';

export type CloudflareDeliveryUnitIdentity = DeliveryUnitIdentity & {
  surfaces?: Partial<
    Record<'api' | 'ui', DeliveryUnitIdentity & { surface: 'api' | 'ui' }>
  >;
};

export const verifyDeliveryUnitIdentity = (
  issues: CloudflareOutputVerifierIssue[],
  manifest: JsonObject,
  manifestPath: string,
  declared: CloudflareDeliveryUnitIdentity | undefined,
) => {
  const stamped = manifest?.deliveryUnit;
  const hasStamp = Boolean(stamped) && typeof stamped === 'object';

  // Legacy outputs (no topology declaration and no stamp) are unchanged.
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
  if (hasStamp && stamped.surfaces && typeof stamped.surfaces === 'object') {
    for (const surface of ['ui', 'api'] as const) {
      const marker = stamped.surfaces[surface];
      const expected = declared?.surfaces?.[surface];

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

      if (!marker || typeof marker !== 'object') {
        addIssue(issues, {
          code: 'missing-delivery-unit',
          message: `Cloudflare worker manifest is missing the ${surface} delivery-unit surface marker.`,
          path: manifestPath,
        });
        continue;
      }

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
    }
  }
};
