import { Fragment } from "react";
import { searchLocation } from "@/search";
import { ContentLink } from "./ContentLink";

/** Names (a show's styles, its host) in one comma-joined line, each a link that searches everything for it. */
export function SearchNames({ names }: { names: readonly string[] }) {
  return [...new Set(names)].map((name, index) => (
    <Fragment key={name}>
      {index > 0 && ", "}
      <ContentLink
        href={searchLocation({ query: name, source: "All" })}
        title={`Search for ${name}`}
        className="touch:inline-flex touch:min-h-11 touch:items-center"
      >
        {name}
      </ContentLink>
    </Fragment>
  ));
}
