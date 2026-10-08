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
    if (mode === 'manifest') {
      // The manifest is plain route metadata. It never loads the app config,
      // so dev and build scripts can run it before the owning CLI starts.
      const pluginUrl = pathToFileURL(
        appRequire.resolve('@modern-js/plugin-tanstack'),
      ).href;
      const { writeRouteMetadataManifest } = (await import(pluginUrl)) as {
        writeRouteMetadataManifest(options: {
          appDirectory: string;
        }): Promise<void>;
      };
      await writeRouteMetadataManifest({ appDirectory });
      console.log(`[ultramodern] Route metadata manifest generated: ${label}`);
      return;
    }
    const cliUrl = pathToFileURL(
      appRequire.resolve('@modern-js/ultramodern-app-tools/cli'),
    ).href;
    const { generateRouteArtifacts } = (await import(cliUrl)) as {
      generateRouteArtifacts(options: { appDirectory: string }): Promise<void>;
    };
    await generateRouteArtifacts({ appDirectory });
    console.log(`[ultramodern] Route artifacts generated: ${label}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`[ultramodern] Route generation failed: ${label}`);
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
