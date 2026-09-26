export type BluetoothPrompt = { id: string; kind: "pin" | "passkey" | "confirm" | "display"; value: string | null };
export type BluetoothOperation = { id: string; device: string | null; kind: string; status: "running" | "finished" | "error" | "cancelled"; endsAt: number; message: string | null; prompt: BluetoothPrompt | null };
// Adapter implementation limits, independent of permission, hardware state and operation ownership.
// Omitted/null reasons retain protocol-1 behavior; a pairing notice does not block pairing.
export type BluetoothSupport = { powerUnavailableReason?: string | null; connectUnavailableReason?: string | null; disconnectUnavailableReason?: string | null; forgetUnavailableReason?: string | null; pairingNotice?: string | null };
export type BluetoothState = { adapter: "available" | "absent" | "off" | "blocked"; devices: { address: string; name: string; paired: boolean; trusted?: boolean; connected: boolean }[]; operation: BluetoothOperation | null; support?: BluetoothSupport };
export type BluetoothAction = { op: "read" | "scan" | "power" | "pair" | "connect" | "disconnect" | "forget" | "cancel" | "answer" | "reconnect"; owner: string; device?: string; token?: string; prompt?: string; answer?: string };
