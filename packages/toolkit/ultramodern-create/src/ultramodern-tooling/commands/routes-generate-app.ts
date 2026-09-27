import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Static packaged entrypoint. No executable source is rendered into consumers
// or temporary directories; the process boundary isolates native CLI singletons.
async function main(): Promise<void> {
  const [appDirectory, label, mode] = process.argv.slice(2);
  try {
    if (!appDirectory || !label) {
      throw new Error('Route generation requires an app directory and label.');
    }
    const appRequire = createRequire(path.join(appDirectory, 'package.json'));
    const pluginUrl = pathToFileURL(
      appRequire.resolve('@modern-js/plugin-tanstack'),
    ).href;
    const plugin = (await import(pluginUrl)) as Record<
      'generateTanstackRouteArtifacts' | 'writeRouteMetadataManifest',
      (options: { appDirectory: string }) => Promise<void>
    >;
    if (mode === 'manifest') {
      await plugin.writeRouteMetadataManifest({ appDirectory });
      console.log(`[ultramodern] Route metadata manifest generated: ${label}`);
    } else {
      await plugin.generateTanstackRouteArtifacts({ appDirectory });
      console.log(`[ultramodern] TanStack route artifacts generated: ${label}`);
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`[ultramodern] TanStack route generation failed: ${label}`);
    let current: unknown = error;
    let depth = 0;
    while (current) {
      const detail =
        current instanceof Error
          ? (current.stack ?? `${current.name}: ${current.message}`)
          : String(current);
      console.error(`${depth === 0 ? '-' : '  caused by:'} ${detail}`);
      current = current instanceof Error ? current.cause : undefined;
      depth += 1;
    }
  }
}

void main();
