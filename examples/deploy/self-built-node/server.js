const Koa = require('koa');
const fs = require('node:fs');
const path = require('node:path');
const mime = require('mime-types');

const app = new Koa();
app.use(async (ctx, _next) => {
  if (ctx.path.startsWith('/static')) {
    const contentType = mime.lookup(ctx.path);
    ctx.type = contentType;
    ctx.body = fs.createReadStream(
      path.resolve(__dirname, `.output${ctx.path}`),
    );
  } else {
    ctx.type = 'html';
    ctx.body = fs.createReadStream(
      path.resolve(__dirname, '.output/html/index/index.html'),
    );
  }
});
app.listen(process.env.PORT || 8080);
