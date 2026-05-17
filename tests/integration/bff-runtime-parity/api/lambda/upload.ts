// @effect-diagnostics asyncFunction:off
import { Api, Upload } from '@modern-js/plugin-bff/hono-server';
import { z } from 'zod';

const FileSchema = z.object({
  images: z.unknown(),
});

export const upload = Api(
  Upload('/upload', FileSchema),
  async ({ formData }) => {
    const image = formData.images as { name?: unknown };
    const fileName = typeof image?.name === 'string' ? image.name : '';
    return {
      data: {
        code: 10,
        file_name: fileName,
      },
    };
  },
);
