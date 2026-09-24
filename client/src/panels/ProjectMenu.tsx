import { useEffect, useRef, useState } from "react";
import { projectList } from "../lib/projects";
import { currentProject, useGraphStore } from "../store/graphStore";

/**
 * Project switcher at the left of the toolbar: shows the current project's name and opens a menu to switch
 * projects or create, rename, duplicate or delete one. Renaming edits the name in place.
 */
export function ProjectMenu() {
  const s = useGraphStore();
  const project = useGraphStore(currentProject);
  const projects = projectList(s);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const act = (fn: () => void) => () => {
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
        aria-label="Project name"
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
    <div className="menu" ref={ref}>
      <button
        className="project-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project: ${project.name}`}
        title="Switch or manage projects"
        onClick={() => setOpen(!open)}
      >
        <span className="project-button__name">{project.name}</span> ▾
      </button>
      {open && (
        <div className="menu__list menu__list--left" role="menu" aria-label="Projects">
          {projects.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === project.id}
              className={p.id === project.id ? "menu__item--current" : undefined}
              onClick={act(() => s.switchProject(p.id))}
            >
              {p.id === project.id ? "✓ " : ""}{p.name}
            </button>
          ))}
          <hr className="menu__sep" />
          {/* A new project starts with its name selected for editing. */}
          <button role="menuitem" onClick={act(() => { s.newProject(); setRenaming(true); })}>New project</button>
          <button role="menuitem" onClick={act(() => setRenaming(true))}>Rename…</button>
          <button role="menuitem" title="Copy this project, including its sandboxes" onClick={act(() => s.duplicateProject(project.id))}>
            Duplicate
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={act(() => {
              if (confirm(`Delete the project “${project.name}” and all its graphs? This can't be undone.`)) s.deleteProject(project.id);
            })}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
