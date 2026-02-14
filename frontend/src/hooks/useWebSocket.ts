import { useEffect, useRef, useCallback, useState } from 'react';

// Tipos de dados recebidos do WebSocket MT5
export interface MT5TickData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  volume_synthetic?: number;
  side: 'buy' | 'sell';
  timestamp: number;
  flags?: number;
}

export interface WebSocketConfig {
  url: string;
  symbol: string;
  enabled: boolean;
  onTick: (tick: MT5TickData) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onHistory?: (ticks: MT5TickData[]) => void;
}

export interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  subscribedSymbol: string | null;
  ticksReceived: number;
  lastPrice: number | null;
  lastTickTime: number | null;
}

// Hook para WebSocket REAL do MT5
export function useMT5WebSocket(config: WebSocketConfig) {
  const {
    url,
    symbol,
    enabled,
    onTick,
    onConnect,
    onDisconnect,
    onError,
    onHistory
  } = config;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const callbackRef = useRef(onTick);
  const historyCallbackRef = useRef(onHistory);

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    subscribedSymbol: null,
    ticksReceived: 0,
    lastPrice: null,
    lastTickTime: null,
  });

  // Manter callbacks atualizados
  useEffect(() => {
    callbackRef.current = onTick;
    historyCallbackRef.current = onHistory;
  }, [onTick, onHistory]);

  // Função para conectar
  const connect = useCallback(() => {
    if (!enabled || !url) {
      return;
    }

    // Fechar conexão existente
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));
    console.log('🔌 [MT5 WS] Conectando a:', url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ [MT5 WS] Conectado!');
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null
        }));
        reconnectAttemptsRef.current = 0;

        // Inscrever no símbolo atual
        ws.send(JSON.stringify({
          action: 'subscribe',
          symbol: symbol
        }));

        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'tick':
              const tick = message.data as MT5TickData;
              callbackRef.current(tick);
              setState(prev => ({
                ...prev,
                ticksReceived: prev.ticksReceived + 1,
                lastPrice: tick.price,
                lastTickTime: tick.timestamp,
              }));
              break;

            case 'history':
              const historyTicks = message.data?.ticks as MT5TickData[];
              if (historyTicks && historyCallbackRef.current) {
                historyCallbackRef.current(historyTicks);
              }
              console.log('📊 [MT5 WS] Histórico recebido:', historyTicks?.length, 'ticks');
              break;

            case 'subscribed':
              console.log('📨 [MT5 WS] Inscrito em:', message.symbol);
              setState(prev => ({ ...prev, subscribedSymbol: message.symbol }));
              break;

            case 'pong':
              // Heartbeat response
              break;

            case 'error':
              console.error('❌ [MT5 WS] Erro do servidor:', message.message);
              setState(prev => ({ ...prev, error: message.message }));
              onError?.(message.message);
              break;

            default:
              // Ignorar mensagens desconhecidas
              break;
          }
        } catch (e) {
          console.error('[MT5 WS] Erro ao processar mensagem:', e);
        }
      };

      ws.onerror = (event) => {
        console.error('❌ [MT5 WS] Erro de conexão:', event);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          error: 'Erro de conexão WebSocket'
        }));
        onError?.('Erro de conexão WebSocket');
      };

      ws.onclose = (event) => {
        console.log('🔌 [MT5 WS] Conexão fechada:', event.code, event.reason);
        wsRef.current = null;
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          subscribedSymbol: null
        }));
        onDisconnect?.();

        // Reconexão automática
        if (enabled && reconnectAttemptsRef.current < 10) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(`🔄 [MT5 WS] Reconectando em ${delay}ms (tentativa ${reconnectAttemptsRef.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };
    } catch (e) {
      console.error('❌ [MT5 WS] Erro ao criar WebSocket:', e);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: 'Falha ao criar conexão WebSocket'
      }));
    }
  }, [enabled, url, symbol, onConnect, onDisconnect, onError]);

  // Função para desconectar
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      subscribedSymbol: null,
    }));
  }, []);

  // Função para solicitar histórico
  const requestHistory = useCallback((symbolName: string, hours: number = 1) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'history',
        symbol: symbolName,
        hours: hours
      }));
      console.log('📊 [MT5 WS] Solicitando histórico:', hours, 'horas para', symbolName);
    }
  }, []);

  // Função para trocar símbolo
  const changeSymbol = useCallback((newSymbol: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Desinscrever do símbolo atual
      if (state.subscribedSymbol) {
        wsRef.current.send(JSON.stringify({
          action: 'unsubscribe',
          symbol: state.subscribedSymbol
        }));
      }

      // Inscrever no novo símbolo
      wsRef.current.send(JSON.stringify({
        action: 'subscribe',
        symbol: newSymbol
      }));
    }
  }, [state.subscribedSymbol]);

  // Conectar quando habilitado
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  // Atualizar subscrição quando símbolo muda
  useEffect(() => {
    if (state.isConnected && symbol !== state.subscribedSymbol) {
      changeSymbol(symbol);
    }
  }, [symbol, state.isConnected, state.subscribedSymbol, changeSymbol]);

  // Heartbeat para manter conexão
  useEffect(() => {
    if (!state.isConnected) return;

    const heartbeatInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'ping' }));
      }
    }, 30000); // A cada 30 segundos

    return () => clearInterval(heartbeatInterval);
  }, [state.isConnected]);

  return {
    ...state,
    connect,
    disconnect,
    requestHistory,
    changeSymbol,
  };
}

// Hook com dados simulados (fallback quando não há conexão MT5)
export function useSimulatedWebSocket(config: WebSocketConfig) {
  const { symbol, enabled, onTick } = config;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const priceRef = useRef(1.0850);

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    subscribedSymbol: null,
    ticksReceived: 0,
    lastPrice: null,
    lastTickTime: null,
  });

  // Configurações de símbolos
  const SYMBOL_CONFIGS: Record<string, { basePrice: number; spread: number; volatility: number }> = {
    EURUSD: { basePrice: 1.0850, spread: 0.0002, volatility: 0.0001 },
    XAUUSD: { basePrice: 2350, spread: 0.5, volatility: 0.5 },
    USTEC: { basePrice: 18500, spread: 2, volatility: 5 },
  };

  useEffect(() => {
    if (enabled) {
      const cfg = SYMBOL_CONFIGS[symbol] || SYMBOL_CONFIGS.EURUSD;
      priceRef.current = cfg.basePrice;

      setState(prev => ({ ...prev, isConnected: true, subscribedSymbol: symbol }));

      intervalRef.current = setInterval(() => {
        const cfg = SYMBOL_CONFIGS[symbol] || SYMBOL_CONFIGS.EURUSD;

        // Movimento de preço
        const trend = (Math.random() - 0.5) * cfg.volatility;
        priceRef.current += trend;

        // Manter em range
        const minPrice = cfg.basePrice * 0.98;
        const maxPrice = cfg.basePrice * 1.02;
        priceRef.current = Math.max(minPrice, Math.min(maxPrice, priceRef.current));

        const price = priceRef.current;

        const tick: MT5TickData = {
          symbol,
          price,
          bid: price - cfg.spread / 2,
          ask: price + cfg.spread / 2,
          volume: Math.floor(Math.random() * 80) + 20,
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          timestamp: Date.now(),
        };

        onTick(tick);
        setState(prev => ({
          ...prev,
          ticksReceived: prev.ticksReceived + 1,
          lastPrice: tick.price,
          lastTickTime: tick.timestamp,
        }));
      }, 100);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      setState(prev => ({ ...prev, isConnected: false, subscribedSymbol: null }));
    }
  }, [symbol, enabled, onTick]);

  return {
    ...state,
    requestHistory: () => console.log('Histórico não disponível em modo simulado'),
  };
}

// Hook híbrido que tenta conexão real e fallback para simulado
export function useHybridWebSocket(config: WebSocketConfig) {
  const [useReal, setUseReal] = useState(true);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [fallbackTimer, setFallbackTimer] = useState<NodeJS.Timeout | null>(null);

  const realWs = useMT5WebSocket({
    ...config,
    onError: (error) => {
      console.log('⚠️ WebSocket real falhou, usando simulado');
      setShowConnectionError(true);
      setUseReal(false);
      config.onError?.(error);
    }
  });

  const simulatedWs = useSimulatedWebSocket(config);

  // Se conexão real falhar, usar simulado
  useEffect(() => {
    if (!realWs.isConnected && !realWs.isConnecting && !useReal) {
      // Já usando simulado
      return;
    }

    // Timeout para fallback
    const timeout = setTimeout(() => {
      if (realWs.isConnecting) {
        console.log('⚠️ Timeout de conexão, usando simulado');
        setShowConnectionError(true);
        setUseReal(false);
      }
    }, 5000);

    setFallbackTimer(timeout);

    return () => clearTimeout(timeout);
  }, [realWs.isConnected, realWs.isConnecting, useReal]);

  // Retornar o hook apropriado
  const activeWs = useReal && realWs.isConnected ? realWs : simulatedWs;

  return {
    ...activeWs,
    isRealConnection: useReal && realWs.isConnected,
    showConnectionError,
    retryRealConnection: () => {
      setUseReal(true);
      setShowConnectionError(false);
    },
  };
}
