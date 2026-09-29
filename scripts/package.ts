import { version } from "../package.json";

// Packages the app with electron-builder, passing the arguments through
// (`bun run package --mac zip --arm64`). The version decides the channel: a
// -preview.N version builds Couch Preview, with its own name, icons and update
// files (preview-*.yml); any other version builds Couch (latest-*.yml). Both
// keep Couch's appId and data directory, so only one of them runs at a time.
const preview = /-preview\.\d+$/.test(version) ? [
  "-c.productName=Couch Preview",
  "-c.publish.channel=preview",
  "-c.mac.icon=packaging/icons/preview/icon.icns",
  "-c.win.icon=packaging/icons/preview/icon.ico",
  "-c.linux.icon=packaging/icons/preview/icon.png",
  // The window and tray icon, which app/main.ts reads from the packaged package.json.
  "-c.extraMetadata.icon=packaging/icons/preview/icon.png",
] : [];
const builder = Bun.spawn(["electron-builder", "--publish", "never", ...preview, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await builder.exited);
