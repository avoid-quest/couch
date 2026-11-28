/** A device's Picture and Sound in a Group. */
export type GroupMember = { deviceId: string; picture: boolean; sound: boolean };
/** A Group (GLOSSARY.md): a name and the Picture and Sound it chooses on each device, kept by the host for the whole Couch. */
export type MixerGroup = { id: string; name: string; members: GroupMember[] };
