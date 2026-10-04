import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTopologyDeliveryUnit } from '@modern-js/app-tools-extensions/cloudflare/delivery-unit';
import { resolveRendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import type { Renderer } from '@modern-js/renderer-core';
import type { NativeInfrastructureOptions } from './native-infrastructure';
import { reactObservedInputFiles } from './react-authored-inputs';
import { readRendererFrameworkPackage } from './renderer-installed-profile';
import {
  resolveRendererProfileMetadata,
  resolveRendererRouterFrameworks,
} from './renderer-profile';
import {
  type RendererRegistration,
  resolveRendererRegistration,
} from './renderer-registration';
import { resolveEntrypointRouterBindings } from './renderer-router-resolution';

/** Bind selected renderer metadata to the actual app and framework inputs. */
export function createRendererBuildIdentityResolver(
  renderer: Renderer,
): NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']> {
  return async context => {
    const generatedOutputs = context.generatedOutputs;
    const assertEpochCurrent = () => {
      if (context.generatedOutputs !== generatedOutputs)
        throw new Error('Renderer generated-output input view changed');
      generatedOutputs?.assertEpochCurrent();
    };
    await generatedOutputs?.assertCurrent();
    assertEpochCurrent();
    const registrar = path.dirname(fileURLToPath(import.meta.url));
    const metadata = resolveRendererProfileMetadata(renderer);
    const frameworkPackages = [...metadata.frameworkPackages];
    assertEpochCurrent();
    const routerBindings = await resolveEntrypointRouterBindings(
      renderer,
      context.entrypoints,
      context.pluginNames ?? [],
      metadata,
    );
    assertEpochCurrent();
    const registration: RendererRegistration =
      resolveRendererRegistration(renderer);
    const buildFrameworkModules = registration.resolveBuildFrameworkModules?.({
      appDirectory: context.appDirectory,
      registrarDirectory: registrar,
      pluginNames: context.pluginNames ?? [],
    });
    frameworkPackages.push(
      ...(buildFrameworkModules ?? []).map(readRendererFrameworkPackage),
    );
    assertEpochCurrent();
    const delivery = await resolveTopologyDeliveryUnit(context.appDirectory);
    assertEpochCurrent();
    if (delivery && !delivery.surfaces.ui)
      throw new Error(
        'A renderer UI build requires the authoritative UI delivery surface app identity',
      );
    assertEpochCurrent();
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(context.appDirectory, 'package.json'),
        'utf8',
      ),
    );
    assertEpochCurrent();
    const { source, output, server, html, bff, deploy, experiments } =
      context.config;
    const router =
      'router' in context.config ? context.config.router : undefined;
    assertEpochCurrent();
    const inputFiles = [
      ...new Set([
        ...reactObservedInputFiles(context),
        ...(context.inputFiles ?? []).filter(
          filename => !filename.split(path.sep).includes('node_modules'),
        ),
      ]),
    ];
    const identities = await resolveRendererBuildIdentities({
      generatedOutputs,
      inputFiles,
      projectRoot: context.appDirectory,
      renderer,
      profile: metadata.profile,
      routerBindings,
      routerFrameworks: resolveRendererRouterFrameworks(renderer),
      entryNames: context.entrypoints.map(entrypoint => entrypoint.entryName),
      mode:
        context.mode ??
        (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      packageName: manifest.name,
      ...(delivery
        ? {
            deliveryUnit: {
              ...delivery,
              appId: delivery.surfaces.ui!.rendererIdentity.appId,
            },
          }
        : {}),
      excludedDirectories: [context.internalDirectory, context.distDirectory],
      configuration: JSON.parse(
        JSON.stringify({
          source,
          output,
          server,
          html,
          router,
          bff,
          deploy,
          experiments,
        }),
      ),
      packageResolutionRoots: [
        registrar,
        ...frameworkPackages.map(owner => owner.directory),
      ],
      frameworkPackages: frameworkPackages.map(owner => owner.name),
      frameworkPackageBindings: frameworkPackages,
    });
    assertEpochCurrent();
    await generatedOutputs?.assertCurrent();
    assertEpochCurrent();
    return identities;
  };
}
