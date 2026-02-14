// src/components/ImbalanceChart.tsx
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { ClusterCanvas, ClusterCanvasHandle, Drawing, CurrentDrawing, StyleConfig } from './ClusterCanvas';
import type { ClusterData, ClusterConfig, SymbolPreset } from '../types';
import type { ClusterCalculator } from '../utils/clusterCalculator';

type ToolType = 'none' | 'crosshair' | 'hline' | 'vline' | 'rect';

const SYMBOLS: SymbolPreset[] = [
  { name: 'EURUSD', label: 'EUR/USD', priceLevelSize: 0.00020, digits: 5, deltaThreshold: 300 },
  { name: 'XAUUSD', label: 'XAU/USD', priceLevelSize: 0.50, digits: 2, deltaThreshold: 500 },
  { name: 'USTEC', label: 'USTEC', priceLevelSize: 2.0, digits: 2, deltaThreshold: 400 },
];

interface Props {
  symbol: string;
  clusters: ClusterData[];
  currentCluster: ClusterData | null;
  config: ClusterConfig;
  isLive: boolean;
  isLoadingHistory: boolean;
  onToggleLive: () => void;
  onReset: () => void;
  onUpdateConfig: (c: Partial<ClusterConfig>) => void;
  getCalculator: () => ClusterCalculator;
  onLoadHistory: (hours: number) => void;
  onSelectCluster: (c: ClusterData | null) => void;
  selectedCluster: ClusterData | null;
  onSwitchSymbol: (sym: SymbolPreset) => void;
}

const FONT_FAMILY = 'Consolas,"Courier New",monospace';

// Color Picker component
const ColorPicker: React.FC<{ label: string; color: string; onChange: (c: string) => void }> = React.memo(
  ({ label, color, onChange }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: '#aaa', fontSize: 10 }}>{label}:</span>
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 20, height: 20, padding: 0, border: 'none', cursor: 'pointer' }}
      />
    </div>
  )
);

ColorPicker.displayName = 'ColorPicker';

const formatVolume = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toString();
};

// Button component
const ActionButton: React.FC<{
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = React.memo(({ active, disabled, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: '3px 8px',
      borderRadius: 3,
      border: `1px solid ${active ? '#26a69a' : '#2B2B43'}`,
      fontSize: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: FONT_FAMILY,
      background: active ? 'rgba(38,166,154,0.15)' : 'transparent',
      color: active ? '#26a69a' : '#787b86',
      opacity: disabled ? 0.4 : 1,
    }}
  >
    {children}
  </button>
));

ActionButton.displayName = 'ActionButton';

// Slider component
const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}> = React.memo(({ label, value, min, max, step = 1, onChange, format }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span style={{ color: '#787b86', fontSize: 9 }}>{label}:</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: 60, cursor: 'pointer', accentColor: '#26a69a' }}
    />
    <span style={{ color: '#e0e3eb', fontSize: 10, fontWeight: 700, minWidth: 32 }}>
      {format ? format(value) : value}
    </span>
  </div>
));

Slider.displayName = 'Slider';

const rowStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#131722',
  borderRadius: 4,
  border: '1px solid #1c1f2b',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
};

