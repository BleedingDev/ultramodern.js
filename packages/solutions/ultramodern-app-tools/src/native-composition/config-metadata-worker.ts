import {
  type ConfigMetadataMessage,
  type LoadUltramodernConfigMetadataOptions,
  readUltramodernConfigMetadata,
} from './config-metadata';

// Exit with the parent; this process only serves one config load.
process.once('disconnect', () => process.exit(1));

function reply(message: ConfigMetadataMessage, exitCode: number): void {
  process.send!(message, () => process.exit(exitCode));
}

process.once('message', options => {
  readUltramodernConfigMetadata(
    options as LoadUltramodernConfigMetadataOptions,
  ).then(
    result => reply({ result }, 0),
    (value: unknown) => {
      const error = value instanceof Error ? value : new Error(String(value));
      reply({ error: { message: error.message, stack: error.stack } }, 1);
    },
  );
});
