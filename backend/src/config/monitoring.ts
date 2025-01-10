import { logger } from './logger';

interface Metrics {
  websocketConnections: number;
  cacheHits: number;
  cacheMisses: number;
  apiLatency: Record<string, number[]>;
  errors: Record<string, number>;
}

export class Monitoring {
  private static instance: Monitoring;
  private metrics: Metrics;
  private metricsInterval: NodeJS.Timeout;

  private constructor() {
    this.metrics = {
      websocketConnections: 0,
      cacheHits: 0,
      cacheMisses: 0,
      apiLatency: {},
      errors: {}
    };

    this.metricsInterval = setInterval(() => this.logMetrics(), 60000);
  }

  static getInstance(): Monitoring {
    if (!Monitoring.instance) {
      Monitoring.instance = new Monitoring();
    }
    return Monitoring.instance;
  }

  trackWebsocketConnection(count: number): void {
    this.metrics.websocketConnections = count;
  }

  trackCacheHit(): void {
    this.metrics.cacheHits++;
  }

  trackCacheMiss(): void {
    this.metrics.cacheMisses++;
  }

  trackLatency(endpoint: string, duration: number): void {
    this.metrics.apiLatency[endpoint] = this.metrics.apiLatency[endpoint] || [];
    this.metrics.apiLatency[endpoint].push(duration);
  }

  trackError(type: string): void {
    this.metrics.errors[type] = (this.metrics.errors[type] || 0) + 1;
  }

  private logMetrics(): void {
    const avgLatency: Record<string, number> = {};
    Object.entries(this.metrics.apiLatency).forEach(([endpoint, durations]) => {
      avgLatency[endpoint] = durations.reduce((a, b) => a + b, 0) / durations.length;
    });

    logger.info('System Metrics', {
      timestamp: new Date().toISOString(),
      metrics: {
        websocketConnections: this.metrics.websocketConnections,
        cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
        averageLatency: avgLatency,
        errors: this.metrics.errors
      }
    });

    // Reset metrics
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.metrics.apiLatency = {};
    this.metrics.errors = {};
  }

  cleanup(): void {
    clearInterval(this.metricsInterval);
  }
} 