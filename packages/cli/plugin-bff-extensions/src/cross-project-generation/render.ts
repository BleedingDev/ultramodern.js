export const renderProducerRuntimeDefaults = (requestIdValue: string) => `{
      requestId: ${requestIdValue},
      requireEnvelope: true,
      identityBinding: {
        enabled: true,
        strict: true,
      },
      operationContract: {
        enabled: true,
        strict: true,
        requireSchemaHash: true,
        requireOperationVersion: true,
      },
    }`;
