import { Compass, FilePlus, Network } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rich, t as tr, useT, type MessageKey } from "../i18n";
import {
  availableSteps,
  onScreen,
  placePopover,
  shouldShowWelcome,
  type Needs,
  type Side,
  type TourEnv,
  type TourStep,
} from "../lib/onboarding";
import { viewport } from "../lib/viewport";
import { activeGraph, isViewing, useGraphStore } from "../store/graphStore";
import { useOnboarding } from "../store/onboardingStore";
import { Icon } from "../ui/Icon";
import { isReady, useSettings } from "../store/settingsStore";
import "./onboarding.css";

/**
 * First-run onboarding: a welcome card on the empty canvas of a first visit, and a guided tour of small popovers
 * pointing at the real UI. Mount once, inside `.main` (the card is laid over the canvas; the tour is portalled).
 */
export function Onboarding() {
  const welcomeDone = useOnboarding((s) => s.welcomeDone);
  const touring = useOnboarding((s) => s.touring);
  const viewing = useGraphStore(isViewing);
  // Any concept in any of the user's own graphs (not a shared graph open in the viewer).
  const hasConcepts = useGraphStore((s) => Object.values(s.graphs).some((g) => g.id !== s.view?.id && g.nodes.length > 0));

  // Making a first concept (or importing a project) ends the first visit: the card never comes back.
  useEffect(() => {
    if (hasConcepts && !viewing) useOnboarding.getState().dismissWelcome();
  }, [hasConcepts, viewing]);

  return (
    <>
      {shouldShowWelcome({ welcomeDone, viewing, hasConcepts, touring }) && <WelcomeCard />}
      {touring && !viewing && <Tour />}
    </>
  );
}

const q = <E extends Element = Element>(sel: string) => document.querySelector<E>(sel);
const focusAdd = () => q<HTMLElement>('[data-tour="add"]')?.focus();

function loadExampleHere() {
  useGraphStore.getState().loadExample();
  viewport.fit();
}

