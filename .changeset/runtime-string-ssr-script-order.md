---
'@modern-js/runtime': patch
---

Emit the SSR data and router hydration scripts before the entry script in
string-mode SSR, matching the guarantee streaming SSR already had. Previously
`createReplaceSSRDataScript` used a plain placeholder replacement, so
`window._SSR_DATA` and the router bootstrap (including TanStack Router's
`$_TSR`) landed wherever the HTML template put the placeholder — typically
*after* the entry bundle's `<script>` tag. Measured on the TanStack SSR fixture
the string entry preceded the bootstrap by ~1KB; it only worked because the
entry chunk is `async` and the buffered document parses faster than the fetch.
When that ordering does invert, hydration detection reads `$_TSR` as absent, the
router renders unhydrated and React discards the server markup with error #418.
String mode now routes the block through the same `injectBeforeHydrationEntryScript`
path streaming mode uses, and falls back to the previous in-place replacement
when no entry script tag is present (custom HTML templates, Module Federation
host shells). Templates with NO entry script tag are byte-identical; every other
template's script ordering changes by design — the SSR data and router bootstrap
block moves out of the placeholder position to in front of the entry tag, which
in the common head-script layout places it above the rendered `<div id="root">`.

在字符串模式 SSR 中，将 SSR 数据与路由 hydration 脚本提前到入口脚本之前输出，与流式 SSR
已有的顺序保证保持一致。此前 `createReplaceSSRDataScript` 只做简单的占位符替换，
`window._SSR_DATA` 与路由 bootstrap（包含 TanStack Router 的 `$_TSR`）会停留在 HTML
模板中占位符所在的位置，通常在入口 bundle 的 `<script>` 标签之后。在 TanStack SSR 用例中
实测入口脚本比 bootstrap 早约 1KB，之前能正常工作仅仅是因为入口 chunk 是 `async`、
文档解析快于网络请求。一旦顺序反转，hydration 检测会认为 `$_TSR` 不存在，路由将以未 hydrate
的形式渲染，React 随即以 #418 丢弃服务端标记。现在字符串模式复用流式模式的
`injectBeforeHydrationEntryScript`，并在找不到入口脚本标签时（自定义 HTML 模板、
Module Federation 宿主）退回原有的就地替换。**没有**入口脚本标签的模板输出逐字节不变；
其余模板的脚本顺序会按设计发生变化——SSR 数据与路由 bootstrap 会从占位符位置移动到入口
脚本标签之前，在常见的 head 脚本布局下会位于渲染出的 `<div id="root">` 之上。
