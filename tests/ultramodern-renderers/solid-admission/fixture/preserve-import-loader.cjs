module.exports = function (source) {
  const babel = require(this.getOptions().babelPath ?? '@babel/core');
  let matched = 0;
  const result = babel.transformSync(source, {
    filename: this.resourcePath,
    configFile: false,
    babelrc: false,
    plugins: [
      () => ({
        visitor: {
          CallExpression(path) {
            if (
              path.node.callee.type === 'Import' &&
              path.node.arguments[0]?.type === 'Identifier' &&
              path.node.arguments[0].name === 'entryUrl'
            ) {
              path.node.arguments[0].leadingComments = [
                { type: 'CommentBlock', value: ' webpackIgnore: true ' },
              ];
              matched++;
            }
          },
        },
      }),
    ],
  });
  if (matched !== 1)
    throw new Error('Solid rc13 native URL import contract changed');
  return result.code;
};
