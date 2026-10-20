import { couchApp } from "./session/native-context";

// Electron's console-message event turns a logged DOMException into
// "[object DOMException]". Format it before that boundary; Main still redacts
// and bounds the diagnostic. Leave other arguments and error reporting intact.
if (couchApp) {
  const error = console.error.bind(console);
  console.error = (...values: unknown[]) => error(...values.map(value => {
    if (!(value instanceof DOMException)) return value;
    const stack = "stack" in value && typeof value.stack === "string" ? `\n${value.stack}` : "";
    return `${value.name}: ${value.message}${stack}`;
  }));
}
