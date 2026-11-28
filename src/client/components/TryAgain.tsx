import type { ComponentProps } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRY_AGAIN } from "@/copy";

/** A problem's one action, the same everywhere (docs/design.md "Problems"). */
export function TryAgain(props: Omit<ComponentProps<typeof Button>, "variant" | "children">) {
  return (
    <Button variant="secondary" size="sm" {...props}>
      <RotateCw aria-hidden="true" />
      {TRY_AGAIN}
    </Button>
  );
}
