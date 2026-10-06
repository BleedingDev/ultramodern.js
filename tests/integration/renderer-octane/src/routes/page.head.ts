import type { FileSystemRouteModule } from '@modern-js/renderer-octane/router';

export const head: NonNullable<FileSystemRouteModule['head']> = () => ({
  meta: [
    { title: 'octane fixture home' },
    { name: 'description', content: 'Renderer fixture' },
  ],
});
