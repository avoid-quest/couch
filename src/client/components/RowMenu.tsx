import { useRef, type ReactElement, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PlayOnGroup, usePlayOn } from "./PlayOn";

/** One verb in a menu. playOn makes it "Play on", a group of the online Devices; node is its own item, such as a link. */
export type MenuAction = { label: string; disabled?: boolean; pressed?: boolean; run?: () => void; node?: ReactNode; playOn?: (deviceId: string) => void; sharingDeviceId?: string };
// Radix scopes each menu's items to its own root, so one list of verbs renders through either menu's parts.
export type MenuParts = { Item: typeof DropdownMenuItem | typeof ContextMenuItem; Group: typeof DropdownMenuGroup | typeof ContextMenuGroup; Label: typeof DropdownMenuLabel | typeof ContextMenuLabel; Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator };
const dropdown: MenuParts = { Item: DropdownMenuItem, Group: DropdownMenuGroup, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator };
const context: MenuParts = { Item: ContextMenuItem, Group: ContextMenuGroup, Label: ContextMenuLabel, Separator: ContextMenuSeparator };

// Play on waits for a second online Device, so it alone never opens an empty menu.
function useShown(actions: MenuAction[]) {
  const { devices, on } = usePlayOn();
  return { on, shown: actions.filter(action => !action.playOn || devices.length > 0) };
}

function Items({ actions, parts, on }: { actions: MenuAction[]; parts: MenuParts; on: (label: string) => string }) {
  const { Item } = parts;
  return actions.map(action => action.node ? <Item key={action.label} asChild>{action.node}</Item>
    : action.playOn ? <PlayOnGroup key={action.label} parts={parts} disabled={action.disabled} onPlay={action.playOn} sharingDeviceId={action.sharingDeviceId} />
    : <Item key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label === "Play" || action.label === "Resume" ? on(action.label) : action.label}</Item>);
}

/** A visible "…" (Options) for verbs: Details' rest, and a TV row whose page doesn't hold its verbs, since a remote can't open a context menu. */
export function OptionsMenu({ title, actions, size = "icon" }: { title: string; actions: MenuAction[]; size?: "icon" | "icon-lg" }) {
  const { shown, on } = useShown(actions);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!shown.length) return null;
  // Focus stays on the trigger while it's open, and a trigger whose row went away (Remove) isn't refocused.
  return <DropdownMenu modal={false} onOpenChange={open => { if (open) trigger.current?.focus(); }}>
    <DropdownMenuTrigger asChild><Button ref={trigger} data-row-options variant="ghost" size={size} aria-label={`Options for ${title}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (!trigger.current?.isConnected) event.preventDefault(); }}><Items actions={shown} parts={dropdown} on={on} /></DropdownMenuContent>
  </DropdownMenu>;
}

/** A row's other verbs, on right-click or a long press: a row is one target, so its main verb is its press. */
export function RowContextMenu({ actions, children }: { actions: MenuAction[]; children: ReactElement }) {
  const { shown, on } = useShown(actions);
  if (!shown.length) return children;
  return <ContextMenu><ContextMenuTrigger asChild>{children}</ContextMenuTrigger><ContextMenuContent><Items actions={shown} parts={context} on={on} /></ContextMenuContent></ContextMenu>;
}