function WelcomeCard() {
  const t = useT();
  const titleId = useId();
  const aiReady = useSettings(isReady);
  const { dismissWelcome, startTour } = useOnboarding.getState();
  const example = () => {
    loadExampleHere();
    dismissWelcome();
    useGraphStore.getState().setToast(tr("welcome.loaded"), "info");
    focusAdd();
  };
  const empty = () => {
    dismissWelcome();
    focusAdd(); // the card's buttons are gone; carry on where a first concept is added
  };
  return (
    <div className="welcome-layer">
      <section className="welcome" aria-labelledby={titleId} data-testid="welcome">
        <h2 id={titleId}>{t("welcome.title")}</h2>
        <p>{t("welcome.intro")}</p>
        <div className="welcome__choices">
          <button className="primary" onClick={startTour}><Icon icon={Compass} />{t("welcome.tour")}</button>
          <button onClick={example} title={t("canvas.exampleTitle")}><Icon icon={Network} />{t("welcome.example")}</button>
          <button onClick={empty}><Icon icon={FilePlus} />{t("welcome.empty")}</button>
        </div>
        {!aiReady && (
          <p className="welcome__note muted small">
            {rich("welcome.aiNote", {
              settings: (
                <button className="link" onClick={() => useGraphStore.getState().setSettingsOpen(true)} aria-label={t("welcome.settingsAria")}>
                  {t("welcome.settings")}
                </button>
              ),
            })}
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The tour

/** The element each step points at. Toolbar buttons carry data-tour; the others are found by what they are. */
const ANCHORS: Record<TourStep["anchor"], () => Element | null> = {
  add: () => q('[data-tour="add"]'),
  install: () => q('.inspector [data-testid^="install-"]:not([data-testid^="install-all"])'),
  arrow: arrowAnchor,
  mix: () => q('[data-tour="mix"]'),
  fork: () => q('[data-tour="fork"]'),
  more: () => q(".toolbar__menu"),
  file: () => q('[data-tour="file"]'),
  settings: () => q('[data-tour="settings"]'),
};

/** An arrowhead inside the visible canvas, preferably of a mixed relation (a dependency arrow also works). */
function arrowAnchor(): Element | null {
  const pane = q(".react-flow")?.getBoundingClientRect();
  if (!pane) return null;
  const inPane = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return r.width > 0 && x > pane.left && x < pane.right && y > pane.top && y < pane.bottom;
  };
  const edges = [...document.querySelectorAll(".react-flow__edge")];
  for (const group of [edges.filter((e) => e.querySelector(".relation--mix")), edges]) {
    for (const e of group) {
      const a = e.querySelector('[data-testid$="-aToB"]');
      if (a && inPane(a)) return a;
    }
  }
  return null;
}

const windowSize = () => ({ width: window.innerWidth, height: window.innerHeight });

function currentEnv(): TourEnv {
  return {
    hasAnchor: (a) => {
      const el = ANCHORS[a]();
      return !!el && onScreen(el.getBoundingClientRect(), windowSize());
    },
    has: (needs: Needs) => {
      const g = activeGraph(useGraphStore.getState());
      return needs === "blocked" ? g.nodes.some((n) => n.missingDeps.length > 0) : g.relations.length > 0;
    },
  };
}

/** Bring what a step points at into view: select the blocked concept (its inspector shows Install), or fit the graph. */
function prepare(step: TourStep) {
  if (step.id === "install") {
    const s = useGraphStore.getState();
    const blocked = activeGraph(s).nodes.find((n) => n.missingDeps.length > 0);
    if (blocked && !ANCHORS.install()) viewport.focus(blocked.id);
  } else if (step.id === "arrow" && !arrowAnchor()) {
    viewport.fit();
  }
}

/** Does the active graph already show what the tour points at? Otherwise it first offers the example. */
const tourReady = () => {
  const env = currentEnv();
  return env.has("blocked") && env.has("relation");
};

/** How long a step waits for its anchor (after selecting or panning) before it is skipped. */
const ANCHOR_WAIT_MS = 1500;

interface Placement { left: number; top: number; side: Side; ring: DOMRect | null }

function Tour() {
  const t = useT();
  const ids = useId();
  // null: the intro card (offers the example); otherwise the steps that can be shown and where we are.
  const [steps, setSteps] = useState<TourStep[] | null>(() => (tourReady() ? availableSteps(currentEnv()) : null));
  const [index, setIndex] = useState(0);
  const dir = useRef<1 | -1>(1);
  const [place, setPlace] = useState<Placement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  // Focus goes back to where it was when the tour ends (the ? dialog's opener, or the welcome card's successor).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const step = steps?.[index] ?? null;
  const graphEmpty = useGraphStore((s) => activeGraph(s).nodes.length === 0);

  const end = useCallback((how: "done" | "skipped") => {
    useOnboarding.getState().endTour(how);
    if (opener?.isConnected && opener !== document.body) opener.focus();
    else focusAdd();
  }, [opener]);

  const go = useCallback((delta: 1 | -1) => {
    if (!steps) return;
    const next = index + delta;
    if (next >= steps.length) return end("done");
    if (next < 0) return;
    dir.current = delta;
    setPlace(null);
    setIndex(next);
  }, [steps, index, end]);

  const begin = (withExample: boolean) => {
    if (withExample) {
      // The example needs an empty graph: on top of existing work it goes into a new project of its own.
      if (!graphEmpty) useGraphStore.getState().newProject();
      loadExampleHere();
    }
    setPlace(null);
    setIndex(0);
    setSteps(availableSteps(currentEnv()));
  };

  // Prepare each step as it opens.
  useEffect(() => {
    if (step) prepare(step);
  }, [step]);

  // Follow the anchor every frame (pans, zooms, the inspector opening, window resizes, the ☰ menu); a step whose
  // anchor doesn't show up in time is dropped, moving on in the direction the user was going.
  useLayoutEffect(() => {
    let frame = 0;
    const started = performance.now();
    let last = "";
    let scrolled = false;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = box.current;
      if (!el) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      let ring: DOMRect | null = null;
      if (step) {
        const a = ANCHORS[step.anchor]();
        // The inspector may be a scrolled bottom sheet (phones): bring the Install button into it once, even when
        // it starts out below the sheet's visible part (a long definition, the kind field).
        // Until it is on screen, keep asking (the sheet may still be opening); after that, leave the user's scrolling alone.
        if (a && step.id === "install" && !scrolled) {
          a.scrollIntoView({ block: "nearest" });
          if (onScreen(a.getBoundingClientRect(), windowSize())) scrolled = true;
        }
        const r = a?.getBoundingClientRect();
        if (!r || !onScreen(r, windowSize())) {
          if (performance.now() - started > ANCHOR_WAIT_MS) {
            cancelAnimationFrame(frame);
            const rest = steps!.filter((s) => s !== step);
            if (!rest.length) return end("done");
            setSteps(rest);
            setIndex(Math.max(0, Math.min(dir.current === 1 ? index : index - 1, rest.length - 1)));
          }
          return;
        }
        ring = r;
      }
      const p = placePopover(ring, size, windowSize());
      const key = `${p.left},${p.top},${p.side},${ring ? [ring.left, ring.top, ring.width, ring.height].join(",") : ""}`;
      if (key !== last) {
        last = key;
        setPlace({ ...p, ring });
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step, steps, index, end]);

  // Keyboard: move focus into the popover once it is placed, so Enter goes on and Tab reaches Back and Skip.
  const placed = place !== null;
  useEffect(() => {
    if (placed) (nextBtn.current ?? box.current)?.focus({ preventScroll: true });
  }, [placed, index, steps]);

  // Escape skips the tour (unless a dialog or menu is open over it: those close first); arrows step through it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (q(".modal, .menu__list, .popover")) return;
        e.preventDefault();
        e.stopPropagation(); // not also leaving focus mode (App)
        end("skipped");
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && box.current?.contains(document.activeElement)) {
        e.preventDefault();
        go(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [end, go]);

  const titleKey = (step ? `tour.${step.id}.title` : "tour.intro.title") as MessageKey;
  const bodyKey = (step ? `tour.${step.id}.body` : "tour.intro.body") as MessageKey;
  const last = !!steps && index === steps.length - 1;
  const style = place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" as const };
  const ring = place?.ring;

  return createPortal(
    <>
      {ring && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={{ left: ring.left - 4, top: ring.top - 4, width: ring.width + 8, height: ring.height + 8 }}
        />
      )}
      <div
        ref={box}
        className={`tour tour--${place?.side ?? "center"}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
        tabIndex={-1}
        style={style}
        data-testid="tour"
      >
        {/* The step text is announced as it changes. */}
        <div aria-live="polite" aria-atomic="true">
          {steps && (
            <div className="tour__count muted small" data-testid="tour-count">
              {t("tour.count", { n: index + 1, total: steps.length })}
            </div>
          )}
          <h3 id={`${ids}-title`}>{t(titleKey)}</h3>
          <p id={`${ids}-body`}>
            {rich(bodyKey)}
            {!steps && !graphEmpty && <> {t("tour.intro.newProject")}</>}
          </p>
        </div>
        {steps ? (
          <div className="tour__actions">
            <button className="link" onClick={() => end("skipped")}>{t("tour.skip")}</button>
            <span className="tour__nav">
              <button onClick={() => go(-1)} disabled={index === 0}>{t("tour.back")}</button>
              <button ref={nextBtn} className="primary" onClick={() => go(1)}>{t(last ? "tour.finish" : "tour.next")}</button>
            </span>
          </div>
        ) : (
          <div className="tour__actions">
            <button className="link" onClick={() => end("skipped")}>{t("tour.skip")}</button>
            <span className="tour__nav">
              <button onClick={() => begin(false)}>{t("tour.intro.continue")}</button>
              <button ref={nextBtn} className="primary" onClick={() => begin(true)}>{t("tour.intro.load")}</button>
            </span>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
