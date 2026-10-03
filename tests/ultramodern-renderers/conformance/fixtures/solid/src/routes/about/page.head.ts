import type { FileSystemRouteModule } from '@bleedingdev/modern-js-renderer-solid/router';

export const head: NonNullable<FileSystemRouteModule['head']> = () => ({
  meta: [
    { title: 'solid acceptance about' },
    { name: 'description', content: 'Native renderer conformance' },
  ],
});
