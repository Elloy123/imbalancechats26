// src/types/index.ts

export interface TickData {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  side: 'buy' | 'sell';
  timestamp: number;
  symbol: string;
}

export interface PriceLevel {
  price: number;
  volumeBuy: number;
  volumeSell: number;
  volumeTotal: number;
  delta: number;
  tickCount: number;
}

export interface ClusterData {
  id: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBuy: number;
  volumeSell: number;
  volumeTotal: number;
  bodyVolume: number;
  wickVolume: number;
  bodyVolumeRatio: number;
  delta: number;
  poc: number;
  priceLevels: PriceLevel[];
  tickCount: number;
  startTime: number;
  endTime?: number;
  isClosed: boolean;
}

export interface ClusterConfig {
  priceLevelSize: number;
  deltaThreshold: number;
  tickThreshold?: number;
}

export interface SymbolPreset {
  name: string;
  label: string;
  priceLevelSize: number;
  digits: number;
  deltaThreshold: number;
}
