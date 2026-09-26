import "./dom";
import { afterEach, expect, jest, mock } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import type { QueryClient as QueryClientType } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Window } from "happy-dom";

declare module "bun:test" {
  interface Matchers<T> extends Omit<TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, void>, "toBeEmpty"> {}
}
// Bun can evaluate static CommonJS dependencies before the DOM setup module.
// Load these after registration so React and semantic queries capture this realm.
const { default: _default, toBeEmpty: _toBeEmpty, ...matchers } = await import("@testing-library/jest-dom/matchers");
expect.extend(matchers);

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
export const { act, cleanup, render, screen, fireEvent, waitFor, within, renderHook } = await import("@testing-library/react/pure");
export const { default: userEvent } = await import("@testing-library/user-event");
export const testWindow = window as unknown as Window;
const clients = new Set<QueryClientType>();

export function createTestQueryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.add(client);
  return client;
}

export function renderWithQueryClient(ui: ReactNode, client = createTestQueryClient()) {
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

// Register in the test file: Bun reruns files without re-evaluating imports.
export function setupUiTests() {
  afterEach(async () => {
    jest.useRealTimers();
    cleanup();
    for (const client of clients) client.clear();
    clients.clear();
    // Radix restores focus in a zero-delay timeout after unmount. Let that turn
    // finish before aborting remaining component timers. Waiting for every task
    // would also wait on unrelated long-lived work such as download URL expiry.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await testWindow.happyDOM.abort();
    mock.restore();
    localStorage.clear();
    sessionStorage.clear();
    testWindow.happyDOM.setURL("http://localhost");
    for (const key of ["__COUCH_NATIVE_HOST__", "__COUCH_TV_PRESENTATION__", "__TAURI_INTERNALS__"]) Reflect.deleteProperty(window, key);
  });
}
