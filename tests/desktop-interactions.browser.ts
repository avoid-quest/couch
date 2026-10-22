// Build with bun build tests/desktop-interactions.browser.ts --target browser --format iife
// and evaluate in a paired scratch Couch. Run on desktop; TV keeps its own remote checks.
declare global {
  interface Window { runDesktopInteractionsRegression: () => { name: string; passed: boolean; error?: string }[] }
}
export {};

window.runDesktopInteractionsRegression = () => {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = (name: string, run: () => void) => {
    try { run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const key = (target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event);
    return event;
  };
  check("Shift+Arrow leaves selection to the browser", () => {
    (document.activeElement as HTMLElement)?.blur();
    assert(!key(document.body, "ArrowRight", { shiftKey: true }).defaultPrevented, "Shift+Arrow was prevented");
  });
  check("Modified arrows stay native in the search field", () => {
    const input = document.querySelector<HTMLInputElement>("#media-search")!;
    assert(!!input, "Pair a scratch Couch first");
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) for (const arrow of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      input.focus();
      assert(!key(input, arrow, { [modifier]: true }).defaultPrevented && document.activeElement === input, `${modifier}+${arrow} was consumed or left search`);
    }
    input.blur();
  });
  for (const editable of ["", "true", "plaintext-only"]) check(`Editable ${JSON.stringify(editable)} keeps caret arrows`, () => {
    const field = document.createElement("div");
    field.setAttribute("contenteditable", editable);
    field.textContent = "Editable text";
    document.body.append(field);
    try {
      field.focus();
      assert(!key(field, "ArrowLeft").defaultPrevented && document.activeElement === field, "Caret key moved spatial focus");
    } finally { field.remove(); }
  });
  check("Selected prose keeps its collapse/extend arrows", () => {
    const text = document.createElement("p");
    text.textContent = "Selected text";
    document.body.append(text);
    const selection = window.getSelection()!;
    try {
      selection.selectAllChildren(text);
      assert(!key(document.body, "ArrowLeft").defaultPrevented, "Selection collapse was prevented");
    } finally { selection.removeAllRanges(); text.remove(); }
  });
  check("Native media keeps its arrows", () => {
    const video = document.createElement("video");
    video.controls = true;
    video.tabIndex = 0;
    document.body.append(video);
    try {
      video.focus();
      assert(!key(video, "ArrowRight").defaultPrevented && document.activeElement === video, "Media arrow moved spatial focus");
    } finally { video.remove(); }
  });
  check("Desktop BrowserBack is not the TV's contextual Back", () => {
    assert(!key(document.body, "BrowserBack").defaultPrevented, "Desktop BrowserBack was intercepted");
  });
  return results;
};
