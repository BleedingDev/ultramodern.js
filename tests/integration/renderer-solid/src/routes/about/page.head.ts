import type { FileSystemRouteModule } from '@modern-js/renderer-solid/router';

export const head: NonNullable<FileSystemRouteModule['head']> = () => ({
  meta: [
    { title: 'solid fixture about' },
    { name: 'description', content: 'Renderer fixture' },
  ],
});
