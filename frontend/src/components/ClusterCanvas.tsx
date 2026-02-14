// src/components/ClusterCanvas.tsx
import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import type { ClusterData, ClusterConfig } from '../types';
import type { ClusterCalculator } from '../utils/clusterCalculator';

export interface ClusterCanvasHandle {
  getYPrice: (yPixel: number) => number;
}

export interface StyleConfig {
  bullColor: string;
  bearColor: string;
  pocColor: string;
  bgOpacity: number;
  gridColor: string;
  crosshairColor: string;
  drawingColor: string;
}

export interface Drawing {
  id: string;
  type: 'hline' | 'vline' | 'rect';
  x1: number;
  x2?: number;
  price1: number;
  price2?: number;
  color: string;
}

export interface CurrentDrawing {
  type: 'hline' | 'vline' | 'rect';
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  color: string;
}

interface Props {
  width: number;
  height: number;
  config: ClusterConfig;
  getCalculator: () => ClusterCalculator;
  clusters: ClusterData[];
  currentCluster: ClusterData | null;
  selectedCluster: ClusterData | null;
  onSelectCluster: (c: ClusterData | null) => void;
  digits: number;
  styleConfig: StyleConfig;
  drawings: Drawing[];
  currentDrawing: CurrentDrawing | null;
  selectedDrawingId: string | null;
  onSelectDrawing: (id: string | null) => void;
  crosshair: { x: number; y: number } | null;
  renderMode: 'grid' | 'raw' | 'hybrid' | 'classic';
}

const COLORS = {
  bg: '#0a0d13',
  panel: '#111520',
  grid: '#171c28',
  sep: '#2a3040',
  text: '#5d6588',
  textMid: '#8890a8',
  textHi: '#cdd0dc',
  bull: '#26a69a',
  bear: '#ef5350',
  selected: '#ffd740',
  forming: 'rgba(255,215,0,0.3)',
  crossLabel: '#363c52',
  volBody: 'rgba(38,166,154,0.6)',
  volWick: 'rgba(38,166,154,0.2)',
  volBodyBear: 'rgba(239,83,80,0.6)',
  volWickBear: 'rgba(239,83,80,0.2)',
};

const FONT_FAMILY = 'Consolas,"Courier New",monospace';

const PRICE_W = 50;
const TIME_H = 20;
const VOL_H = 70;
const RIGHT_MARGIN = 20;
const MIN_COL = 6;
const MAX_COL = 220;

// ✅ CORREÇÃO 1: Funções helper fora do componente para evitar re-criação
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const formatVolume = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toString();
};

const padZero = (n: number): string => n.toString().padStart(2, '0');

const calculateGridStep = (range: number, px: number): number => {
  const t = Math.max(4, px / 40);
  const raw = range / t;
  const m = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / m;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * m;
};

