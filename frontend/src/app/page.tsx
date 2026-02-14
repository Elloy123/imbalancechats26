import { useState, useEffect, useRef, useCallback } from 'react';

// ==========================================
// TIPOS
// ==========================================

interface TickData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume_synthetic: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

interface ClusterData {
  id: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBuy: number;
  volumeSell: number;
  volumeTotal: number;
  delta: number;
  tickCount: number;
  startTime: number;
  endTime?: number;
  isClosed: boolean;
  priceLevels: Map<number, { buy: number; sell: number }>;
}

interface Drawing {
  id: number;
  type: 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci';
  points: { x: number; y: number }[];
  color: string;
}

// ==========================================
// CONFIGURAÇÃO
// ==========================================

const SYMBOLS = [
  { name: 'EURUSD', label: 'EUR/USD', digits: 5, deltaThreshold: 50, pipSize: 0.0001 },
  { name: 'GBPUSD', label: 'GBP/USD', digits: 5, deltaThreshold: 60, pipSize: 0.0001 },
  { name: 'XAUUSD', label: 'XAU/USD', digits: 2, deltaThreshold: 100, pipSize: 0.01 },
  { name: 'USTEC', label: 'USTEC', digits: 2, deltaThreshold: 150, pipSize: 0.01 },
];

const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws';

// ==========================================
// GRÁFICO AVANÇADO
// ==========================================

