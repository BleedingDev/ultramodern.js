import { i18n, localeKeys } from '../locale';
import { readCreatePackageJson } from './package-source';

export function showVersion() {
  const createPackage = readCreatePackageJson();
  const name = createPackage.name || '@modern-js/create';
  const version = createPackage.version || 'unknown';
  console.log(i18n.t(localeKeys.version.message, { name, version }));
  process.exit(0);
}

export function showHelp() {
  console.log(i18n.t(localeKeys.help.title));
  console.log(i18n.t(localeKeys.help.description));
  console.log('');
  console.log(i18n.t(localeKeys.help.usage));
  console.log(i18n.t(localeKeys.help.usageExample));
  console.log('');
  console.log(i18n.t(localeKeys.help.options));
  console.log(i18n.t(localeKeys.help.optionHelp));
  console.log(i18n.t(localeKeys.help.optionVersion));
  console.log(i18n.t(localeKeys.help.optionLang));
  console.log(i18n.t(localeKeys.help.optionTailwind));
  console.log(i18n.t(localeKeys.help.optionBff));
  console.log(i18n.t(localeKeys.help.optionBffRuntime));
  console.log(i18n.t(localeKeys.help.optionWorkspace));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageSource));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageVersion));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageRegistry));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageScope));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageNamePrefix));
  console.log(i18n.t(localeKeys.help.optionBridge));
  console.log(i18n.t(localeKeys.help.optionBridgeParentRoot));
  console.log(i18n.t(localeKeys.help.optionBridgeWorkspacePackage));
  console.log(i18n.t(localeKeys.help.optionBridgeWorkspacePackageName));
  console.log(i18n.t(localeKeys.help.optionBridgeTestAlias));
  console.log(i18n.t(localeKeys.help.optionBridgeDependency));
  console.log(i18n.t(localeKeys.help.optionBridgeLockfilePolicy));
  console.log(i18n.t(localeKeys.help.optionBridgeGate));
  console.log(i18n.t(localeKeys.help.optionBridgeGateCwd));
  console.log(i18n.t(localeKeys.help.optionBridgeReactSingleton));
  console.log(i18n.t(localeKeys.help.optionVertical));
  console.log(i18n.t(localeKeys.help.optionVerticalName));
  console.log(i18n.t(localeKeys.help.optionDryRun));
  console.log(i18n.t(localeKeys.help.optionCodeSmithOverlay));
  console.log('');
  console.log(i18n.t(localeKeys.help.examples));
  console.log(i18n.t(localeKeys.help.example1));
  console.log(i18n.t(localeKeys.help.example2));
  console.log(i18n.t(localeKeys.help.example3));
  console.log(i18n.t(localeKeys.help.example4));
  console.log(i18n.t(localeKeys.help.example5));
  console.log(i18n.t(localeKeys.help.example6));
  console.log(i18n.t(localeKeys.help.example7));
  console.log(i18n.t(localeKeys.help.example8));
  console.log(i18n.t(localeKeys.help.example9));
  console.log(i18n.t(localeKeys.help.example10));
  console.log('');
  console.log(i18n.t(localeKeys.help.moreInfo));
  console.log('');
  process.exit(0);
}
