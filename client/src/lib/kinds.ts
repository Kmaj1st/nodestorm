import { ConceptKind } from "@nodestorm/shared";
import type { MessageKey } from "../i18n";

/**
 * Concept kinds (definition, theorem, …): their labels and colour families. Pure data for the canvas tag, the
 * inspector select, the View filter and the exports.
 */

export const KINDS: readonly ConceptKind[] = ConceptKind.options;

export const KIND_LABEL: Record<ConceptKind, MessageKey> = {
  definition: "kind.definition",
  theorem: "kind.theorem",
  lemma: "kind.lemma",
  proposition: "kind.proposition",
  corollary: "kind.corollary",
  axiom: "kind.axiom",
  conjecture: "kind.conjecture",
  example: "kind.example",
  notation: "kind.notation",
  other: "kind.other",
};

/** English names, for the LaTeX export (which isn't localised). */
export const KIND_NAME: Record<ConceptKind, string> = {
  definition: "Definition",
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  axiom: "Axiom",
  conjecture: "Conjecture",
  example: "Example",
  notation: "Notation",
  other: "Other",
};

/**
 * Colour family of a kind (the `.kind-tag--<tone>` classes): the proved results share one, so do definitions and
 * notation. The tag always carries its text label, so colour is never the only cue.
 */
export type KindTone = "def" | "result" | "axiom" | "conj" | "example" | "other";

export const KIND_TONE: Record<ConceptKind, KindTone> = {
  definition: "def",
  notation: "def",
  theorem: "result",
  lemma: "result",
  proposition: "result",
  corollary: "result",
  axiom: "axiom",
  conjecture: "conj",
  example: "example",
  other: "other",
};
