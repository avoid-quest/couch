// Only these ordinary TV fields accept phone text. Core owns their labels and limits.
export const remoteFields = {
  find: { label: "Search title or link", maxLength: 4096, submit: true },
  "device-name": { label: "Device name", maxLength: 60, submit: true },
} as const;
export type RemoteFieldKind = keyof typeof remoteFields;
export type TextFocus = { kind: RemoteFieldKind; token: string; value: string };
export type RemoteTextField = TextFocus & { label: string; maxLength: number; submit: boolean };
export const isRemoteField = (kind: unknown): kind is RemoteFieldKind => typeof kind === "string" && Object.hasOwn(remoteFields, kind);
