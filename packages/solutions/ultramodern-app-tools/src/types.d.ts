/// <reference types="@rsbuild/core/types" />

/**
 * A renderer-native SVG component (Solid or Octane), compiled by the selected
 * renderer. Root SVG attributes are defaults; props such as `class`, `style`
 * and `ref` are applied on the root `<svg>` element.
 */
declare module '*.svg?component' {
  const SvgComponent: (props: {
    readonly [name: string]: unknown;
  }) => SVGSVGElement;
  export default SvgComponent;
}
