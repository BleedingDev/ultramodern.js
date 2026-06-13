export type RsdoctorUserConfig =
  | boolean
  | {
      /**
       * Force enable / disable Rsdoctor.
       * When `performance.rsdoctor` is not configured, Rsdoctor is disabled.
       */
      enabled?: boolean;
      /**
       * Disable Rsdoctor client server and ensure build process exits after report generation.
       * @default true
       */
      disableClientServer?: boolean;
    };
