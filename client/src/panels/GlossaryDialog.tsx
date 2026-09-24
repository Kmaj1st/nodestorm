import type { Graph } from "@nodestorm/shared";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { rich, useT } from "../i18n";
import { buildGlossary } from "../lib/glossary";
import { KindTag } from "../graph/KindTag";
import { goToConcept } from "../store/viewStore";
import { Icon } from "../ui/Icon";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

/**
 * File → "Notation…": the symbols this graph introduces (from its definitions and notation concepts, no AI), in study
 * order, each with a button that closes the dialog and shows its concept on the canvas.
 */
export function GlossaryDialog({ graph, onClose }: { graph: Graph; onClose: () => void }) {
  const t = useT();
  const entries = useMemo(() => buildGlossary(graph), [graph]);
  return (
    <Modal label={t("glossary.title")} title={t("glossary.title")} onClose={onClose} className="glossary">
      <p className="muted small">{t("glossary.intro")}</p>
      {entries.length === 0 ? (
        <p className="glossary__empty">{rich("glossary.empty")}</p>
      ) : (
        <table className="glossary__table" data-testid="glossary">
          <thead>
            <tr>
              <th scope="col">{t("glossary.symbol")}</th>
              <th scope="col">{t("glossary.concept")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.nodeId}>
                <td className="glossary__symbol"><MathText text={`$${e.symbol}$`} inline /></td>
                <td>
                  <div className="glossary__concept">
                    <button
                      className="link link--icon"
                      onClick={() => { onClose(); goToConcept(e.nodeId); }}
                      title={t("glossary.goTitle", { name: e.name })}
                    >
                      {e.name}
                      <Icon icon={ArrowRight} size={14} />
                    </button>
                    <KindTag kind={e.kind} />
                  </div>
                  {e.formula && <div className="glossary__formula small"><MathText text={`$${e.formula}$`} inline /></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
