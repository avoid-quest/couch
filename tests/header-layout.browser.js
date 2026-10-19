// Evaluate on a paired browsing page. Repeat at 600/960px TV (Default/Largest,
// idle/sharing) and standard desktop/phone/TV widths. Uses the rendered app.
(() => {
  const header = document.querySelector(".app-header");
  if (!header || header.hidden) throw new Error("Open a paired browsing page first");
  const search = header.querySelector('[role="search"]');
  const rect = element => element.getBoundingClientRect();
  const visible = element => element && rect(element).width > 0 && rect(element).height > 0;
  const input = search.querySelector("input");
  const controls = [search, header.querySelector("nav"), header.querySelector("time")].filter(visible);
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const failures = [];
  if (rect(input).width < 44) failures.push("Search input narrower than 44px");
  for (const [index, control] of controls.entries()) {
    const bounds = rect(control);
    if (bounds.left < 0 || bounds.right > innerWidth + 1) failures.push(`${control.tagName} leaves viewport`);
    for (const other of controls.slice(index + 1)) {
      if (overlaps(bounds, rect(other))) failures.push(`${control.tagName} overlaps ${other.tagName}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
  return { passed: true, viewport: [innerWidth, innerHeight], inputWidth: rect(input).width, searchWidth: rect(search).width };
})();
