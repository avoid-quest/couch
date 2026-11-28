import {
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
} from "electron";
import { trayLabelLength, type TrayAction, type TrayStatus } from "../src/shared/app-bridge";
import type { UpdateState } from "../src/shared/updates";

type Options = {
  icon: NativeImage;
  open(): void;
  /** Opens Couch and asks its page to do this. */
  act(action: TrayAction): void;
  updates(): UpdateState;
  checkForUpdates(): void;
  restartToUpdate(): void;
  quit(): void;
};

// The tray, outside the TV: the Couch the window shows, its pages, what this computer shares, updates and Quit. What
// plays, and its controls, are the system's Now Playing (src/client/session/media-session.ts).
export function createTray(options: Options) {
  const tray = new Tray(options.icon);
  const sharingIcon = withDot(options.icon);
  let status: TrayStatus | null = null;
  const render = () => {
    tray.setImage(status?.sharing ? sharingIcon : options.icon);
    tray.setToolTip(status?.sharing ?? "Couch");
    // Linux shows a changed menu only when it is set again.
    tray.setContextMenu(Menu.buildFromTemplate(menu(status, options)));
  };
  render();
  if (process.platform !== "darwin") tray.on("click", options.open);
  return {
    /** The page's status; null while no Couch page reports one. */
    show(next: TrayStatus | null) {
      status = next;
      render();
    },
    render,
  };
}

function menu(status: TrayStatus | null, options: Options): MenuItemConstructorOptions[] {
  const separator = { type: "separator" } as const;
  return [
    ...(status
      ? [
          { label: status.couch, enabled: false },
          {
            label: `${status.connection} · Share on network ${status.network ? "on" : "off"}`,
            enabled: false,
          },
          separator,
        ]
      : []),
    { label: "Open Couch", click: options.open },
    ...(status?.pair ? [{ label: "Pair a device…", click: () => options.act("pair") }] : []),
    { label: "Settings…", click: () => options.act("settings") },
    ...(status?.sharing
      ? [
          separator,
          { label: status.sharing, enabled: false },
          { label: "Stop sharing", click: () => options.act("stop-sharing") },
        ]
      : []),
    separator,
    updateItem(options),
    separator,
    { label: "Quit Couch", click: options.quit },
  ];
}

function updateItem(options: Options): MenuItemConstructorOptions {
  const state = options.updates();
  if (state.status === "checking") return { label: "Checking for updates…", enabled: false };
  if (state.status === "downloading")
    return {
      label: `Downloading update${state.progress === null ? "" : ` (${state.progress}%)`}…`,
      enabled: false,
    };
  if (state.status === "installing") return { label: "Installing update…", enabled: false };
  if (state.status === "ready" && state.available)
    return { label: `Restart to update to ${state.available}`, click: options.restartToUpdate };
  return { label: "Check for updates", click: options.checkForUpdates };
}

/** Is it a status a page may give the tray: short labels only, since another Couch's page may send it. */
export function isTrayStatus(value: unknown): value is TrayStatus {
  const status = value as TrayStatus;
  const label = (text: unknown) => typeof text === "string" && text.length <= trayLabelLength;
  return (
    !!value &&
    typeof value === "object" &&
    label(status.couch) &&
    label(status.connection) &&
    typeof status.network === "boolean" &&
    (status.sharing === null || label(status.sharing)) &&
    typeof status.pair === "boolean"
  );
}

// While this computer shares, the icon carries a dot in its lower corner, apart from the mark: black in the macOS
// template, which the menu bar tints like the mark, and red elsewhere, as a recording light.
function withDot(icon: NativeImage) {
  const scaleFactor = icon.getScaleFactors().at(-1) ?? 1;
  const size = icon.getSize();
  const width = Math.round(size.width * scaleFactor),
    height = Math.round(size.height * scaleFactor);
  // Premultiplied BGRA.
  const pixels = Buffer.from(icon.toBitmap({ scaleFactor }));
  const template = icon.isTemplateImage();
  const colour = template ? [0, 0, 0] : [0x3b, 0x30, 0xff];
  const radius = width * 0.17,
    gap = width * 0.06;
  const coverage = (edge: number, distance: number) =>
    Math.min(1, Math.max(0, edge + 0.5 - distance));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - (width - radius), y + 0.5 - (height - radius));
      const cleared = coverage(radius + gap, distance),
        dot = coverage(radius, distance);
      if (!cleared) continue;
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++)
        pixels[at + channel] =
          pixels[at + channel]! * (1 - cleared) + (channel < 3 ? colour[channel]! : 255) * dot;
    }
  const image = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor });
  image.setTemplateImage(template);
  return image;
}
