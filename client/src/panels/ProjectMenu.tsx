import { Check, ChevronsUpDown, Copy, FilePlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { projectList } from "../lib/projects";
import { currentProject, useGraphStore } from "../store/graphStore";
import { Icon } from "../ui/Icon";

/**
 * Project switcher at the left of the toolbar: shows the current project's name and opens a menu to switch
 * projects or create, rename, duplicate or delete one. Renaming edits the name in place.
 */
export function ProjectMenu() {
  const t = useT();
  const s = useGraphStore();
  const project = useGraphStore(currentProject);
  const projects = projectList(s);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key !== "Escape" : ref.current?.contains(e.target as Node)) return;
      // Escape from inside the menu hands focus back to its button.
      if (e instanceof KeyboardEvent && ref.current?.contains(document.activeElement)) ref.current.querySelector("button")?.focus();
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const act = (fn: () => void) => () => {
    // The item goes with the menu: focus on its button, where a dialog opened from here returns it.
    ref.current?.querySelector("button")?.focus();
    setOpen(false);
    fn();
  };

  if (renaming) {
    const commit = (value: string) => {
      s.renameProject(project.id, value);
      setRenaming(false);
    };
    return (
      <input
        className="project-name-input"
        aria-label={t("project.name")}
        defaultValue={project.name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          else if (e.key === "Escape") {
            e.currentTarget.value = project.name; // so a blur while closing doesn't save the edit
            setRenaming(false);
          }
        }}
      />
    );
  }

  return (
    // Tabbing out of the menu closes it, so it never covers what has focus.
    <div className="menu" ref={ref} onBlur={(e) => open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button
        className="project-button menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("project.label", { name: project.name })}
        title={t("project.title")}
        onClick={() => setOpen(!open)}
      >
        <span className="project-button__name">{project.name}</span>
        <Icon icon={ChevronsUpDown} size={14} className="menu-button__chevron" />
      </button>
      {open && (
        <div className="menu__list menu__list--left" role="menu" aria-label={t("project.menu")}>
          {projects.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === project.id}
              className={p.id === project.id ? "menu__item--current" : undefined}
              onClick={act(() => s.switchProject(p.id))}
            >
              <span className="menu__check">{p.id === project.id && <Icon icon={Check} size={14} />}</span>
              <span className="menu__label">{p.name}</span>
            </button>
          ))}
          <hr className="menu__sep" />
          {/* A new project starts with its name selected for editing. */}
          <button role="menuitem" onClick={act(() => { s.newProject(); setRenaming(true); })}>
            <Icon icon={FilePlus} size={14} />{t("project.new")}
          </button>
          <button role="menuitem" onClick={act(() => setRenaming(true))}>
            <Icon icon={Pencil} size={14} />{t("project.rename")}
          </button>
          <button role="menuitem" title={t("project.duplicateTitle")} onClick={act(() => s.duplicateProject(project.id))}>
            <Icon icon={Copy} size={14} />{t("project.duplicate")}
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={act(() => {
              if (confirm(t("project.deleteConfirm", { name: project.name }))) s.deleteProject(project.id);
            })}
          >
            <Icon icon={Trash2} size={14} />{t("project.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
