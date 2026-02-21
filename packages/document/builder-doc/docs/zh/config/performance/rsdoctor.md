- **类型：** `boolean | { enabled?: boolean; disableClientServer?: boolean }`
- **默认值：** 生产构建默认开启，开发构建默认关闭

用于配置 [Rsdoctor](https://rsdoctor.dev/) 构建诊断。

- 该配置仅在使用 Rspack provider 时生效。
- `disableClientServer` 默认值为 `true`，用于避免报告生成后构建进程不退出。

### 示例

```js
export default {
  performance: {
    rsdoctor: {
      enabled: true,
      disableClientServer: true,
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
