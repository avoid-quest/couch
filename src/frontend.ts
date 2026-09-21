// Source-mode Bun development only. The production builder replaces this
// module with responses backed by the exact files emitted into dist by Vite.
import frontend from "./client/index.html";
export default frontend;
export const assets: Record<string, Response> = {};
