export const interfaceSizes = [
  { value: 1, label: "Default" },
  { value: 1.15, label: "Larger" },
  { value: 1.3, label: "Largest" },
] as const;
export type InterfaceSize = typeof interfaceSizes[number]["value"];
export const isInterfaceSize = (value: unknown): value is InterfaceSize => interfaceSizes.some(size => size.value === value);
export type TvAppearance = {
  size: InterfaceSize;
  confirmedSize: InterfaceSize;
  preview: { id: string; expiresAt: number } | null;
};
export const defaultTvAppearance: TvAppearance = { size: 1, confirmedSize: 1, preview: null };
