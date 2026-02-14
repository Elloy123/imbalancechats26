import React from 'react'
import type { ClusterData } from '../types'

interface Props {
  cluster: ClusterData | null
  priceDecimals?: number
}

export const FootprintPanel: React.FC<Props> = ({ cluster, priceDecimals = 5 }) => {
  if (!cluster || cluster.priceLevels.length === 0) {
    return (
      <div style={boxStyle}>
        <div style={{ color: '#555', fontSize: '10px', textAlign: 'center', padding: '20px' }}>
          Passe o mouse sobre um cluster
        </div>
      </div>
    )
  }

  const levels = cluster.priceLevels
  const maxVol = Math.max(...levels.map(l => Math.max(l.volumeBuy, l.volumeSell)), 1)
  const bodyHigh = Math.max(cluster.open, cluster.close)
  const bodyLow = Math.min(cluster.open, cluster.close)

  return (
    <div style={boxStyle}>
      {/* Header */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #1c1f2b', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: '#e0e3eb', fontSize: '11px', fontWeight: 700 }}>#{cluster.id}</span>
        <span style={{ color: '#787b86', fontSize: '9px' }}>{new Date(cluster.startTime).toLocaleTimeString('pt-BR')}</span>
      </div>

      {/* Summary */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #1c1f2b', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', fontSize: '9px' }}>
        <span style={{ color: '#089981' }}>Buy: {fmtV(cluster.volumeBuy)}</span>
        <span style={{ color: '#f23645' }}>Sell: {fmtV(cluster.volumeSell)}</span>
        <span style={{ color: cluster.delta >= 0 ? '#089981' : '#f23645' }}>Δ: {cluster.delta >= 0 ? '+' : ''}{fmtV(cluster.delta)}</span>
        <span style={{ color: '#ffd700' }}>POC: {cluster.poc.toFixed(priceDecimals)}</span>
        <span style={{ color: cluster.bodyVolumeRatio > 50 ? '#089981' : '#ff9800' }}>Body: {cluster.bodyVolumeRatio.toFixed(0)}%</span>
        <span style={{ color: '#787b86' }}>Wick: {(100 - cluster.bodyVolumeRatio).toFixed(0)}%</span>
      </div>

      {/* Body vs Wick bar */}
      <div style={{ padding: '3px 8px', borderBottom: '1px solid #1c1f2b' }}>
        <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: '#1c1f2b' }}>
          <div style={{ width: `${cluster.bodyVolumeRatio}%`, background: '#089981', transition: 'width 0.3s' }} />
          <div style={{ width: `${100 - cluster.bodyVolumeRatio}%`, background: '#ff9800', transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginTop: '1px' }}>
          <span style={{ color: '#089981' }}>Corpo: {fmtV(cluster.bodyVolume)}</span>
          <span style={{ color: '#ff9800' }}>Pavio: {fmtV(cluster.wickVolume)}</span>
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 65px 1fr', padding: '3px 6px', borderBottom: '1px solid #1c1f2b', fontSize: '8px', color: '#555' }}>
        <span style={{ textAlign: 'right' }}>SELL</span>
        <span style={{ textAlign: 'center' }}>PREÇO</span>
        <span>BUY</span>
      </div>

      {/* Price levels */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {levels.map((level, i) => {
          const buyPct = (level.volumeBuy / maxVol) * 100
          const sellPct = (level.volumeSell / maxVol) * 100
          const isPoc = Math.abs(level.price - cluster.poc) < 0.000001
          const isInBody = level.price >= bodyLow - 0.00005 && level.price <= bodyHigh + 0.00005
          const imb = Math.max(level.volumeBuy, level.volumeSell) / Math.max(Math.min(level.volumeBuy, level.volumeSell), 0.1) >= 3
          const delta = level.volumeBuy - level.volumeSell

          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 65px 1fr',
              padding: '0px 6px', fontSize: '9px',
              background: isPoc ? 'rgba(255,235,59,0.08)' : imb ? (delta > 0 ? 'rgba(8,153,129,0.05)' : 'rgba(242,54,69,0.05)') : 'transparent',
              borderLeft: isPoc ? '2px solid #ffeb3b' : isInBody ? '2px solid #333' : '2px solid transparent',
            }}>
              {/* Sell */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px', height: '14px' }}>
                <span style={{ color: level.volumeSell > 0 ? '#f23645' : '#222', fontSize: '8px', fontWeight: imb && delta < 0 ? 700 : 400 }}>
                  {level.volumeSell > 0 ? fmtV(level.volumeSell) : ''}
                </span>
                <div style={{
                  height: '8px', width: `${sellPct}%`, maxWidth: '80%',
                  background: isPoc ? '#f23645' : imb && delta < 0 ? '#f23645' : 'rgba(242,54,69,0.35)',
                  borderRadius: '1px', minWidth: level.volumeSell > 0 ? '1px' : '0',
                }} />
              </div>

              {/* Price */}
              <span style={{ textAlign: 'center', color: isPoc ? '#ffeb3b' : isInBody ? '#d1d4dc' : '#555', fontSize: '8px', fontWeight: isPoc ? 700 : 400, lineHeight: '14px' }}>
                {level.price.toFixed(priceDecimals)}
              </span>

              {/* Buy */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '14px' }}>
                <div style={{
                  height: '8px', width: `${buyPct}%`, maxWidth: '80%',
                  background: isPoc ? '#089981' : imb && delta > 0 ? '#089981' : 'rgba(8,153,129,0.35)',
                  borderRadius: '1px', minWidth: level.volumeBuy > 0 ? '1px' : '0',
                }} />
                <span style={{ color: level.volumeBuy > 0 ? '#089981' : '#222', fontSize: '8px', fontWeight: imb && delta > 0 ? 700 : 400 }}>
                  {level.volumeBuy > 0 ? fmtV(level.volumeBuy) : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ padding: '3px 8px', borderTop: '1px solid #1c1f2b', fontSize: '8px', color: '#555', display: 'flex', gap: '6px' }}>
        <span style={{ color: '#ffeb3b' }}>● POC</span>
        <span style={{ color: '#333' }}>│ Corpo</span>
        <span style={{ color: '#089981' }}>■ Buy imb</span>
        <span style={{ color: '#f23645' }}>■ Sell imb</span>
      </div>
    </div>
  )
}

const fmtV = (v: number): string => {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toString()
}

const boxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  background: '#0b0e14', borderRadius: '4px', border: '1px solid #1c1f2b',
  height: '100%', overflow: 'hidden', fontFamily: 'Consolas, monospace',
}
