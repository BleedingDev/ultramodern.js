const path = require('node:path');

const scenario = process.argv[2];
const serverPath = process.argv[3];
const clientPath = process.argv[4];
let moduleLoads = 0;

global.__webpack_chunk_load__ = async () => {};
global.__webpack_require__ = () => {
  moduleLoads += 1;
  return {
    action(formData) {
      return formData;
    },
  };
};
global.__rspack_rsc_hot_reloader__ = { on: () => () => {} };
global.__rspack_rsc_manifest__ = {
  clientManifest: {},
  entryCssFiles: {},
  entryJsFiles: [],
  moduleLoading: { prefix: '', crossOrigin: '' },
  serverConsumerModuleMap: {},
  serverManifest: Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `action-${index}`,
      { id: 'server-module', chunks: [], name: 'action' },
    ]),
  ),
};

let mapArrayConstructions = 0;
if (scenario === 'cycle') {
  const NativeMap = Map;
  global.Map = class CountedMap extends NativeMap {
    constructor(iterable) {
      if (Array.isArray(iterable)) {
        mapArrayConstructions += 1;
      }
      super(iterable);
    }
  };
}

const server = require(path.resolve(serverPath));

function output(value) {
  process.stdout.write(JSON.stringify(value), () => process.exit(0));
}

async function main() {
  switch (scenario) {
    case 'cycle': {
      const body = new FormData();
      body.set(
        '0',
        JSON.stringify([
          ...Array.from({ length: 8 }, (_, index) => [`key-${index}`, index]),
          ...Array.from({ length: 8 }, () => '$Q0'),
        ]),
      );
      let error;
      try {
        await server.decodeReply(body);
      } catch (caught) {
        error = caught;
      }
      output({ mapArrayConstructions, rejected: error instanceof Error });
      return;
    }
    case 'referenced-form-data': {
      const body = new FormData();
      body.append('_1_item', 'first');
      body.append('_2_item', 'second');
      body.append('0', JSON.stringify(['$K1', '$K2']));
      let keyIterations = 0;
      const originalKeys = body.keys.bind(body);
      body.keys = () => {
        keyIterations += 1;
        return originalKeys();
      };
      const decoded = await server.decodeReply(body);
      output({
        keyIterations,
        values: decoded.map(value => value.get('item')),
      });
      return;
    }
    case 'blob-type': {
      const body = new FormData();
      body.set('1', 'not-a-blob');
      body.set('0', JSON.stringify('$B1'));
      let error;
      try {
        await server.decodeReply(body);
      } catch (caught) {
        error = caught;
      }
      output({
        rejected: error instanceof Error,
        returnedString: error === undefined,
      });
      return;
    }
    case 'async-iterator': {
      let throwCalls = 0;
      const reason = new Error('iterator failed');
      const iterator = {
        next: () => Promise.reject(reason),
        throw: () => {
          throwCalls += 1;
          return throwCalls < 6
            ? Promise.reject(reason)
            : {
                // biome-ignore lint/suspicious/noThenProperty: The regression requires a deliberately pending thenable to bound the vulnerable recursion.
                then: () => {},
              };
        },
      };
      const iterable = { [Symbol.asyncIterator]: () => iterator };
      try {
        await server.decodeReplyFromAsyncIterable(iterable);
      } catch {}
      await new Promise(resolve => setImmediate(resolve));
      output({ throwCalls });
      return;
    }
    case 'action-load': {
      const body = new FormData();
      for (let index = 0; index < 8; index += 1) {
        body.append(`$ACTION_ID_action-${index}`, '');
      }
      const action = await server.decodeAction(body);
      if (action === null) {
        throw new Error('Expected an action');
      }
      const submitted = await action();
      output({
        moduleLoads,
        submittedEntries: Array.from(submitted.entries()),
      });
      return;
    }
    case 'form-data-roundtrip': {
      const client = require(path.resolve(clientPath));
      const nested = new FormData();
      nested.append('item', 'first');
      nested.append('item', 'second');
      const encoded = await client.encodeReply({ nested });
      const decoded = await server.decodeReply(encoded);
      output({ values: decoded.nested.getAll('item') });
      return;
    }
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
