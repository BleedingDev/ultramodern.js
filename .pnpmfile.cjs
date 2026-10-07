function readPackage(pkg, _context) {
  // Fix: https://github.com/browserify/resolve/issues/264
  // `resolve >= 1.21.0` breaks dts-packer, lock the version to 1.20.0.
  if (pkg.name === 'dts-packer') {
    pkg.dependencies.resolve = '1.20.0';
  }

  if (pkg.name === 'hast-util-from-html' && pkg.version.startsWith('1.')) {
    pkg.dependencies = {
      ...pkg.dependencies,
      'vfile-message': '^3.1.2',
    };
  }

  // Rspress workspace dependencies
  if (
    (pkg.name?.startsWith('@rspress/') || pkg.name?.startsWith('rspress')) &&
    pkg.dependencies
  ) {
    pkg.dependencies = Object.fromEntries(
      Object.entries(pkg.dependencies).map(([key, value]) =>
        key.startsWith('@modern-js/') ? [key, 'workspace:*'] : [key, value],
      ),
    );
  }

  // The published generator declares the patched Module Federation sidecar
  // alias so consumer installs never pull the unpatched upstream stack. The
  // sidecar is republished from this repository's patched upstream at release
  // time, so inside the monorepo resolve the same patched upstream package.
  if (
    pkg.name === '@modern-js/ultramodern-create' &&
    pkg.dependencies?.['@module-federation/modern-js-v3']?.startsWith(
      'npm:@bleedingdev/mf-modern-js-v3@',
    )
  ) {
    pkg.dependencies['@module-federation/modern-js-v3'] = '2.9.2';
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
