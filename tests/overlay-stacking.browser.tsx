// Empty Vite page with #fixture and /index.css; run at phone and desktop sizes, with ?tv=0 and ?tv=1.
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../src/client/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../src/client/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogCancel } from "../src/client/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "../src/client/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "../src/client/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../src/client/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../src/client/components/ui/select";
import { mountUiAudit } from "./ui-audit.browser";
import { isTvPresentation } from "../src/client/session/presentation";

const wait = () => new Promise(resolve => setTimeout(resolve, 220));
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
function front(element: HTMLElement) {
  // Modal Radix layers disable pointer events on older panels, but those panels still paint.
  // Include them in hit testing so a visually covered button cannot produce a false pass.
  const panels = [...document.querySelectorAll<HTMLElement>('[data-slot$="-content"]')];
  const previous = panels.map(panel => panel.style.pointerEvents);
  panels.forEach(panel => { panel.style.pointerEvents = "auto"; });
  try {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!element.checkVisibility() || !rect.width || !element.contains(hit)) {
      throw new Error(`${element.textContent} is covered by ${hit?.closest('[data-slot]')?.getAttribute('data-slot') ?? hit?.tagName}`);
    }
  } finally { panels.forEach((panel, index) => { panel.style.pointerEvents = previous[index]!; }); }
}
async function press(selector: string) {
  const element = control(selector);
  front(element);
  element.focus();
  element.click();
  await wait();
}

type Panel = "popover" | "dialog" | "sheet";
type Child = Panel | "confirmation" | "menu" | "select";
function Fixture({ parent, child }: { parent: Panel; child: Child }) {
  const [open, setOpen] = useState(false);
  const finish = <Button data-finish onClick={() => setOpen(false)}>Finish</Button>;
  const trigger = <Button data-open onClick={() => setOpen(true)}>Open child</Button>;
  let nested: ReactNode;
  if (child === "confirmation") nested = <>{trigger}<AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent aria-describedby={undefined}><AlertDialogTitle>Child confirmation</AlertDialogTitle><AlertDialogCancel data-finish>Finish</AlertDialogCancel></AlertDialogContent></AlertDialog></>;
  else if (child === "dialog") nested = <>{trigger}<Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}><DialogTitle>Child dialog</DialogTitle>{finish}</DialogContent></Dialog></>;
  else if (child === "sheet") nested = <>{trigger}<Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" aria-describedby={undefined} className="min-h-[60dvh] p-6"><SheetTitle>Child sheet</SheetTitle>{finish}</SheetContent></Sheet></>;
  else if (child === "popover") nested = <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent>{finish}</PopoverContent></Popover>;
  else if (child === "menu") nested = <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild><Button data-open>Open child</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem data-finish>Finish</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  else nested = <Select open={open} onOpenChange={setOpen}><SelectTrigger data-open aria-label="Open child"><SelectValue placeholder="Open child" /></SelectTrigger><SelectContent><SelectItem value="finish" data-finish>Finish</SelectItem></SelectContent></Select>;
  // Keep both surfaces overlapping: a sheet behind a dialog can otherwise pass at a tall viewport.
  const body = <div className="flex min-h-[65dvh] items-center justify-center">{nested}</div>;
  if (parent === "dialog") return <Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Parent dialog</DialogTitle>{body}</DialogContent></Dialog>;
  if (parent === "sheet") return <Sheet open><SheetContent side="bottom" aria-describedby={undefined} className="p-6"><SheetTitle>Parent sheet</SheetTitle>{body}</SheetContent></Sheet>;
  return <Popover open><PopoverTrigger asChild><Button className="fixed left-4 top-4">Parent popover</Button></PopoverTrigger><PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-lg">{body}</PopoverContent></Popover>;
}

export async function runOverlayStackingRegression() {
  const wasTv = document.body.classList.contains("tv-presentation");
  document.body.classList.toggle("tv-presentation", isTvPresentation());
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  const saved = localStorage.getItem("couch.connections");
  const couches = Array.from({ length: 3 }, (_, index) => ({ origin: `http://couch-${index}.example`, name: `Saved Couch ${index}` }));
  localStorage.setItem("couch.connections", JSON.stringify(couches));
  const audit = await mountUiAudit();
  try {
    if (!isTvPresentation()) {
      await audit.go("/");
      await audit.click("Living room: Connected");
      await check("Couch selector confirmation stays above the saved list and Cancel restores focus", async () => {
        const opener = control('button[aria-label="Forget Living room"]');
        opener.focus(); opener.click(); await wait();
        front(control('[role="alertdialog"] h2'));
        front(control('[data-slot="alert-dialog-action"]'));
        await press('[data-slot="alert-dialog-cancel"]');
        if (document.querySelector('[role="alertdialog"]') || document.activeElement !== opener) throw new Error("Cancel did not return to the Couch selector");
      });
      // Clean up a failed assertion so the saved-row journey can still run.
      if (document.querySelector('[role="alertdialog"]')) { control('[data-slot="alert-dialog-cancel"]').click(); await wait(); }
      await check("Saved Couch menu confirmation can forget its Couch", async () => {
        const options = control('button[aria-label="Options for Saved Couch 0"]');
        options.focus();
        options.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        await wait();
        await press('[role="menuitem"]');
        front(control('[role="alertdialog"] h2'));
        await press('[data-slot="alert-dialog-action"]');
        if (document.querySelector('[role="alertdialog"]') || localStorage.getItem("couch.connections")?.includes(couches[0]!.origin)) throw new Error("Forget did not remove the saved Couch");
      });
    }
  } finally {
    audit.close();
    if (saved === null) localStorage.removeItem("couch.connections"); else localStorage.setItem("couch.connections", saved);
  }
  for (const parent of ["popover", "dialog", "sheet"] as const) {
    for (const child of ["confirmation", "dialog", "sheet", "popover", "menu", "select"] as const) {
      await check(`${parent} → ${child}: child paints above parent and can finish`, async () => {
        const root = createRoot(control("#fixture"));
        try {
          root.render(<Fixture parent={parent} child={child} />); await wait();
          const opener = control("[data-open]");
          opener.focus();
          if (child === "menu" || child === "select") opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          else opener.click();
          await wait();
          await press("[data-finish]");
          if (document.querySelector("[data-finish]")) throw new Error("Child did not close");
          front(control("[data-open]"));
        } finally { root.unmount(); await wait(); }
      });
    }
  }
  document.body.classList.toggle("tv-presentation", wasTv);
  return { passed: results.every(result => result.passed), viewport: [innerWidth, innerHeight], results };
}
