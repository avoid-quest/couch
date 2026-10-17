import { useId, type ComponentProps } from "react";

/**
 * Couch's mark, the drawing inside packaging/icons/icon.svg without its black tile, in currentColor. Its cuts are a
 * mask rather than black strokes, so it sits on any ground. Strokes take the favicon's small-size weight.
 */
export function CouchMark(props: ComponentProps<"svg">) {
  const cuts = useId();
  return <svg viewBox="20 40 175 132" fill="currentColor" aria-hidden="true" {...props}>
    <mask id={cuts}><rect x="0" y="0" width="200" height="200" fill="#fff" /><path d="M46 94h108M70 118h106" stroke="#000" strokeWidth="3" /></mask>
    <g mask={`url(#${CSS.escape(cuts)})`}>
      <path d="M40 100a60 60 0 0 1 120 0ZM185 112a60 60 0 0 1-120 0Z" />
      <path d="M20 94h160M45 118h150" stroke="currentColor" strokeWidth="3" />
    </g>
  </svg>;
}
