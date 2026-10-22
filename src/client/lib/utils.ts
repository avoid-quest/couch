import { createCn } from "cn/config"

// cn, told Couch's own scales (index.css), so `text-meta` merges with sizes, not colours, and `h-control` with heights.
export const cn = createCn({ extend: {
  theme: { spacing: ["control-sm", "control", "control-lg", "field", "caption", "stack", "item", "section"] },
  classGroups: { "font-size": [{ text: ["caption", "meta", "body", "heading", "page"] }] },
} })
