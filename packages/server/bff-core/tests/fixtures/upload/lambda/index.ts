import { Api, Upload } from '@modern-js/bff-core';
import { z } from 'zod';

const FileSchema = z.object({
  file: z.any(),
});

export const upload = Api(
  Upload('/upload', FileSchema),
  async ({ formData }: { formData: Record<string, unknown> }) => ({
    ok: true,
    keys: Object.keys(formData || {}),
  }),
);

export const get = async () => ({ ok: true });