const ClusterCanvasComponent: React.ForwardRefRenderFunction<ClusterCanvasHandle, Props> = (
  {
    width,
    height,
    config,
    getCalculator,
    clusters,
    currentCluster,
    selectedCluster,
    onSelectCluster,
    digits,
    styleConfig,
    drawings,
    currentDrawing,
    selectedDrawingId,
    onSelectDrawing,
    crosshair,
    renderMode,
  },
  ref
) => {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [scroll, setScroll] = useState(0);
  const [zoom, setZoom] = useState(1.0);

  // ✅ CORREÇÃO 2: Refs para controle de estado sem causar re-render
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ sx: number; so: number; moved: boolean } | null>(null);
  const hoverRef = useRef<number>(-1);

  // ✅ CORREÇÃO 3: Escala travada com buffer para evitar esticamento
  const scaleRef = useRef({
    pH: 0,
    pL: 0,
    tpr: 0,
    chartH: 0,
    locked: false,
    lastUpdate: 0
  });

  const chartW = width - PRICE_W - RIGHT_MARGIN;
  const chartH = height - TIME_H - VOL_H;

  // ✅ CORREÇÃO 4: useCallback estável para getColW
  const getColW = useCallback(
    (n: number) => {
      const base = chartW / Math.min(n, 25);
      return Math.min(MAX_COL, Math.max(MIN_COL, base * zoom));
    },
    [chartW, zoom]
  );

  // ✅ CORREÇÃO 5: useMemo para clusters estáveis
  const allC = useCallback((): ClusterData[] => {
    return clusters;
  }, [clusters]);

  // ✅ CORREÇÃO 6: Hover detection com debounce
  const getHoveredDrawing = useCallback((mx: number, my: number): string | null => {
    const tol = 5;
    const { pH, tpr, chartH } = scaleRef.current;
    if (tpr === 0) return null;

    const p2y = (p: number) => ((pH - p) / tpr) * chartH;

    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      const dY1 = p2y(d.price1);

      if (d.type === 'hline') {
        if (Math.abs(my - dY1) < tol) return d.id;
      } else if (d.type === 'vline') {
        if (Math.abs(mx - d.x1) < tol) return d.id;
      } else if (d.type === 'rect' && d.price2 !== undefined && d.x2 !== undefined) {
        const dY2 = p2y(d.price2);
        const top = Math.min(dY1, dY2);
        const bot = Math.max(dY1, dY2);
        const left = Math.min(d.x1, d.x2);
        const right = Math.max(d.x1, d.x2);
        if (mx >= left && mx <= right && my >= top && my <= bot) return d.id;
      }
    }
    return null;
  }, [drawings]);

  // ✅ CORREÇÃO 7: Função de draw estável com controle de escala
  const draw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) {
      console.log('❌ [ClusterCanvas] Canvas ref é null');
      return;
    }

    const ctx = cv.getContext('2d');
    if (!ctx) {
      console.log('❌ [ClusterCanvas] Não foi possível obter contexto 2d');
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const mouse = crosshair;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    const all = allC();
    console.log('🎨 [ClusterCanvas] Desenhando...', all.length, 'clusters, tamanho:', width, 'x', height);

    if (all.length === 0) {
      console.log('⚠️ [ClusterCanvas] Sem dados para desenhar');
      ctx.fillStyle = COLORS.textMid;
      ctx.font = `13px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText('Sem dados — carregue histórico ou inicie live feed', width / 2, height / 2);
      ctx.restore();
      return;
    }

    console.log('✅ [ClusterCanvas] Desenhando', all.length, 'clusters');

    const colW = getColW(all.length);
    const visCols = Math.floor(chartW / colW) + 1;
    const endIdx = Math.min(all.length, all.length - scroll);
    const startIdx = Math.max(0, endIdx - visCols);

    if (endIdx <= 0) {
      ctx.restore();
      return;
    }

    // ✅ CORREÇÃO 8: Calcular range com proteção contra esticamento
    let pH = -Infinity;
    let pL = Infinity;

    for (let i = startIdx; i < endIdx; i++) {
      pH = Math.max(pH, all[i].high);
      pL = Math.min(pL, all[i].low);
    }

    const pr = pH - pL;
    const pad = pr * 0.08 || config.priceLevelSize * 10;
    const newPH = pH + pad;
    const newPL = pL - pad;
    const newTPR = newPH - newPL;

    // ✅ CORREÇÃO CRÍTICA: Só atualiza escala se mudança for significativa (> 1%)
    const currentScale = scaleRef.current;
    const now = Date.now();

    if (currentScale.tpr > 0) {
      const rangeChangeRatio = newTPR / currentScale.tpr;

      // Se a mudança é menor que 1%, mantém a escala atual (evita tremor/esticamento)
      if (rangeChangeRatio > 0.99 && rangeChangeRatio < 1.01) {
        // Mantém escala anterior
        pH = currentScale.pH;
        pL = currentScale.pL;
      } else if (rangeChangeRatio >= 1.01 && rangeChangeRatio < 1.05) {
        // Mudança gradual: expande apenas o necessário
        pH = Math.max(newPH, currentScale.pH);
        pL = Math.min(newPL, currentScale.pL);
      } else {
        // Mudança grande: usa nova escala
        pH = newPH;
        pL = newPL;
      }
    } else {
      pH = newPH;
      pL = newPL;
    }

    const tpr = pH - pL;

    // Atualiza scaleRef apenas se passou tempo suficiente (throttle de 50ms)
    if (now - currentScale.lastUpdate > 50) {
      scaleRef.current = {
        pH,
        pL,
        tpr,
        chartH,
        locked: true,
        lastUpdate: now
      };
    }

    const p2y = (p: number) => ((pH - p) / tpr) * chartH;
    const y2p = (y: number) => pH - (y / chartH) * tpr;
    const c2x = (i: number) => (i - startIdx) * colW;

    let maxVol = 1;
    for (let i = startIdx; i < endIdx; i++) {
      maxVol = Math.max(maxVol, all[i].volumeTotal);
    }
    if (maxVol === 0) maxVol = 1;

    // Grid
    const gSt = calculateGridStep(tpr, chartH);
    const gF = Math.ceil(pL / gSt) * gSt;

    ctx.strokeStyle = styleConfig.gridColor;
    ctx.lineWidth = 0.5;

    for (let p = gF; p <= pH; p += gSt) {
      const y = p2y(p);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();
    }

    const bullBodyColor = hexToRgba(styleConfig.bullColor, styleConfig.bgOpacity);
    const bearBodyColor = hexToRgba(styleConfig.bearColor, styleConfig.bgOpacity);
    const bullWickColor = styleConfig.bullColor;
    const bearWickColor = styleConfig.bearColor;

    const showFP = colW >= 50;
    const showNums = colW >= 80;
    const showDelta = colW >= 25;
    const showTime = colW >= 30;
    const step = config.priceLevelSize;

    // Desenhar clusters
    for (let i = startIdx; i < endIdx; i++) {
      const cl = all[i];
      const x = c2x(i);
      const isBull = cl.close >= cl.open;
      const isSel = selectedCluster?.id === cl.id;
      const isForm = !cl.isClosed;
      const isHov = hoverRef.current === i;

      const realHigh = cl.high;
      const realLow = cl.low;
      const gridHigh = Math.ceil(realHigh / step) * step;
      const gridLow = Math.floor(realLow / step) * step;

      let bodyTopY: number, bodyBotY: number, wickTopY: number, wickBotY: number;

      if (renderMode === 'grid') {
        bodyTopY = p2y(gridHigh);
        bodyBotY = p2y(gridLow);
        wickTopY = bodyTopY;
        wickBotY = bodyBotY;
      } else if (renderMode === 'raw') {
        bodyTopY = p2y(realHigh);
        bodyBotY = p2y(realLow);
        wickTopY = bodyTopY;
        wickBotY = bodyBotY;
      } else if (renderMode === 'hybrid') {
        bodyTopY = p2y(gridHigh);
        bodyBotY = p2y(gridLow);
        wickTopY = p2y(realHigh);
        wickBotY = p2y(realLow);
      } else {
        wickTopY = p2y(realHigh);
        wickBotY = p2y(realLow);
        const openY = p2y(cl.open);
        const closeY = p2y(cl.close);
        if (cl.open >= cl.close) {
          bodyTopY = openY;
          bodyBotY = closeY;
        } else {
          bodyTopY = closeY;
          bodyBotY = openY;
        }
      }

      // Wick
      const wickX = x + colW / 2;
      ctx.strokeStyle = isBull ? bullWickColor : bearWickColor;
      ctx.lineWidth = Math.max(1, colW * 0.04);
      ctx.beginPath();
      ctx.moveTo(wickX, wickTopY);
      ctx.lineTo(wickX, wickBotY);
      ctx.stroke();

      // Body
      const bodyH = Math.max(1, bodyBotY - bodyTopY);
      const bodyW = Math.max(2, colW * 0.65);
      const bodyX = x + (colW - bodyW) / 2;

      if (isForm) {
        ctx.fillStyle = isBull
          ? hexToRgba(styleConfig.bullColor, 0.15)
          : hexToRgba(styleConfig.bearColor, 0.15);
        ctx.fillRect(bodyX, bodyTopY, bodyW, bodyH);
        ctx.strokeStyle = COLORS.forming;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(bodyX, bodyTopY, bodyW, bodyH);
        ctx.setLineDash([]);

        if (colW >= 30) {
          ctx.font = `bold 7px ${FONT_FAMILY}`;
          ctx.fillStyle = '#ffd740';
          ctx.textAlign = 'center';
          ctx.fillText('▸', x + colW / 2, bodyTopY - 3);
        }
      } else {
        ctx.fillStyle = isBull ? bullBodyColor : bearBodyColor;
        ctx.fillRect(bodyX, bodyTopY, bodyW, bodyH);
      }

      // Inner body para hybrid mode
      if (renderMode === 'hybrid' && !isForm) {
        const innerOpenY = p2y(cl.open);
        const innerCloseY = p2y(cl.close);
        const innerTop = Math.min(innerOpenY, innerCloseY);
        const innerBot = Math.max(innerOpenY, innerCloseY);
        const innerH = Math.max(1, innerBot - innerTop);
        const innerW = bodyW * 0.4;
        const innerX = x + (colW - innerW) / 2;

        ctx.fillStyle = isBull ? styleConfig.bullColor : styleConfig.bearColor;
        ctx.fillRect(innerX, innerTop, innerW, innerH);
      }

      // Footprint
      if (showFP && cl.priceLevels.length > 0) {
        const maxLV = Math.max(...cl.priceLevels.map(l => l.volumeTotal), 1);
        const halfW = (bodyW - 2) / 2;
        const cx = x + colW / 2;

        for (const lv of cl.priceLevels) {
          const y = p2y(lv.price);
          if (y < -20 || y > chartH + 20) continue;

          const isPoc = Math.abs(lv.price - cl.poc) < config.priceLevelSize / 2;
          const inten = lv.volumeTotal / maxLV;
          const cellH = Math.max(1.5, Math.abs(p2y(lv.price) - p2y(lv.price + config.priceLevelSize)) * 0.85);
          const hh = cellH / 2;

          if (lv.volumeSell > 0) {
            const w = Math.max(0.5, (lv.volumeSell / maxLV) * halfW);
            const a = 0.25 + inten * 0.55;
            ctx.fillStyle = isPoc ? '#ff5252' : hexToRgba(styleConfig.bearColor, a);
            ctx.fillRect(cx - w, y - hh, w, cellH);

            if (showNums && cellH >= 7) {
              ctx.font = `${Math.min(9, cellH - 1)}px ${FONT_FAMILY}`;
              ctx.fillStyle = `rgba(239,154,154,${0.5 + inten * 0.5})`;
              ctx.textAlign = 'right';
              ctx.fillText(formatVolume(lv.volumeSell), cx - w - 1, y + Math.min(3, hh));
            }
          }

          if (lv.volumeBuy > 0) {
            const w = Math.max(0.5, (lv.volumeBuy / maxLV) * halfW);
            const a = 0.25 + inten * 0.55;
            ctx.fillStyle = isPoc ? '#00e676' : hexToRgba(styleConfig.bullColor, a);
            ctx.fillRect(cx, y - hh, w, cellH);

            if (showNums && cellH >= 7) {
              ctx.font = `${Math.min(9, cellH - 1)}px ${FONT_FAMILY}`;
              ctx.fillStyle = `rgba(128,203,196,${0.5 + inten * 0.5})`;
              ctx.textAlign = 'left';
              ctx.fillText(formatVolume(lv.volumeBuy), cx + w + 1, y + Math.min(3, hh));
            }
          }

          if (isPoc) {
            ctx.strokeStyle = styleConfig.pocColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(bodyX, y);
            ctx.lineTo(bodyX + bodyW, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      // Delta label
      if (showDelta) {
        ctx.font = `bold ${colW >= 40 ? 9 : 7}px ${FONT_FAMILY}`;
        ctx.fillStyle = isBull ? styleConfig.bullColor : styleConfig.bearColor;
        ctx.textAlign = 'center';
        const dt = (cl.delta >= 0 ? '+' : '') + formatVolume(cl.delta);
        ctx.fillText(dt, x + colW / 2, bodyTopY - (colW >= 30 ? 6 : 3));
      }

      // Selection highlight
      if (isSel) {
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, 0, colW - 2, chartH);
      }

      if (isHov && !isSel) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(x, 0, colW, chartH);
      }

      // Volume bar
      const vTop = chartH;
      const totalHeight = Math.max(1, (cl.volumeTotal / maxVol) * (VOL_H - 22));
      const ratio = cl.volumeTotal > 0 ? cl.bodyVolume / cl.volumeTotal : 0.5;
      const bodyBarHeight = totalHeight * ratio;
      const wickBarHeight = totalHeight - bodyBarHeight;
      const vBarWidth = Math.max(2, colW * 0.55);
      const vBarX = x + (colW - vBarWidth) / 2;

      ctx.fillStyle = isBull ? COLORS.volWick : COLORS.volWickBear;
      ctx.fillRect(vBarX, vTop + VOL_H - totalHeight - 1, vBarWidth, wickBarHeight);
      ctx.fillStyle = isBull ? COLORS.volBody : COLORS.volBodyBear;
      ctx.fillRect(vBarX, vTop + VOL_H - bodyBarHeight - 1, vBarWidth, bodyBarHeight);

      if (colW >= 35) {
        ctx.font = `bold 7px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        const ly = vTop + VOL_H - totalHeight - 3;
        ctx.fillStyle = isBull ? COLORS.bull : COLORS.bear;
        ctx.fillText(formatVolume(cl.volumeTotal), x + colW / 2, Math.max(vTop + 8, ly));
      }

      // Time label
      if (showTime) {
        const dt = new Date(cl.startTime);
        ctx.font = `${colW >= 40 ? 8 : 6}px ${FONT_FAMILY}`;
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText(`${padZero(dt.getHours())}:${padZero(dt.getMinutes())}`, x + colW / 2, chartH + VOL_H + 13);
      }
    }

    // Separator line
    ctx.strokeStyle = COLORS.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, chartH);
    ctx.lineTo(chartW, chartH);
    ctx.stroke();

    // Drawings
    drawings.forEach((d) => {
      const isSelected = d.id === selectedDrawingId;
      ctx.beginPath();
      ctx.strokeStyle = isSelected ? '#ffd740' : d.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      const y1 = p2y(d.price1);

      if (d.type === 'hline') {
        ctx.moveTo(0, y1);
        ctx.lineTo(chartW, y1);
        ctx.stroke();
        if (isSelected) {
          ctx.fillStyle = d.color;
          ctx.font = '9px ' + FONT_FAMILY;
          ctx.fillText(d.price1.toFixed(digits), chartW - 35, y1 - 3);
        }
      } else if (d.type === 'vline') {
        ctx.moveTo(d.x1, 0);
        ctx.lineTo(d.x1, chartH);
        ctx.stroke();
      } else if (d.type === 'rect' && d.price2 !== undefined && d.x2 !== undefined) {
        const rectY2 = p2y(d.price2);
        const w = d.x2 - d.x1;
        const h = rectY2 - y1;
        ctx.strokeRect(d.x1, y1, w, h);
        ctx.fillStyle = d.color + '33';
        ctx.fillRect(d.x1, y1, w, h);
      }
    });

    // Current drawing
    if (currentDrawing) {
      ctx.beginPath();
      ctx.strokeStyle = styleConfig.drawingColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      if (currentDrawing.type === 'hline') {
        ctx.moveTo(0, currentDrawing.y1);
        ctx.lineTo(chartW, currentDrawing.y1);
      } else if (currentDrawing.type === 'vline') {
        ctx.moveTo(currentDrawing.x1, 0);
        ctx.lineTo(currentDrawing.x1, chartH);
      } else if (currentDrawing.type === 'rect' && currentDrawing.x2 !== undefined && currentDrawing.y2 !== undefined) {
        const w = currentDrawing.x2 - currentDrawing.x1;
        const h = currentDrawing.y2 - currentDrawing.y1;
        ctx.strokeRect(currentDrawing.x1, currentDrawing.y1, w, h);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Price axis panel
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(chartW, 0, PRICE_W + RIGHT_MARGIN, height);
    ctx.strokeStyle = COLORS.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartW, 0);
    ctx.lineTo(chartW, height);
    ctx.stroke();

    // Price labels
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    for (let p = gF; p <= pH; p += gSt) {
      const y = p2y(p);
      ctx.fillStyle = COLORS.textMid;
      ctx.fillText(p.toFixed(digits), chartW + 4, y + 3);
    }

    // Selected cluster POC line
    if (selectedCluster) {
      const pocY = p2y(selectedCluster.poc);
      if (pocY > 0 && pocY < chartH) {
        ctx.strokeStyle = styleConfig.pocColor + '59';
        ctx.lineWidth = 0.7;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(chartW, pocY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#332d00';
        ctx.fillRect(chartW, pocY - 7, PRICE_W, 14);
        ctx.strokeStyle = styleConfig.pocColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(chartW, pocY - 7, PRICE_W, 14);
        ctx.fillStyle = styleConfig.pocColor;
        ctx.font = `bold 10px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(selectedCluster.poc.toFixed(digits), chartW + 4, pocY + 4);
      }
    }

    // Current price line
    if (currentCluster) {
      const currentPrice = currentCluster.close;
      const curY = p2y(currentPrice);
      if (curY > 0 && curY < chartH) {
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, curY);
        ctx.lineTo(chartW, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#4e342e';
        ctx.fillRect(chartW, curY - 8, PRICE_W, 16);
        ctx.strokeStyle = '#ff9800';
        ctx.strokeRect(chartW, curY - 8, PRICE_W, 16);
        ctx.fillStyle = '#fff';
        ctx.font = `bold 10px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(currentPrice.toFixed(digits), chartW + 4, curY + 4);
      }
    }

    // Crosshair
    if (mouse && mouse.x < chartW && mouse.y > 0 && mouse.y < chartH) {
      ctx.strokeStyle = styleConfig.crosshairColor;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(mouse.x, 0);
      ctx.lineTo(mouse.x, chartH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, mouse.y);
      ctx.lineTo(chartW, mouse.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const hp = y2p(mouse.y);
      ctx.fillStyle = COLORS.crossLabel;
      ctx.fillRect(chartW, mouse.y - 8, PRICE_W, 16);
      ctx.strokeStyle = styleConfig.crosshairColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(chartW, mouse.y - 8, PRICE_W, 16);
      ctx.fillStyle = COLORS.textHi;
      ctx.font = `bold 10px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillText(hp.toFixed(digits), chartW + 4, mouse.y + 4);
    }

    // Scrollbar
    const maxScr = Math.max(0, all.length - Math.floor(chartW / colW));
    if (maxScr > 0) {
      const sbY = chartH + VOL_H - 2;
      const pct = scroll / maxScr;
      const bL = Math.max(20, (Math.floor(chartW / colW) / all.length) * chartW);
      const bX = (chartW - bL) * (1 - pct);

      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, sbY, chartW, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bX, sbY, bL, 2);
    }

    // Info text
    ctx.font = `bold 8px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.floor(chartW / colW)}/${all.length} clusters  ×${zoom.toFixed(1)}`, 4, 10);

    ctx.restore();
  }, [
    width,
    height,
    chartW,
    chartH,
    clusters,
    config,
    selectedCluster,
    currentCluster,
    scroll,
    zoom,
    digits,
    crosshair,
    getColW,
    styleConfig,
    drawings,
    currentDrawing,
    selectedDrawingId,
    renderMode,
    allC,
  ]);

  // ✅ CORREÇÃO 9: requestAnimationFrame otimizado
  const queueDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Canvas resize effect
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;

    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = height * dpr;
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    queueDraw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [width, height, queueDraw]);

  // ✅ CORREÇÃO 10: Reduzir dependências do useEffect de draw
  useEffect(() => {
    queueDraw();
  }, [clusters, currentCluster, selectedCluster, scroll, zoom, config, styleConfig, drawings, currentDrawing, selectedDrawingId, crosshair, renderMode, queueDraw]);

  // Wheel handler
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const all = allC();

    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.1, Math.min(5, z * factor)));
    } else {
      const colW = getColW(all.length);
      const visCols = Math.floor(chartW / colW);
      const mx = Math.max(0, all.length - visCols);
      const step = Math.max(1, Math.floor(visCols * 0.15));
      setScroll((s) => Math.max(0, Math.min(mx, s + (e.deltaY > 0 ? -step : step))));
    }
  }, [allC, getColW, chartW]);

  // Mouse down handler
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { sx: e.clientX, so: scroll, moved: false };
  }, [scroll]);

  // Mouse move handler
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const cv = cvRef.current;
    if (!cv) return;

    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;

    // Check hovered drawing
    const hoveredDrawing = getHoveredDrawing(mx, my);
    cv.style.cursor = hoveredDrawing ? 'pointer' : 'crosshair';

    // Drag handling
    if (dragRef.current && e.buttons === 1) {
      const dx = e.clientX - dragRef.current.sx;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;

      const all = allC();
      const colW = getColW(all.length);
      const visCols = Math.floor(chartW / colW);
      const cd = Math.round(dx / colW);
      const mxVal = Math.max(0, all.length - visCols);
      setScroll(Math.max(0, Math.min(mxVal, dragRef.current.so + cd)));
      return;
    }

    // Hover handling
    const all = allC();
    const colW = getColW(all.length);
    const visCols = Math.floor(chartW / colW);
    const eI = Math.min(all.length, all.length - scroll);
    const sI = Math.max(0, eI - visCols);
    const col = sI + Math.floor(mx / colW);
    hoverRef.current = col >= sI && col < eI ? col : -1;
    queueDraw();
  }, [allC, getColW, chartW, scroll, queueDraw, getHoveredDrawing]);

  // Mouse up handler
  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Click handler
  const onClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current?.moved) return;

    const cv = cvRef.current;
    if (!cv) return;

    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;

    // Check clicked drawing
    const clickedDrawingId = getHoveredDrawing(mx, my);
    if (clickedDrawingId) {
      onSelectDrawing(clickedDrawingId);
      return;
    }

    // Check clicked cluster
    const all = allC();
    const colW = getColW(all.length);
    const visCols = Math.floor(chartW / colW);
    const eI = Math.min(all.length, all.length - scroll);
    const sI = Math.max(0, eI - visCols);
    const col = sI + Math.floor(mx / colW);

    if (col >= sI && col < eI) {
      onSelectCluster(all[col]);
      onSelectDrawing(null);
    }
  }, [allC, getColW, chartW, scroll, onSelectCluster, onSelectDrawing, getHoveredDrawing]);

  // Mouse leave handler
  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    hoverRef.current = -1;
    queueDraw();
  }, [queueDraw]);

  // Expose methods via ref
  useImperativeHandle(
    ref,
    () => ({
      getYPrice: (y: number) => {
        const { pH, tpr, chartH } = scaleRef.current;
        if (tpr === 0 || chartH === 0) return 0;
        return pH - (y / chartH) * tpr;
      },
    }),
    []
  );

  return (
    <canvas
      ref={cvRef}
      style={{ borderRadius: 4, cursor: 'crosshair', display: 'block' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
    />
  );
};

export const ClusterCanvas = React.memo(React.forwardRef(ClusterCanvasComponent));
