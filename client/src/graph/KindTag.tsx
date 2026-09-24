import type { ConceptKind } from "@nodestorm/shared";
import { useT } from "../i18n";
import { KIND_LABEL, KIND_TONE } from "../lib/kinds";

/** A small colour-coded label naming a concept's kind ("Theorem", "Definition", …). */
export function KindTag({ kind }: { kind: ConceptKind }) {
  const t = useT();
  return (
    <span className={`kind-tag kind-tag--${KIND_TONE[kind]}`} data-kind={kind}>
      {t(KIND_LABEL[kind])}
    </span>
  );
}
