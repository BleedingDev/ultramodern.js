import type { FileSystemRouteModule } from '@bleedingdev/modern-js-renderer-octane/router';

export const head: NonNullable<FileSystemRouteModule['head']> = () => ({
  meta: [
    { title: 'octane acceptance home' },
    { name: 'description', content: 'Native renderer conformance' },
  ],
});
