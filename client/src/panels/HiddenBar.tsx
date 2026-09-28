import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { hiddenIn, useView } from "../store/viewStore";
import { Icon } from "../ui/Icon";

/**
 * On the canvas while concepts are hidden by hand: "3 hidden · Show all", and a popover listing them, each with its
 * own Show button. Hiding is only a view choice, kept for this browser tab (store/viewStore.ts).
 */
export function HiddenBar() {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const ids = useView(hiddenIn(graph.id));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const hidden = graph.nodes.filter((n) => ids.includes(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  const count = hidden.length;
  const said = useView((v) => v.hiddenSaid);
  // Read out when concepts are hidden. Always in the page, so the first message is heard too.
  const status = <p className="sr-only" role="status">{count ? said : ""}</p>;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        setOpen(false);
        toggle.current?.focus();
      } else if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);

  if (!count) return status;
  const show = (ids?: string[]) => useView.getState().show(graph.id, ids);
  // "Show all" takes the bar away: the focus goes to the first concept shown again instead of to the page.
  const showAll = () => {
    const first = hidden[0]?.id;
    show();
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
      if (first) document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(first)}"]`)?.focus();
    });
  };
  const showOne = (id: string, i: number) => {
    show([id]);
    // Keep the keyboard in the list: on to the next concept's button (or the toggle when the last one went).
    requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(".hidden-bar__list button");
      if (buttons?.length) buttons[Math.min(i, buttons.length - 1)].focus();
      else if (toggle.current?.isConnected) toggle.current.focus();
      else document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus(); // the bar went with the last one
    });
  };

  return (
    <>
      {status}
      <div className="hidden-bar menu" ref={ref} role="group" aria-label={t("hide.bar")} data-testid="hidden-bar">
        <button
          ref={toggle}
          className="hidden-bar__toggle"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? "hidden-list" : undefined}
          onClick={() => setOpen(!open)}
          title={t("hide.listTitle")}
          data-testid="hidden-count"
        >
          <Icon icon={EyeOff} size={14} />
          {t("hide.count", { n: count })}
          <Icon icon={ChevronDown} size={12} />
        </button>
        <button className="hidden-bar__all" onClick={showAll} title={t("hide.showAllTitle")} data-testid="hidden-show-all">
          {t("hide.showAll")}
        </button>
        {open && (
          <div className="menu__list menu__list--left hidden-bar__list" id="hidden-list" role="dialog" aria-label={t("hide.listLabel")}>
            <ul>
              {hidden.map((n, i) => (
                <li key={n.id}>
                  <span className="hidden-bar__name" title={n.name}>{n.name}</span>
                  <button
                    onClick={() => showOne(n.id, i)}
                    aria-label={t("hide.showName", { name: n.name })}
                    title={t("hide.showName", { name: n.name })}
                  >
                    <Icon icon={Eye} size={14} />
                    {t("hide.show")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
