import { join } from "node:path";
import { Arch, type AfterPackContext } from "electron-builder";
import { buildAirPlay } from "./build-airplay.ts";
import { buildRelay } from "./build-relay.ts";
import { buildQuickJS } from "./build-quickjs.ts";

// afterPack runs before signing, and once for each platform/architecture.
export default async function afterPack(context: AfterPackContext) {
  const resources = context.packager.getResourcesDir(context.appOutDir);
  await buildRelay(context.electronPlatformName, Arch[context.arch], join(resources, "live-relay"));
  await buildAirPlay(context.electronPlatformName, Arch[context.arch], join(resources, "airplay"));
  await buildQuickJS(context.electronPlatformName, Arch[context.arch], join(resources, "quickjs"));
}
