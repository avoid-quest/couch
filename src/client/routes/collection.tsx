import { createFileRoute, retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { ProviderPage } from "../sections/find/ProviderPage";
import { readCollectionSearch } from "../collection-pagination";

// `from` names the section the page opened in; moving between details, pages and filters keeps it.
export const Route = createFileRoute("/collection")({ validateSearch: readCollectionSearch, search: { middlewares: [retainSearchParams(["from"]), stripSearchParams({ cursors: [], page: 1, filter: "" })] }, component: ProviderPage });