function AdvancedChart({
  clusters,
  symbol,
  threshold,
  drawings,
  onAddDrawing,
  onDeleteDrawing,
  selectedTool,
  showVolume,
  showDelta,
  showFootprint
}: {
  clusters: ClusterData[];
  symbol: string;
  threshold: number;
  drawings: Drawing[];
  onAddDrawing: (d: Drawing) => void;
  onDeleteDrawing: (id: number) => void;
  selectedTool: string;
  showVolume: boolean;
  showDelta: boolean;
  showFootprint: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const preset = SYMBOLS.find(s => s.name === symbol) || SYMBOLS[0];

  // Estado de visualização
  const [viewState, setViewState] = useState({
    offsetX: 0,
    scale: 1,
    candleWidth: 30,
    priceMin: 0,
    priceMax: 0,
  });

  // Estado de desenho
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ClusterData | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const drawingIdRef = useRef(1);

  // Calcular range de preço
  useEffect(() => {
    if (clusters.length === 0) return;

    const visible = getVisibleClusters();
    if (visible.length === 0) return;

    let minP = Infinity, maxP = -Infinity;
    visible.forEach(c => {
      minP = Math.min(minP, c.low);
      maxP = Math.max(maxP, c.high);
    });

    const pad = (maxP - minP) * 0.1 || preset.pipSize * 50;
    setViewState(prev => ({
      ...prev,
      priceMin: minP - pad,
      priceMax: maxP + pad,
    }));
  }, [clusters, viewState.offsetX, viewState.scale]);

  // Obter clusters visíveis
  const getVisibleClusters = useCallback(() => {
    if (!canvasRef.current) return clusters;
    const canvas = canvasRef.current;
    const candleW = viewState.candleWidth * viewState.scale;
    const visibleCount = Math.ceil(canvas.width / candleW) + 2;
    const startIdx = Math.max(0, Math.floor(-viewState.offsetX / candleW));
    return clusters.slice(startIdx, startIdx + visibleCount);
  }, [clusters, viewState]);

  // Converter coordenadas
  const priceToY = useCallback((price: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const chartH = canvas.height - 100;
    return ((viewState.priceMax - price) / (viewState.priceMax - viewState.priceMin)) * chartH + 30;
  }, [viewState.priceMin, viewState.priceMax]);

  const yToPrice = useCallback((y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const chartH = canvas.height - 100;
    return viewState.priceMax - ((y - 30) / chartH) * (viewState.priceMax - viewState.priceMin);
  }, [viewState.priceMin, viewState.priceMax]);

  const clusterToX = useCallback((index: number) => {
    const candleW = viewState.candleWidth * viewState.scale;
    return index * candleW + viewState.offsetX + candleW / 2;
  }, [viewState.offsetX, viewState.scale]);

  const xToClusterIndex = useCallback((x: number) => {
    const candleW = viewState.candleWidth * viewState.scale;
    return Math.floor((x - viewState.offsetX) / candleW);
  }, [viewState.offsetX, viewState.scale]);

  // Desenhar
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajustar tamanho
    if (containerRef.current) {
      canvas.width = containerRef.current.clientWidth;
      canvas.height = containerRef.current.clientHeight;
    }

    const candleW = viewState.candleWidth * viewState.scale;
    const chartW = canvas.width;
    const chartH = canvas.height - 100;
    const volumeH = 60;

    // Fundo
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clusters visíveis
    const visible = getVisibleClusters();
    if (visible.length === 0) {
      ctx.fillStyle = '#555';
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Clique em LIVE para iniciar', chartW / 2, chartH / 2);
      return;
    }

    // ==========================================
    // GRID DE PREÇO
    // ==========================================

    ctx.strokeStyle = '#1a1f2e';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);

    const priceStep = (viewState.priceMax - viewState.priceMin) / 8;
    for (let i = 0; i <= 8; i++) {
      const price = viewState.priceMax - priceStep * i;
      const y = priceToY(price);

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();

      // Label de preço
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(preset.digits), chartW - 5, y + 4);
    }

    // ==========================================
    // CLUSTERS (CANDLESTICKS)
    // ==========================================

    visible.forEach((cluster, i) => {
      const globalIdx = clusters.indexOf(cluster);
      const x = clusterToX(globalIdx);
      const w = candleW - 4;

      if (x < -w || x > chartW + w) return;

      const isBull = cluster.close >= cluster.open;
      const color = cluster.isClosed
        ? (isBull ? '#26a69a' : '#ef5350')
        : '#ffd740';

      const bodyTop = priceToY(Math.max(cluster.open, cluster.close));
      const bodyBot = priceToY(Math.min(cluster.open, cluster.close));
      const bodyH = Math.max(2, bodyBot - bodyTop);

      // Sombra (wick)
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, candleW / 15);
      ctx.beginPath();
      ctx.moveTo(x, priceToY(cluster.high));
      ctx.lineTo(x, priceToY(cluster.low));
      ctx.stroke();

      // Corpo
      ctx.fillStyle = cluster.isClosed
        ? (isBull ? '#26a69a' : '#ef5350')
        : color + '88';
      ctx.fillRect(x - w / 2, bodyTop, w, bodyH);

      // Borda do cluster atual (formando)
      if (!cluster.isClosed) {
        ctx.strokeStyle = '#ffd740';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - w / 2 - 1, bodyTop - 1, w + 2, bodyH + 2);
        ctx.setLineDash([]);
      }

      // Delta acima do candle
      if (showDelta) {
        ctx.fillStyle = cluster.delta >= 0 ? '#26a69a' : '#ef5350';
        ctx.font = `bold ${Math.max(8, candleW / 4)}px monospace`;
        ctx.textAlign = 'center';
        const deltaText = (cluster.delta >= 0 ? '+' : '') + cluster.delta;
        ctx.fillText(deltaText, x, priceToY(cluster.high) - 5);
      }

      // Histograma de volume
      if (showVolume) {
        const volH = Math.min(volumeH - 5, (cluster.volumeTotal / 10) * viewState.scale);
        const volY = chartH + 30;

        ctx.fillStyle = isBull ? '#26a69a44' : '#ef535044';
        ctx.fillRect(x - w / 2, volY + volumeH - volH, w, volH);

        // Barra de delta no volume
        const deltaH = Math.abs(cluster.delta) / threshold * volH;
        ctx.fillStyle = cluster.delta >= 0 ? '#26a69a' : '#ef5350';
        ctx.fillRect(x - w / 2, volY + volumeH - deltaH, w, Math.min(deltaH, volH));
      }

      // Footprint (volume por preço) - apenas no hover
      if (showFootprint && hoveredCluster === cluster && cluster.priceLevels.size > 0) {
        const fpX = x + w / 2 + 5;
        let fpY = priceToY(cluster.high);

        ctx.fillStyle = '#111520ee';
        ctx.fillRect(fpX, fpY - 10, 80, Math.min(200, cluster.priceLevels.size * 12));

        ctx.font = '8px monospace';
        cluster.priceLevels.forEach((vol, price) => {
          if (price >= cluster.low && price <= cluster.high) {
            const y = priceToY(price);
            ctx.fillStyle = vol.buy > vol.sell ? '#26a69a' : '#ef5350';
            ctx.textAlign = 'left';
            ctx.fillText(`${vol.buy.toFixed(0)}×${vol.sell.toFixed(0)}`, fpX + 5, y + 4);
          }
        });
      }
    });

    // ==========================================
    // DESENHOS
    // ==========================================

    drawings.forEach(d => {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      if (d.type === 'trendline' && d.points.length === 2) {
        ctx.beginPath();
        ctx.moveTo(d.points[0].x, d.points[0].y);
        ctx.lineTo(d.points[1].x, d.points[1].y);
        ctx.stroke();

        // Extender linha
        const dx = d.points[1].x - d.points[0].x;
        const dy = d.points[1].y - d.points[0].y;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(d.points[0].x - dx * 10, d.points[0].y - dy * 10);
        ctx.lineTo(d.points[1].x + dx * 10, d.points[1].y + dy * 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.type === 'horizontal' && d.points.length >= 1) {
        const price = yToPrice(d.points[0].y);
        const y = priceToY(price);
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = d.color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(price.toFixed(preset.digits), 5, y - 3);
      }

      if (d.type === 'rectangle' && d.points.length === 2) {
        ctx.fillStyle = d.color + '22';
        ctx.fillRect(
          Math.min(d.points[0].x, d.points[1].x),
          Math.min(d.points[0].y, d.points[1].y),
          Math.abs(d.points[1].x - d.points[0].x),
          Math.abs(d.points[1].y - d.points[0].y)
        );
        ctx.strokeRect(
          Math.min(d.points[0].x, d.points[1].x),
          Math.min(d.points[0].y, d.points[1].y),
          Math.abs(d.points[1].x - d.points[0].x),
          Math.abs(d.points[1].y - d.points[0].y)
        );
      }

      if (d.type === 'fibonacci' && d.points.length === 2) {
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const colors = ['#26a69a', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800'];

        const y1 = d.points[0].y;
        const y2 = d.points[1].y;
        const h = y2 - y1;

        levels.forEach((level, i) => {
          const y = y1 + h * level;
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartW, y);
          ctx.stroke();

          ctx.fillStyle = colors[i];
          ctx.font = '9px monospace';
          ctx.fillText(`${(level * 100).toFixed(1)}%`, 5, y - 2);
        });
        ctx.setLineDash([]);
      }
    });

    // ==========================================
    // DESENHO ATUAL
    // ==========================================

    if (isDrawing && drawStart && drawEnd && selectedTool !== 'none') {
      ctx.strokeStyle = '#ffd740';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      if (selectedTool === 'trendline' || selectedTool === 'fibonacci') {
        ctx.beginPath();
        ctx.moveTo(drawStart.x, drawStart.y);
        ctx.lineTo(drawEnd.x, drawEnd.y);
        ctx.stroke();
      }

      if (selectedTool === 'horizontal') {
        ctx.beginPath();
        ctx.moveTo(0, drawStart.y);
        ctx.lineTo(chartW, drawStart.y);
        ctx.stroke();
      }

      if (selectedTool === 'rectangle') {
        ctx.strokeRect(
          Math.min(drawStart.x, drawEnd.x),
          Math.min(drawStart.y, drawEnd.y),
          Math.abs(drawEnd.x - drawStart.x),
          Math.abs(drawEnd.y - drawStart.y)
        );
      }

      ctx.setLineDash([]);
    }

    // ==========================================
    // CROSSHAIR
    // ==========================================

    if (mousePos.x > 0 && mousePos.y > 0) {
      ctx.strokeStyle = '#ffffff33';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      // Linha vertical
      ctx.beginPath();
      ctx.moveTo(mousePos.x, 0);
      ctx.lineTo(mousePos.x, chartH + volumeH);
      ctx.stroke();

      // Linha horizontal
      ctx.beginPath();
      ctx.moveTo(0, mousePos.y);
      ctx.lineTo(chartW, mousePos.y);
      ctx.stroke();

      ctx.setLineDash([]);

      // Preço no crosshair
      const price = yToPrice(mousePos.y);
      ctx.fillStyle = '#ffd740';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(preset.digits), mousePos.x + 5, mousePos.y - 5);
    }

    // ==========================================
    // INFO HEADER
    // ==========================================

    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(preset.label, 10, 20);

    if (hoveredCluster) {
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.fillText(
        `#${hoveredCluster.id} | O: ${hoveredCluster.open.toFixed(preset.digits)} H: ${hoveredCluster.high.toFixed(preset.digits)} L: ${hoveredCluster.low.toFixed(preset.digits)} C: ${hoveredCluster.close.toFixed(preset.digits)} | Δ: ${hoveredCluster.delta} | Vol: ${hoveredCluster.volumeTotal}`,
        10, 38
      );
    }

  }, [clusters, viewState, drawings, selectedTool, isDrawing, drawStart, drawEnd, hoveredCluster, mousePos, showVolume, showDelta, showFootprint, preset, getVisibleClusters, priceToY, yToPrice, clusterToX, threshold]);

  // ==========================================
  // EVENT HANDLERS
  // ==========================================

  // Scroll (rolagem)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // Zoom
      setViewState(prev => ({
        ...prev,
        scale: Math.max(0.3, Math.min(3, prev.scale - e.deltaY * 0.001)),
      }));
    } else {
      // Scroll horizontal
      setViewState(prev => ({
        ...prev,
        offsetX: Math.min(0, prev.offsetX - e.deltaY * 0.5),
      }));
    }
  }, []);

  // Mouse events para desenho
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (selectedTool === 'none') return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setDrawStart({ x, y });
    setDrawEnd({ x, y });
  }, [selectedTool]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x, y });

    // Hover no cluster
    const idx = xToClusterIndex(x);
    if (idx >= 0 && idx < clusters.length) {
      setHoveredCluster(clusters[idx]);
    } else {
      setHoveredCluster(null);
    }

    if (isDrawing && drawStart) {
      setDrawEnd({ x, y });
    }
  }, [isDrawing, drawStart, xToClusterIndex, clusters]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !drawStart || !drawEnd) {
      setIsDrawing(false);
      return;
    }

    const colors = {
      trendline: '#26a69a',
      horizontal: '#ffd740',
      rectangle: '#2196f3',
      fibonacci: '#e91e63',
    };

    const drawing: Drawing = {
      id: drawingIdRef.current++,
      type: selectedTool as Drawing['type'],
      points: selectedTool === 'horizontal' ? [drawStart] : [drawStart, drawEnd],
      color: colors[selectedTool as keyof typeof colors] || '#ffffff',
    };

    onAddDrawing(drawing);
    setIsDrawing(false);
    setDrawStart(null);
    setDrawEnd(null);
  }, [isDrawing, drawStart, drawEnd, selectedTool, onAddDrawing]);

  // Sair do canvas
  const handleMouseLeave = useCallback(() => {
    setMousePos({ x: -1, y: -1 });
    setHoveredCluster(null);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        background: '#0a0d13',
        borderRadius: 4,
        overflow: 'hidden',
        height: 480,
        position: 'relative'
      }}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: selectedTool !== 'none' ? 'crosshair' : 'default' }}
      />

      {/* Controles de zoom */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        gap: 5
      }}>
        <button
          onClick={() => setViewState(prev => ({ ...prev, scale: Math.min(3, prev.scale * 1.2) }))}
          style={{ padding: '4px 8px', background: '#1a1f2e', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
        >+</button>
        <button
          onClick={() => setViewState(prev => ({ ...prev, scale: Math.max(0.3, prev.scale / 1.2) }))}
          style={{ padding: '4px 8px', background: '#1a1f2e', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
        >−</button>
        <button
          onClick={() => setViewState(prev => ({ ...prev, scale: 1, offsetX: 0 }))}
          style={{ padding: '4px 8px', background: '#1a1f2e', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
        >⟲</button>
      </div>
    </div>
  );
}

// ==========================================
// APP
// ==========================================

export default function App() {
  // Estados principais
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [currentCluster, setCurrentCluster] = useState<ClusterData | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [symbol, setSymbol] = useState('EURUSD');
  const [threshold, setThreshold] = useState(50);
  const [ticks, setTicks] = useState(0);

  // Status de conexão
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mt5Status, setMt5Status] = useState(false);

  // Ferramentas
  const [selectedTool, setSelectedTool] = useState('none');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [showVolume, setShowVolume] = useState(true);
  const [showDelta, setShowDelta] = useState(true);
  const [showFootprint, setShowFootprint] = useState(true);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const clusterRef = useRef<ClusterData | null>(null);
  const clusterIdRef = useRef(1);
  const thresholdRef = useRef(50);

  const preset = SYMBOLS.find(s => s.name === symbol) || SYMBOLS[0];

  // Sincronizar refs
  useEffect(() => { thresholdRef.current = threshold; }, [threshold]);

  // ==========================================
  // PROCESSAR TICK
  // ==========================================

  const processTick = (tick: TickData) => {
    const vol = Math.round(tick.volume_synthetic || 1);
    const th = thresholdRef.current;

    if (!clusterRef.current) {
      clusterRef.current = {
        id: clusterIdRef.current++,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volumeBuy: tick.side === 'buy' ? vol : 0,
        volumeSell: tick.side === 'sell' ? vol : 0,
        volumeTotal: vol,
        delta: tick.side === 'buy' ? vol : -vol,
        tickCount: 1,
        startTime: tick.timestamp,
        isClosed: false,
        priceLevels: new Map([[tick.price, {
          buy: tick.side === 'buy' ? vol : 0,
          sell: tick.side === 'sell' ? vol : 0
        }]]),
      };
    } else {
      const c = clusterRef.current;
      c.high = Math.max(c.high, tick.price);
      c.low = Math.min(c.low, tick.price);
      c.close = tick.price;
      c.tickCount++;
      c.volumeTotal += vol;
      if (tick.side === 'buy') { c.volumeBuy += vol; c.delta += vol; }
      else { c.volumeSell += vol; c.delta -= vol; }

      // Atualizar price levels
      const level = c.priceLevels.get(tick.price) || { buy: 0, sell: 0 };
      if (tick.side === 'buy') level.buy += vol;
      else level.sell += vol;
      c.priceLevels.set(tick.price, level);
    }

    // Fechar cluster?
    if (Math.abs(clusterRef.current.delta) >= th) {
      clusterRef.current.isClosed = true;
      clusterRef.current.endTime = tick.timestamp;
      setClusters(prev => [...prev.slice(-150), { ...clusterRef.current!, priceLevels: new Map(clusterRef.current!.priceLevels) }]);
      clusterRef.current = null;
      setCurrentCluster(null);
    } else {
      setCurrentCluster({ ...clusterRef.current, priceLevels: new Map(clusterRef.current.priceLevels) });
    }

    setTicks(t => t + 1);
  };

  // ==========================================
  // WEBSOCKET
  // ==========================================

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!isLive) {
      setWsStatus('disconnected');
      return;
    }

    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') setMt5Status(msg.data.mt5_connected);
        else if (msg.type === 'tick') processTick(msg.data);
      } catch (err) { }
    };
    ws.onerror = () => { };
    ws.onclose = () => {
      setWsStatus('disconnected');
      wsRef.current = null;
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isLive]);

  // ==========================================
  // HISTÓRICO
  // ==========================================

  const loadHistory = async (hours: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/history/${symbol}?hours=${hours}`);
      const data = await res.json();

      if (data.ticks?.length > 0) {
        setClusters([]);
        setCurrentCluster(null);
        clusterRef.current = null;
        clusterIdRef.current = 1;
        data.ticks.forEach((t: TickData) => processTick(t));
      }
    } catch (e) { }
  };

  // ==========================================
  // TROCAR SÍMBOLO
  // ==========================================

  const switchSymbol = async (sym: string) => {
    setSymbol(sym);
    setClusters([]);
    setCurrentCluster(null);
    clusterRef.current = null;
    clusterIdRef.current = 1;
    setTicks(0);
    const p = SYMBOLS.find(s => s.name === sym);
    if (p) setThreshold(p.deltaThreshold);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'switch_symbol', symbol: sym }));
    }
    fetch(`${BACKEND_URL}/switch_symbol/${sym}`, { method: 'POST' }).catch(() => { });
  };

  // ==========================================
  // DESENHOS
  // ==========================================

  const addDrawing = (d: Drawing) => setDrawings(prev => [...prev, d]);
  const deleteDrawing = (id: number) => setDrawings(prev => prev.filter(d => d.id !== id));
  const clearDrawings = () => setDrawings([]);

  // ==========================================
  // RENDER
  // ==========================================

  const allClusters = [
    ...clusters.filter(c => c?.high !== undefined),
    ...(currentCluster && currentCluster.high !== undefined ? [currentCluster] : [])
  ];

  return (
    <div style={{ padding: 12, background: '#0b0e14', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ color: '#26a69a', margin: 0, fontSize: 18 }}>📊 Imbalance Chart Pro</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            padding: '3px 8px',
            background: wsStatus === 'connected' ? '#26a69a22' : '#ef535022',
            border: `1px solid ${wsStatus === 'connected' ? '#26a69a' : '#ef5350'}`,
            borderRadius: 3,
            fontSize: 10,
            color: wsStatus === 'connected' ? '#26a69a' : '#ef5350'
          }}>
            {wsStatus === 'connected' ? '🟢 WS' : wsStatus === 'connecting' ? '🟡...' : '🔴 WS'}
          </span>
          <span style={{
            padding: '3px 8px',
            background: mt5Status ? '#26a69a22' : '#ffd74022',
            border: `1px solid ${mt5Status ? '#26a69a' : '#ffd740'}`,
            borderRadius: 3,
            fontSize: 10,
            color: mt5Status ? '#26a69a' : '#ffd740'
          }}>
            {mt5Status ? '✅ MT5' : '⚠️ SIM'}
          </span>
          <span style={{ color: '#666', fontSize: 10 }}>Ticks: {ticks}</span>
        </div>
      </div>

      {/* Símbolos */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {SYMBOLS.map(s => (
          <button
            key={s.name}
            onClick={() => switchSymbol(s.name)}
            style={{
              padding: '6px 12px',
              background: symbol === s.name ? '#26a69a' : '#1a1f2e',
              color: symbol === s.name ? '#fff' : '#888',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Controles principais */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Threshold */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#666', fontSize: 10 }}>Δ:</span>
          <input
            type="range"
            min="10"
            max="500"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            style={{ width: 60, accentColor: '#26a69a' }}
          />
          <span style={{ color: '#26a69a', fontSize: 11, width: 25 }}>{threshold}</span>
        </div>

        {/* Histórico */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[1, 2, 4].map(h => (
            <button
              key={h}
              onClick={() => loadHistory(h)}
              disabled={!mt5Status}
              style={{
                padding: '4px 8px',
                background: mt5Status ? '#1a1f2e' : '#111',
                color: mt5Status ? '#fff' : '#444',
                border: 'none',
                borderRadius: 3,
                cursor: mt5Status ? 'pointer' : 'not-allowed',
                fontSize: 10
              }}
            >
              {h}h
            </button>
          ))}
        </div>

        {/* Live */}
        <button
          onClick={() => setIsLive(!isLive)}
          style={{
            padding: '6px 16px',
            background: isLive ? '#ef5350' : '#26a69a',
            color: '#fff',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 11
          }}
        >
          {isLive ? '⏹' : '▶ LIVE'}
        </button>

        <button
          onClick={() => { setClusters([]); setCurrentCluster(null); clusterRef.current = null; setTicks(0); }}
          style={{ padding: '6px 10px', background: '#1a1f2e', color: '#888', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}
        >
          ↺
        </button>
      </div>

      {/* Ferramentas de desenho */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#666', fontSize: 10, marginRight: 4 }}>Ferramentas:</span>

        {[
          { id: 'none', label: '🖱️', title: 'Navegar' },
          { id: 'trendline', label: '/', title: 'Linha de Tendência' },
          { id: 'horizontal', label: '─', title: 'Linha Horizontal' },
          { id: 'rectangle', label: '▢', title: 'Retângulo' },
          { id: 'fibonacci', label: 'φ', title: 'Fibonacci' },
        ].map(tool => (
          <button
            key={tool.id}
            onClick={() => setSelectedTool(tool.id)}
            title={tool.title}
            style={{
              padding: '4px 10px',
              background: selectedTool === tool.id ? '#26a69a' : '#1a1f2e',
              color: selectedTool === tool.id ? '#fff' : '#888',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            {tool.label}
          </button>
        ))}

        <button
          onClick={clearDrawings}
          title="Limpar desenhos"
          style={{
            padding: '4px 10px',
            background: '#1a1f2e',
            color: '#ef5350',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10
          }}
        >
          ✕ Desenhos ({drawings.length})
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            onClick={() => setShowVolume(!showVolume)}
            style={{
              padding: '3px 8px',
              background: showVolume ? '#26a69a44' : '#1a1f2e',
              color: showVolume ? '#26a69a' : '#666',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9
            }}
          >
            VOL
          </button>
          <button
            onClick={() => setShowDelta(!showDelta)}
            style={{
              padding: '3px 8px',
              background: showDelta ? '#26a69a44' : '#1a1f2e',
              color: showDelta ? '#26a69a' : '#666',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9
            }}
          >
            Δ
          </button>
          <button
            onClick={() => setShowFootprint(!showFootprint)}
            style={{
              padding: '3px 8px',
              background: showFootprint ? '#26a69a44' : '#1a1f2e',
              color: showFootprint ? '#26a69a' : '#666',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9
            }}
          >
            FP
          </button>
        </div>
      </div>

      {/* Gráfico */}
      <AdvancedChart
        clusters={allClusters}
        symbol={symbol}
        threshold={threshold}
        drawings={drawings}
        onAddDrawing={addDrawing}
        onDeleteDrawing={deleteDrawing}
        selectedTool={selectedTool}
        showVolume={showVolume}
        showDelta={showDelta}
        showFootprint={showFootprint}
      />

      {/* Info do cluster atual */}
      {currentCluster && (
        <div style={{
          marginTop: 8,
          padding: 8,
          background: '#111520',
          borderRadius: 4,
          display: 'flex',
          gap: 15,
          alignItems: 'center',
          fontSize: 11
        }}>
          <span style={{ color: '#ffd740' }}>🔄 #{currentCluster.id}</span>
          <span>
            Preço: <strong style={{ color: currentCluster.close >= currentCluster.open ? '#26a69a' : '#ef5350', fontSize: 14 }}>
              {currentCluster.close.toFixed(preset.digits)}
            </strong>
          </span>
          <span style={{ color: '#666' }}>
            H: {currentCluster.high.toFixed(preset.digits)} L: {currentCluster.low.toFixed(preset.digits)}
          </span>
          <span>Δ: <strong style={{ color: currentCluster.delta >= 0 ? '#26a69a' : '#ef5350' }}>
            {currentCluster.delta >= 0 ? '+' : ''}{currentCluster.delta}
          </strong></span>
          <span style={{ color: '#666' }}>Vol: {currentCluster.volumeTotal}</span>

          {/* Progresso */}
          <div style={{ flex: 1, maxWidth: 200 }}>
            <div style={{ background: '#1a1f2e', borderRadius: 2, height: 4, overflow: 'hidden' }}>
              <div style={{
                background: currentCluster.delta >= 0 ? '#26a69a' : '#ef5350',
                height: '100%',
                width: `${Math.min(100, (Math.abs(currentCluster.delta) / threshold) * 100)}%`,
              }} />
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#666' }}>
            {Math.round((Math.abs(currentCluster.delta) / threshold) * 100)}%
          </span>
        </div>
      )}

      {/* Atalhos */}
      <div style={{ marginTop: 8, fontSize: 9, color: '#444' }}>
        <strong>Atalhos:</strong> Scroll = rolar | Ctrl+Scroll = zoom | Clique e arraste para desenhar
      </div>
    </div>
  );
}
