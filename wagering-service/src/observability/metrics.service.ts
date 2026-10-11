import { Controller, Get, Module, Global, Header } from '@nestjs/common';

export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, { count: number; sum: number }>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, labels = ''): void {
    const key = `${name}${labels}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  observe(name: string, milliseconds: number): void {
    const previous = this.timings.get(name) ?? { count: 0, sum: 0 };
    this.timings.set(name, { count: previous.count + 1, sum: previous.sum + milliseconds });
  }
  setGauge(name: string, value: number): void { this.gauges.set(name, value); }

  render(): string {
    const lines = [
      '# TYPE wager_transactions_total counter',
      ...[...this.counters].map(([key, value]) => `${key} ${value}`),
      ...[...this.gauges].map(([key, value]) => `${key} ${value}`),
      '# TYPE wager_processing_duration_ms summary',
      ...[...this.timings].flatMap(([name, value]) => [
        `${name}_count ${value.count}`, `${name}_sum ${value.sum}`,
      ]),
    ];
    return `${lines.join('\n')}\n`;
  }
}

@Controller()
class MetricsController {
  constructor(private readonly metrics: MetricsService) {}
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  getMetrics(): string { return this.metrics.render(); }
}

@Global()
@Module({ providers: [MetricsService], controllers: [MetricsController], exports: [MetricsService] })
export class MetricsModule {}
