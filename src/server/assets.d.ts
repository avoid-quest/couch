declare module "*.py" { const source: string; export default source; }
// Imported `with { type: "file" }`: a path the bundle emits beside itself.
declare module "*.wasm" { const path: string; export default path; }
// opusscript's Emscripten build, loaded with its binary passed in (live-transport.ts).
declare module "opusscript/build/opusscript_native_wasm.js" {
  type Handler = { _encode(input: number, bytes: number, output: number, frames: number): number; _encoder_ctl(request: number, value: number): number };
  const factory: (module: { wasmBinary: Uint8Array }) => { OpusScriptHandler: { new (rate: number, channels: number, application: number): Handler; destroy_handler(handler: Handler): void }; _malloc(bytes: number): number; _free(pointer: number): void; HEAPU8: Uint8Array; HEAPU16: Uint16Array; HEAP32: Int32Array };
  export default factory;
}
