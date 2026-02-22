- **类型：** `boolean | { enabled?: boolean; disableClientServer?: boolean; reportDir?: string; mode?: 'normal' | 'brief' | 'lite' }`
- **默认值：** 生产构建默认开启，开发构建默认关闭

用于配置 [Rsdoctor](https://rsdoctor.dev/) 构建诊断。

- 该配置仅在使用 Rspack provider 时生效。
- `disableClientServer` 默认值为 `true`，用于避免报告生成后构建进程不退出。
- `reportDir` 可将诊断产物输出到确定的目录。
- `mode` 用于控制 RsDoctor 报告模式（`normal`、`brief`、`lite`）。
- Modern.js 会额外生成机器可读诊断契约文件：
  - `<reportDir 或 outputPath>/.rsdoctor/ultramodern-diagnostics.json`
  - 该文件可指向 `.rsdoctor/manifest.json`，便于开发者工具与编码代理稳定消费。

### 示例

```js
export default {
  performance: {
    rsdoctor: {
      enabled: true,
      disableClientServer: true,
      reportDir: './artifacts',
      mode: 'brief',
    },
  },
};
```

也可以直接使用布尔值：

```js
export default {
  performance: {
    rsdoctor: false,
  },
};
```
