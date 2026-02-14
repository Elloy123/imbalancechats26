// src/utils/clusterCalculator.ts
import type { TickData, ClusterData, ClusterConfig, PriceLevel } from '../types';

export class ClusterCalculator {
  private config: ClusterConfig;
  private clusters: ClusterData[] = [];
  private currentCluster: ClusterData | null = null;
  private clusterIdCounter = 1;

  constructor(config: ClusterConfig) {
    this.config = config;
  }

  updateConfig(config: Partial<ClusterConfig>) {
    this.config = { ...this.config, ...config };
  }

  processTick(tick: TickData): ClusterData | null {
    const priceLevel = this.getPriceLevel(tick.price);
    const volume = tick.volume || 1;

    if (!this.currentCluster) {
      this.currentCluster = this.createNewCluster(tick, priceLevel, volume);
      console.log('🆕 [Calculator] Novo cluster criado:', this.currentCluster.id);
      return null;
    }

    // Update cluster data
    this.currentCluster.high = Math.max(this.currentCluster.high, tick.price);
    this.currentCluster.low = Math.min(this.currentCluster.low, tick.price);
    this.currentCluster.close = tick.price;
    this.currentCluster.tickCount++;
    this.currentCluster.endTime = tick.timestamp;

    // Update volume
    if (tick.side === 'buy') {
      this.currentCluster.volumeBuy += volume;
      this.currentCluster.delta += volume;
    } else {
      this.currentCluster.volumeSell += volume;
      this.currentCluster.delta -= volume;
    }
    this.currentCluster.volumeTotal += volume;

    // Update body volume (volume dentro do corpo do candle)
    const bodyTop = Math.max(this.currentCluster.open, this.currentCluster.close);
    const bodyBottom = Math.min(this.currentCluster.open, this.currentCluster.close);
    if (tick.price >= bodyBottom && tick.price <= bodyTop) {
      this.currentCluster.bodyVolume += volume;
    } else {
      // Volume no pavio (fora do corpo)
      this.currentCluster.wickVolume += volume;
    }

    // Update volume ratios
    this.updateVolumeRatios(this.currentCluster);

    // Update price levels
    this.updatePriceLevel(this.currentCluster, tick.price, volume, tick.side);

    // Recalculate POC
    this.recalculatePOC(this.currentCluster);

    // Check if cluster should close based on delta threshold
    const shouldClose = Math.abs(this.currentCluster.delta) >= this.config.deltaThreshold;

    // Debug a cada 50 ticks
    if (this.currentCluster.tickCount % 50 === 0) {
      console.log(`⏳ [Calculator] Cluster #${this.currentCluster.id}: ticks=${this.currentCluster.tickCount}, delta=${this.currentCluster.delta}, threshold=${this.config.deltaThreshold}, shouldClose=${shouldClose}`);
    }

    if (shouldClose) {
      this.currentCluster.isClosed = true;
      this.clusters.push(this.currentCluster);
      const closedCluster = this.currentCluster;
      this.currentCluster = null;
      console.log('✅ [Calculator] Cluster FECHADO:', closedCluster.id, 'delta:', closedCluster.delta, 'ticks:', closedCluster.tickCount);
      return closedCluster;
    }

    return null;
  }

  private createNewCluster(tick: TickData, priceLevel: number, volume: number): ClusterData {
    const cluster: ClusterData = {
      id: this.clusterIdCounter++,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volumeBuy: tick.side === 'buy' ? volume : 0,
      volumeSell: tick.side === 'sell' ? volume : 0,
      volumeTotal: volume,
      bodyVolume: volume,
      wickVolume: 0,
      bodyVolumeRatio: 1.0,
      delta: tick.side === 'buy' ? volume : -volume,
      poc: tick.price,
      priceLevels: [],
      tickCount: 1,
      startTime: tick.timestamp,
      isClosed: false,
    };

    this.updatePriceLevel(cluster, tick.price, volume, tick.side);
    return cluster;
  }

  private getPriceLevel(price: number): number {
    const step = this.config.priceLevelSize;
    return Math.round(price / step) * step;
  }

  private updatePriceLevel(cluster: ClusterData, price: number, volume: number, side: 'buy' | 'sell') {
    const levelPrice = this.getPriceLevel(price);
    let level = cluster.priceLevels.find(l => Math.abs(l.price - levelPrice) < this.config.priceLevelSize / 2);

    if (!level) {
      level = {
        price: levelPrice,
        volumeBuy: 0,
        volumeSell: 0,
        volumeTotal: 0,
        delta: 0,
        tickCount: 0,
      };
      cluster.priceLevels.push(level);
      // Sort by price descending
      cluster.priceLevels.sort((a, b) => b.price - a.price);
    }

    level.tickCount++;
    level.volumeTotal += volume;
    if (side === 'buy') {
      level.volumeBuy += volume;
      level.delta += volume;
    } else {
      level.volumeSell += volume;
      level.delta -= volume;
    }
  }

  private recalculatePOC(cluster: ClusterData) {
    if (cluster.priceLevels.length === 0) return;

    let maxVol = 0;
    let pocPrice = cluster.priceLevels[0].price;

    for (const level of cluster.priceLevels) {
      if (level.volumeTotal > maxVol) {
        maxVol = level.volumeTotal;
        pocPrice = level.price;
      }
    }

    cluster.poc = pocPrice;
  }

  private updateVolumeRatios(cluster: ClusterData) {
    if (cluster.volumeTotal > 0) {
      cluster.bodyVolumeRatio = cluster.bodyVolume / cluster.volumeTotal;
    } else {
      cluster.bodyVolumeRatio = 0;
    }
  }

  loadFromHistory(ticks: TickData[]) {
    for (const tick of ticks) {
      this.processTick(tick);
    }
    // Close any remaining open cluster
    if (this.currentCluster && !this.currentCluster.isClosed) {
      this.currentCluster.isClosed = true;
      this.clusters.push(this.currentCluster);
      this.currentCluster = null;
    }
  }

  getAllClustersForChart(): ClusterData[] {
    const result = [...this.clusters];
    if (this.currentCluster) {
      result.push(this.currentCluster);
    }
    return result;
  }

  getCurrentCluster(): ClusterData | null {
    return this.currentCluster;
  }

  getClosedClusters(): ClusterData[] {
    return [...this.clusters];
  }

  reset() {
    this.clusters = [];
    this.currentCluster = null;
    this.clusterIdCounter = 1;
  }
}
