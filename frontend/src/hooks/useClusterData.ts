// src/hooks/useClusterData.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TickData, ClusterData, ClusterConfig } from '../types';
import { ClusterCalculator } from '../utils/clusterCalculator';

interface UseClusterDataReturn {
  clusters: ClusterData[];
  currentCluster: ClusterData | null;
  getCalculator: () => ClusterCalculator;
  processTick: (tick: TickData) => void;
  loadHistory: (hours: number) => Promise<void>;
  reset: () => void;
  isLoading: boolean;
}

export const useClusterData = (symbol: string, config: ClusterConfig): UseClusterDataReturn => {
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [currentCluster, setCurrentCluster] = useState<ClusterData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Usar ref para evitar re-criação do calculator
  const calculatorRef = useRef<ClusterCalculator | null>(null);
  const isInitializedRef = useRef(false);

  // ✅ Inicializar calculator UMA vez usando useEffect
  useEffect(() => {
    if (!isInitializedRef.current) {
      calculatorRef.current = new ClusterCalculator(config);
      isInitializedRef.current = true;
      console.log('🔵 [useClusterData] Calculator inicializado:', config);
    }
  }, []); // Empty deps - só roda uma vez

  // Atualizar config no calculator quando mudar
  useEffect(() => {
    if (calculatorRef.current) {
      calculatorRef.current.updateConfig(config);
      console.log('🔵 [useClusterData] Config atualizada:', config);
    }
  }, [config]);

  const getCalculator = useCallback(() => {
    if (!calculatorRef.current) {
      console.error('❌ [useClusterData] Calculator não inicializado!');
    }
    return calculatorRef.current!;
  }, []);

  // Atualização direta SEM otimização
  const updateState = useCallback(() => {
    if (!calculatorRef.current) {
      console.error('❌ [useClusterData] Calculator é null no updateState!');
      return;
    }

    const allClusters = calculatorRef.current.getAllClustersForChart();
    const current = calculatorRef.current.getCurrentCluster();

    console.log('🟢 [useClusterData] updateState chamado:');
    console.log('   - Clusters fechados:', allClusters.filter(c => c.isClosed).length);
    console.log('   - Cluster atual:', current ? `#${current.id} (ticks: ${current.tickCount}, delta: ${current.delta})` : 'null');
    console.log('   - Total clusters:', allClusters.length);

    // Atualização direta
    setClusters([...allClusters]);
    setCurrentCluster(current);
  }, []);

  const processTick = useCallback((tick: TickData) => {
    if (!calculatorRef.current) {
      console.error('❌ [useClusterData] Calculator é null no processTick!');
      return;
    }

    console.log('📨 [useClusterData] processTick chamado, preço:', tick.price.toFixed(5));
    const closedCluster = calculatorRef.current.processTick(tick);
    
    if (closedCluster) {
      console.log('🟡 [useClusterData] Cluster FECHADO:', closedCluster.id, 'delta:', closedCluster.delta);
    }
    
    updateState();
  }, [updateState]);

  const loadHistory = useCallback(async (hours: number) => {
    console.log('📥 [useClusterData] Carregando histórico de', hours, 'horas...');
    
    if (!calculatorRef.current) {
      console.error('❌ [useClusterData] Calculator é null!');
      return;
    }
    
    setIsLoading(true);
    try {
      const now = Date.now();
      const startTime = now - (hours * 60 * 60 * 1000);
      const tickCount = hours * 100; // 100 ticks por hora

      const mockTicks: TickData[] = [];
      let basePrice = symbol === 'EURUSD' ? 1.0850 :
                      symbol === 'XAUUSD' ? 2350 :
                      18500;

      for (let i = 0; i < tickCount; i++) {
        const timestamp = startTime + (i * (hours * 3600000 / tickCount));
        const priceChange = (Math.random() - 0.5) * 0.002 * basePrice;
        const price = basePrice + priceChange;
        basePrice = price;

        mockTicks.push({
          price,
          bid: price - 0.0001,
          ask: price + 0.0001,
          volume: Math.floor(Math.random() * 100) + 10,
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          timestamp,
          symbol,
        });
      }

      console.log('📥 [useClusterData] Carregando', mockTicks.length, 'ticks...');
      calculatorRef.current.loadFromHistory(mockTicks);
      
      const allClusters = calculatorRef.current.getAllClustersForChart();
      console.log('📥 [useClusterData] Clusters após carregar:', allClusters.length);
      
      updateState();
    } catch (error) {
      console.error('❌ [useClusterData] Erro ao carregar histórico:', error);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, updateState]);

  const reset = useCallback(() => {
    console.log('🔄 [useClusterData] Resetando...');
    calculatorRef.current?.reset();
    setClusters([]);
    setCurrentCluster(null);
  }, []);

  // Debug: log quando clusters mudam
  useEffect(() => {
    console.log('📊 [useClusterData] Estado clusters atualizado:', clusters.length, 'clusters');
    if (clusters.length > 0) {
      console.log('   - Primeiro cluster:', clusters[0]);
      console.log('   - Último cluster:', clusters[clusters.length - 1]);
    }
  }, [clusters]);

  return {
    clusters,
    currentCluster,
    getCalculator,
    processTick,
    loadHistory,
    reset,
    isLoading,
  };
};
