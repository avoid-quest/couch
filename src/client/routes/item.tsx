import { createFileRoute } from "@tanstack/react-router";
import { ItemPage, readItemSearch } from "../sections/details/ItemPage";

export const Route = createFileRoute("/item")({ validateSearch: readItemSearch, component: ItemPage });
