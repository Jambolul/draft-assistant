import type { Recommendation } from "../engine/recommend";
import ChampionBadge from "./ChampionBadge";
export default function Recommendations({
  results,
  title = "Recommendations",
  onPick,
}: {
  results: Recommendation[];
  title?: string;
  onPick?: (id: string) => void;
}) {
  return (
    <section
      className="recommendations"
      aria-labelledby="recommendations-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="recommendations-title">{title}</h2>
        </div>
        <span className="count-pill">{results.length} available</span>
      </div>
      <div className="recommendation-grid">
        {results.slice(0, 3).map((result, index) => (
          <article
            className={"recommendation-card" + (index === 0 ? " leading" : "")}
            key={result.champion.id}
          >
            <div className="recommendation-top">
              <span className="rank">0{index + 1}</span>
              <span className="fit-score">
                {result.score}
                <small>/100 fit</small>
              </span>
            </div>
            <div className="recommendation-name">
              <ChampionBadge champion={result.champion} />
              <div>
                <h3>{result.champion.name}</h3>
                <p>{result.champion.identity}</p>
              </div>
            </div>
            <h4>Strengths</h4>
            <ul className="reasons">
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="tradeoffs">
              <h4>Tradeoffs</h4>
              {result.tradeoffs.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <details className="score-details">
              <summary>Score breakdown</summary>
              {result.breakdown.map((item, i) => (
                <div key={i}>
                  <span>{item.label}</span>
                  <strong>
                    {item.points.toFixed(1)} / {item.max}
                  </strong>
                </div>
              ))}
              <p>Earned points divided by available points, rounded to 100.</p>
            </details>
            {onPick && (
              <button
                className="lock-button"
                onClick={() => onPick(result.champion.id)}
              >
                Pick {result.champion.name}
              </button>
            )}
          </article>
        ))}
      </div>
      {results.length > 3 && (
        <details className="other-options">
          <summary>Compare the other {results.length - 3} options</summary>
          <div>
            {results.slice(3).map((result) => (
              <article key={result.champion.id}>
                <ChampionBadge champion={result.champion} small />
                <div>
                  <strong>{result.champion.name}</strong>
                  <p>{result.reasons[0]}</p>
                </div>
                <span>
                  {result.score}
                  <small>/100</small>
                </span>
                {onPick && (
                  <button
                    className="text-button"
                    onClick={() => onPick(result.champion.id)}
                  >
                    Pick {result.champion.name}
                  </button>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
      {!results.length && (
        <div className="empty-results">
          <h3>No available champions in your pool</h3>
          <p>
            The pool is empty or its champions are already picked or banned.
            Edit the pool in settings, or change the draft.
          </p>
        </div>
      )}
    </section>
  );
}
