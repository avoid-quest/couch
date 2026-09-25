import { getQueriesForElement } from "@testing-library/dom";

// Semantic test queries. Tests describe what a user perceives (roles, names,
// text) instead of scraping the DOM, so refactors like swapping a wrapper
// element stop breaking assertions. The happy-dom document only exists after
// the test's beforeEach installs it, so resolve queries lazily per call.
export const screen = new Proxy({} as ReturnType<typeof getQueriesForElement>, {
  get: (_target, property) => Reflect.get(getQueriesForElement(document.body), property),
});
export { fireEvent, getByLabelText, getByRole, getByText, queryByRole, queryByText, within } from "@testing-library/dom";

