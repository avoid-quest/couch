import { cn } from "@/lib/utils";

/**
 * Shift, Couch's mark (Design → Brand mark): the avoid.quest disc with its lower half moved right, set in the current
 * ink at the text's size. It stands where the header names the Couch, filled while connected and hollow while not,
 * as the status dot it replaces did. The shadcn catalog provides interface icons, not brand identities.
 */
export function CouchMark({ connected = true, className }: { connected?: boolean; className?: string }) {
  return <svg aria-hidden="true" viewBox="20 26 160 148" className={cn("size-[1em] shrink-0", className)}>
    <g transform="translate(-12.5 -6)" fill={connected ? "currentColor" : "none"} stroke="currentColor" strokeWidth={connected ? 0 : 8}>
      <path d="M40 100a60 60 0 0 1 120 0Z" />
      <path d="M185 112a60 60 0 0 1-120 0Z" />
    </g>
  </svg>;
}
