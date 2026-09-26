import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { BrowserErrorCaptureEnum } from "happy-dom";

// Bun.serve accepts Bun responses, and native fetch/abort must share that realm.
const network = { fetch, Request, Response, Headers, AbortController, AbortSignal };

// Import through testing/react before React or Testing Library captures the DOM.
// Bun's isolated files keep this browser environment out of server tests.
GlobalRegistrator.register({
  url: "http://localhost",
  settings: { errorCapture: BrowserErrorCaptureEnum.disabled },
});
Object.assign(globalThis, network, { IS_REACT_ACT_ENVIRONMENT: true });
