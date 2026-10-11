const path = require('path');
const fs = require('fs');

const findPackage = cwd => {
  let current = path.resolve(cwd || process.cwd());
  const { root } = path.parse(current);

  while (true) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      return packagePath;
    }
    if (current === root) {
      return null;
    }
    current = path.dirname(current);
  }
};

const pkgUp = async options => findPackage(options && options.cwd);

pkgUp.sync = options => findPackage(options && options.cwd);

module.exports = pkgUp;
