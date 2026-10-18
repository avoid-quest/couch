import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import { ItemPage, readItemSearch } from "../sections/details/ItemPage";

// `from` names the section the page opened in; moving between details keeps it.
export const Route = createFileRoute("/item")({ validateSearch: readItemSearch, search: { middlewares: [retainSearchParams(["from"])] }, component: ItemPage });
