// PROTOTYPE, throwaway: what the TV rests on when nothing plays (prototype-tv-feel.tsx).
import { createFileRoute } from "@tanstack/react-router";
import { PrototypeRest } from "../sections/now/prototype-tv-feel";

export const Route = createFileRoute("/prototype-rest")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "A",
  }),
  component: function Rest() {
    const { variant } = Route.useSearch();
    return <PrototypeRest variant={variant} />;
  },
});
