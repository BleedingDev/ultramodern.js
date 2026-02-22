export interface MicroFrontend {
  /**
   * Specifies whether to enable the HTML entry.
   * When set to `true`, the current child application will be externalized for `react` and `react-dom`.
   * @default true
   */
  enableHtmlEntry?: boolean;
  /**
   * Specifies whether to use the external base library.
   * @default false
   */
  externalBasicLibrary?: boolean;
  moduleApp?: string;
  /**
   * Runtime compatibility digest exposed in remote contracts (manifest / remote entry).
   */
  runtimeDigest?: string;
  /**
   * SRI-style integrity token for the remote entry contract.
   * Example: `sha256-<base64Digest>`.
   */
  integrity?: string;
  /**
   * Opaque attestation token exposed in remote runtime metadata.
   * Can be validated by the host via runtime `remoteTrust.attestations`.
   */
  attestation?: string;
}

export interface DeployUserConfig {
  /**
   * Used to configure micro-frontend sub-application information.
   * @default false
   */
  microFrontend?: boolean | MicroFrontend;
  worker?: {
    ssr?: boolean;
  };
}
