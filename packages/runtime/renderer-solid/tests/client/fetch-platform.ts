// The DOM test realm must use one Fetch platform. Rstest retains some Node
// globals by default, while happy-dom's Request/Response use its Window classes.
// Mixing those real classes loses headers and prevents native FormData(form).
// Rstest aliases `window` to its global proxy, so use the public Window factory
// to obtain the platform's actual constructors, rather than proxy-retained Node
// constructors. The DOM controls share the same native happy-dom class library.
const platform = new window.Window() as Window & typeof globalThis;
Object.assign(globalThis, {
  fetch: platform.fetch.bind(platform),
  Request: platform.Request,
  Response: platform.Response,
  Headers: platform.Headers,
  FormData: platform.FormData,
  File: platform.File,
  Blob: platform.Blob,
  AbortController: platform.AbortController,
  AbortSignal: platform.AbortSignal,
  DOMException: platform.DOMException,
});

afterAll(() => platform.close());