export const ImbalanceChart: React.FC<Props> = React.memo((props) => {
  const {
    symbol,
    clusters,
    currentCluster,
    config,
    isLive,
    isLoadingHistory,
    onToggleLive,
    onReset,
    onUpdateConfig,
    getCalculator,
    onLoadHistory,
    onSelectCluster,
    selectedCluster,
    onSwitchSymbol,
  } = props;

  // ✅ DEBUG: Log quando props mudam
  useEffect(() => {
    console.log('📊 [ImbalanceChart] Props atualizadas:');
    console.log('   - clusters:', clusters.length);
    console.log('   - currentCluster:', currentCluster?.id || 'null');
    console.log('   - isLive:', isLive);
    console.log('   - config:', config);
  }, [clusters, currentCluster, isLive, config]);

  const canvasRef = useRef<ClusterCanvasHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 800, h: 500 });
  const preset = SYMBOLS.find((s) => s.name === symbol) || SYMBOLS[0];
  const digits = preset.digits;
  const pipDisplay = parseFloat((config.priceLevelSize * Math.pow(10, digits)).toFixed(2));

  const [renderMode, setRenderMode] = useState<'grid' | 'raw' | 'hybrid'>('hybrid');
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>('crosshair');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  const lastCrosshairRef = useRef<{ x: number; y: number } | null>(null);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);

  const [styleConfig, setStyleConfig] = useState<StyleConfig>({
    bullColor: '#26a69a',
    bearColor: '#ef5350',
    pocColor: '#ffd740',
    bgOpacity: 1.0,
    gridColor: '#2a2e39',
    crosshairColor: '#787b86',
    drawingColor: '#ffffff',
  });

  // ResizeObserver otimizado
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        const newW = Math.floor(r.width);
        const newH = Math.floor(r.height);

        setSize((prev) => {
          if (Math.abs(prev.w - newW) > 5 || Math.abs(prev.h - newH) > 5) {
            console.log('📐 [ImbalanceChart] Tamanho mudou:', newW, 'x', newH);
            return { w: newW, h: newH };
          }
          return prev;
        });
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => ro.disconnect();
  }, []);

  // Handler de mouse com throttle
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (lastCrosshairRef.current) {
      const dx = Math.abs(lastCrosshairRef.current.x - x);
      const dy = Math.abs(lastCrosshairRef.current.y - y);
      if (dx < 3 && dy < 3) {
        if (isDrawing && currentDrawing) {
          setCurrentDrawing({ ...currentDrawing, x2: x, y2: y });
        }
        return;
      }
    }

    lastCrosshairRef.current = { x, y };
    setCrosshair({ x, y });

    if (isDrawing && currentDrawing) {
      setCurrentDrawing({ ...currentDrawing, x2: x, y2: y });
    }
  }, [isDrawing, currentDrawing]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'none' || activeTool === 'crosshair') return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    const newDrawing: CurrentDrawing = {
      type: activeTool,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      color: styleConfig.drawingColor,
    };
    setCurrentDrawing(newDrawing);
  }, [activeTool, styleConfig.drawingColor]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && currentDrawing && canvasRef.current) {
      const getPrice = (py: number) => canvasRef.current?.getYPrice(py) || 0;
      const price1 = getPrice(currentDrawing.y1);
      const price2 = currentDrawing.y2 !== undefined ? getPrice(currentDrawing.y2) : undefined;

      const newSavedDrawing: Drawing = {
        id: Date.now().toString(),
        type: currentDrawing.type,
        x1: currentDrawing.x1,
        x2: currentDrawing.x2,
        price1: price1,
        price2: price2,
        color: currentDrawing.color,
      };
      setDrawings((prev) => [...prev, newSavedDrawing]);
      setCurrentDrawing(null);
    }
    setIsDrawing(false);
  }, [isDrawing, currentDrawing]);

  const handleMouseLeave = useCallback(() => {
    setCrosshair(null);
    lastCrosshairRef.current = null;
    if (isDrawing) handleMouseUp();
  }, [isDrawing, handleMouseUp]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedDrawingId) {
      setDrawings((prev) => prev.filter((d) => d.id !== selectedDrawingId));
      setSelectedDrawingId(null);
    }
  }, [selectedDrawingId]);

  const handleClearDrawings = useCallback(() => {
    setDrawings([]);
    setSelectedDrawingId(null);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONT_FAMILY, height: '100%' }}>
      {/* ═══ TOOLBAR ═══ */}
      <div style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Symbols */}
          {SYMBOLS.map((s) => (
            <button
              key={s.name}
              onClick={() => onSwitchSymbol(s)}
              style={{
                padding: '3px 8px',
                borderRadius: 3,
                fontSize: 10,
                cursor: 'pointer',
                fontFamily: FONT_FAMILY,
                fontWeight: symbol === s.name ? 700 : 400,
                background: symbol === s.name ? '#26a69a' : 'transparent',
                color: symbol === s.name ? '#fff' : '#787b86',
                border: `1px solid ${symbol === s.name ? '#26a69a' : '#2B2B43'}`,
              }}
            >
              {s.label}
            </button>
          ))}

          <span style={{ width: 1, height: 14, background: '#2B2B43' }} />

          {/* Controls */}
          <Slider
            label="Δ Threshold"
            value={config.deltaThreshold}
            min={20}
            max={5000}
            step={10}
            onChange={(v) => onUpdateConfig({ deltaThreshold: v })}
            format={formatVolume}
          />

          <span style={{ width: 1, height: 14, background: '#2B2B43' }} />

          <Slider
            label="Passo"
            value={pipDisplay}
            min={0.1}
            max={200}
            step={0.1}
            onChange={(v) => onUpdateConfig({ priceLevelSize: v / Math.pow(10, digits) })}
            format={(v) => `${v}pts`}
          />

          <span style={{ width: 1, height: 14, background: '#2B2B43' }} />

          {/* Render Mode Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#aaa', fontSize: 9 }}>Modo:</span>
            <select
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value as 'grid' | 'raw' | 'hybrid')}
              style={{
                padding: '2px 4px',
                fontSize: 9,
                fontFamily: FONT_FAMILY,
                borderRadius: 3,
                border: '1px solid #2B2B43',
                background: '#2a2e39',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="grid">Limpo (Grid)</option>
              <option value="raw">Preciso (Raw)</option>
              <option value="hybrid">Híbrido</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Drawing Tools */}
          <div style={{ display: 'flex', gap: 2, marginRight: 8, borderRight: '1px solid #333', paddingRight: 8 }}>
            {(['crosshair', 'hline', 'vline', 'rect'] as ToolType[]).map((tool) => (
              <button
                key={tool}
                onClick={() => {
                  setActiveTool(tool);
                  setShowStylePanel(false);
                }}
                style={{
                  padding: '3px 8px',
                  borderRadius: 3,
                  border: '1px solid #2B2B43',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY,
                  background: activeTool === tool ? '#2B2B43' : 'transparent',
                  color: activeTool === tool ? '#fff' : '#787b86',
                }}
              >
                {tool === 'crosshair' ? '✛' : tool === 'hline' ? '─' : tool === 'vline' ? '│' : '▢'}
              </button>
            ))}
          </div>

          <button
            onClick={handleDeleteSelected}
            disabled={!selectedDrawingId}
            style={{
              padding: '3px 8px',
              borderRadius: 3,
              border: '1px solid #2B2B43',
              fontSize: 10,
              cursor: selectedDrawingId ? 'pointer' : 'not-allowed',
              fontFamily: FONT_FAMILY,
              background: 'transparent',
              color: '#ef5350',
              opacity: selectedDrawingId ? 1 : 0.4,
            }}
          >
            🗑 Excluir
          </button>

          <button
            onClick={handleClearDrawings}
            style={{
              padding: '3px 8px',
              borderRadius: 3,
              border: '1px solid #2B2B43',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              background: 'transparent',
              color: '#787b86',
            }}
          >
            🧹 Limpar
          </button>

          <button
            onClick={() => setShowStylePanel(!showStylePanel)}
            style={{
              padding: '3px 8px',
              borderRadius: 3,
              border: '1px solid #2B2B43',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              background: 'transparent',
              color: showStylePanel ? '#ffd740' : '#787b86',
            }}
          >
            🎨 Estilo
          </button>

          <span style={{ width: 1, height: 14, background: '#2B2B43' }} />

          {/* History loading */}
          <span style={{ color: '#555', fontSize: 9 }}>📥</span>
          {[1, 2, 4, 8].map((h) => (
            <ActionButton key={h} onClick={() => onLoadHistory(h)} disabled={isLoadingHistory}>
              {h}h
            </ActionButton>
          ))}
          {isLoadingHistory && <span style={{ color: '#ffd700', fontSize: 9 }}>⏳</span>}

          <span style={{ width: 1, height: 14, background: '#2B2B43' }} />

          {/* Live toggle */}
          <button
            onClick={() => {
              console.log('🔴 [ImbalanceChart] Botão Live clicado!');
              onToggleLive();
            }}
            style={{
              padding: '3px 12px',
              borderRadius: 3,
              border: 'none',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              background: isLive ? '#ef5350' : '#26a69a',
              color: '#fff',
            }}
          >
            {isLive ? '⏹ Parar' : '▶ Live'}
          </button>

          <button
            onClick={onReset}
            style={{
              padding: '3px 8px',
              borderRadius: 3,
              border: '1px solid #555',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              background: 'transparent',
              color: '#aaa',
            }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* ═══ STYLE PANEL ═══ */}
      {showStylePanel && (
        <div
          style={{
            ...rowStyle,
            borderColor: '#ffd740',
            display: 'flex',
            gap: 15,
            background: '#1e222d',
          }}
        >
          <ColorPicker
            label="Alta"
            color={styleConfig.bullColor}
            onChange={(c) => setStyleConfig((s) => ({ ...s, bullColor: c }))}
          />
          <ColorPicker
            label="Baixa"
            color={styleConfig.bearColor}
            onChange={(c) => setStyleConfig((s) => ({ ...s, bearColor: c }))}
          />
          <ColorPicker
            label="POC"
            color={styleConfig.pocColor}
            onChange={(c) => setStyleConfig((s) => ({ ...s, pocColor: c }))}
          />
          <ColorPicker
            label="Desenho"
            color={styleConfig.drawingColor}
            onChange={(c) => setStyleConfig((s) => ({ ...s, drawingColor: c }))}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#aaa', fontSize: 10 }}>Opacidade:</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.1}
              value={styleConfig.bgOpacity}
              onChange={(e) => setStyleConfig((s) => ({ ...s, bgOpacity: parseFloat(e.target.value) }))}
              style={{ width: 60, cursor: 'pointer', accentColor: '#26a69a' }}
            />
          </div>
        </div>
      )}

      {/* ═══ CANVAS ═══ */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 300,
          background: '#0a0d13',
          borderRadius: 4,
          border: '1px solid #1c1f2b',
          overflow: 'hidden',
          position: 'relative',
          cursor: activeTool !== 'none' ? 'crosshair' : 'default',
        }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        tabIndex={0}
      >
        {size.w > 0 && size.h > 0 && (
          <ClusterCanvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            config={config}
            getCalculator={getCalculator}
            clusters={clusters}
            currentCluster={currentCluster}
            selectedCluster={selectedCluster}
            onSelectCluster={onSelectCluster}
            digits={digits}
            crosshair={crosshair}
            drawings={drawings}
            currentDrawing={currentDrawing}
            styleConfig={styleConfig}
            selectedDrawingId={selectedDrawingId}
            onSelectDrawing={setSelectedDrawingId}
            renderMode={renderMode}
          />
        )}
      </div>

      {/* ═══ FORMING CLUSTER INFO ═══ */}
      {currentCluster && (
        <div style={{ ...rowStyle, borderColor: '#ffd74044' }}>
          <span style={{ color: '#ffd740', fontSize: 10, fontWeight: 700 }}>
            🔄 Formando #{currentCluster.id}
          </span>
          <span style={{ color: '#aaa', fontSize: 10 }}>Ticks: {currentCluster.tickCount}</span>
          <span
            style={{
              color: currentCluster.delta >= 0 ? '#26a69a' : '#ef5350',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Δ: {currentCluster.delta >= 0 ? '+' : ''}
            {formatVolume(currentCluster.delta)} / {formatVolume(config.deltaThreshold)}
          </span>
          <div style={{ width: 80, height: 5, background: '#1c1f2b', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, (Math.abs(currentCluster.delta) / config.deltaThreshold) * 100)}%`,
                height: '100%',
                background: currentCluster.delta >= 0 ? '#26a69a' : '#ef5350',
                transition: 'width 0.1s',
              }}
            />
          </div>
          <span style={{ color: '#aaa', fontSize: 10 }}>Vol: {formatVolume(currentCluster.volumeTotal)}</span>
        </div>
      )}

      {/* ═══ SELECTED CLUSTER INFO ═══ */}
      {selectedCluster && (
        <div style={{ ...rowStyle, borderColor: '#ffd740', gap: 10 }}>
          <span style={{ color: '#ffd740', fontSize: 10, fontWeight: 700 }}>📊 #{selectedCluster.id}</span>
          <span style={{ color: '#787b86', fontSize: 9 }}>
            {new Date(selectedCluster.startTime).toLocaleTimeString('pt-BR')}
          </span>
          <span style={{ color: '#cdd0dc', fontSize: 9 }}>
            O:{selectedCluster.open.toFixed(digits)} → C:{selectedCluster.close.toFixed(digits)}
          </span>
          <span
            style={{
              color: selectedCluster.delta >= 0 ? '#26a69a' : '#ef5350',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Δ:{(selectedCluster.delta >= 0 ? '+' : '') + formatVolume(selectedCluster.delta)}
          </span>
          <span style={{ color: '#26a69a', fontSize: 9 }}>Buy:{formatVolume(selectedCluster.volumeBuy)}</span>
          <span style={{ color: '#ef5350', fontSize: 9 }}>Sell:{formatVolume(selectedCluster.volumeSell)}</span>
          <span style={{ color: '#ffd740', fontSize: 9 }}>POC:{selectedCluster.poc.toFixed(digits)}</span>
        </div>
      )}

      {/* Footer hints */}
      <div style={{ padding: '2px 10px', fontSize: 8, color: '#444', display: 'flex', gap: 12 }}>
        <span>🖱 Scroll: navegar</span>
        <span>Ctrl+Scroll: zoom</span>
        <span>🎨: Configurar cores</span>
      </div>
    </div>
  );
});

ImbalanceChart.displayName = 'ImbalanceChart';
