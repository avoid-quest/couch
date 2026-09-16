export const pairingCodeFromHash = (hash: string) => /^#pair=(\d{6})$/.exec(hash)?.[1] ?? "";
