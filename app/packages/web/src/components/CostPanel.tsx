import { useState, useEffect } from 'react';
import { api, type ActualCosts, type CostEstimates } from '../api.js';

interface Props {
  estimates: CostEstimates | null;
}

/**
 * Bottom-left dashboard panel. Renders the 7-day actual-spend bar chart from
 * Cost Explorer (fetched once on mount) plus the per-game hourly estimates
 * passed in as props from the parent dashboard.
 */
export function CostPanel({ estimates }: Props) {
  const [actual, setActual] = useState<ActualCosts | null>(null);

  useEffect(() => {
    void api.costsActual().then(setActual);
  }, []);

  const maxCost = Math.max(...(actual?.daily.map((d) => d.cost) ?? [0]), 0.001);

  return (
    <div style={panelStyle}>
      <h2 style={headingStyle}>Actual Costs (7 days)</h2>

      {actual?.daily.length ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '72px', marginBottom: '0.5rem' }}>
            {actual.daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: $${d.cost.toFixed(4)}`}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  borderRadius: '3px 3px 0 0',
                  minHeight: '2px',
                  height: `${Math.max((d.cost / maxCost) * 100, 2)}%`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
            Total: ${actual.total.toFixed(2)} over {actual.days} days
          </div>
        </>
      ) : (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
          No cost data available
        </div>
      )}

      {estimates && (
        <div>
          {Object.entries(estimates.games).map(([game, est]) => (
            <div key={game} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.2rem 0', borderTop: '1px solid var(--border)', color: 'var(--text-dim)' }}>
              <span style={{ textTransform: 'capitalize' }}>{game}</span>
              <span style={{ color: 'var(--accent)' }}>${est.costPerHour}/hr</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '1.25rem',
};

const headingStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-dim)',
  marginBottom: '1rem',
};
