import type { ScoreResult } from '../../engine/scoring';

export function ScoreBar({ result }: { result: ScoreResult }) {
  return (
    <div className="scorebar" role="img" aria-label={`Leverage score ${Math.round(result.score)} of 100`}>
      {result.factors.map((f) => (
        <i key={f.key} className={`f-${f.key}`} style={{ width: `${f.contribution * result.balance.multiplier}%` }} title={`${f.label}: ${f.contribution.toFixed(1)} pts`} />
      ))}
    </div>
  );
}

export function ScoreExplain({ result }: { result: ScoreResult }) {
  return (
    <div className="stack tight">
      <ScoreBar result={result} />
      <div className="table-wrap">
        <table className="ftable">
          <thead>
            <tr><th>Factor</th><th>Why</th><th style={{ textAlign: 'right' }}>Pts</th></tr>
          </thead>
          <tbody>
            {result.factors.map((f) => (
              <tr key={f.key}>
                <td><span className="row nowrap"><i className={`f-${f.key}`} style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block' }} />{f.label}</span></td>
                <td className={f.assumed ? 'faint' : 'muted'}>{f.note}</td>
                <td className="n">{f.contribution.toFixed(1)}</td>
              </tr>
            ))}
            {result.balance.multiplier < 1 && (
              <tr><td>Balance</td><td className="muted">{result.balance.note}</td><td className="n">×{result.balance.multiplier.toFixed(2)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="xs faint">The score reflects only what you entered, weighted by your settings. Treat it as a thinking aid, not a verdict.</p>
    </div>
  );
}
