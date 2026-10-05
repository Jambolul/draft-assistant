import { analyzeDraft } from "../engine/recommend";
import type { Draft, Traits } from "../types";
const metrics: { label: string; trait: keyof Traits }[] = [
  { label: "Engage", trait: "engage" },
  { label: "Frontline", trait: "frontline" },
  { label: "Peel", trait: "peel" },
  { label: "Waveclear", trait: "waveclear" },
  { label: "Scaling", trait: "scaling" },
];
export default function TeamProfile({ draft }: { draft: Draft }) {
  const analysis = analyzeDraft(draft);
  return (
    <section className="composition-section">
      <div className="composition-card">
        <p className="eyebrow">TEAM PROFILE</p>
        <div className="metric-grid">
          {metrics.map((metric) => (
            <div className="metric" key={metric.trait}>
              <div>
                <span>{metric.label}</span>
                <strong>
                  {analysis.ally.count
                    ? analysis.ally.average(metric.trait).toFixed(1) + " / 5"
                    : "—"}
                </strong>
              </div>
              <div className="meter">
                <span
                  style={{
                    width: analysis.ally.average(metric.trait) * 20 + "%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="composition-card signals">
        <div>
          <p className="eyebrow">TEAM NEEDS</p>
          <div className="signal-tags">
            {analysis.needs.length ? (
              analysis.needs.map((need) => <span key={need}>{need}</span>)
            ) : (
              <p>
                {analysis.ally.count
                  ? "No major gap identified from known picks."
                  : "Add allied picks to see team needs."}
              </p>
            )}
          </div>
        </div>
        <div>
          <p className="eyebrow">ENEMY THREATS</p>
          <div className="signal-tags danger">
            {analysis.threats.length ? (
              analysis.threats.map((threat) => (
                <span key={threat}>{threat}</span>
              ))
            ) : (
              <p>
                {analysis.enemy.count
                  ? "No dominant threat identified so far."
                  : "Add enemy picks to see threats."}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
