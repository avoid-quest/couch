import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { ProviderPage } from "../sections/find/ProviderPage";
import { readCollectionSearch } from "../collection-pagination";

export const Route = createFileRoute("/collection")({ validateSearch: readCollectionSearch, search: { middlewares: [stripSearchParams({ cursors: [], page: 1, filter: "" })] }, component: ProviderPage });
