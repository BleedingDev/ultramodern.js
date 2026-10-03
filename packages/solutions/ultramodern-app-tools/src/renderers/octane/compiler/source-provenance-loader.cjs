const { createHash } = require('node:crypto');
const fs = require('node:fs');

/** Authenticate the exact unmodified bytes entering the native compiler. */
module.exports = function sourceProvenance(source, sourceMap) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const diskSha256 = createHash('sha256')
    .update(fs.readFileSync(this.resourcePath))
    .digest('hex');
  if (sourceSha256 !== diskSha256) {
    throw new Error(
      `Octane source was transformed before its native compiler: ${this.resourcePath}`,
    );
  }
  this._module.buildInfo.ultramodernOctaneSourceSha256 = sourceSha256;
  this.callback(null, source, sourceMap);
};
module.exports.raw = true;
