import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';

let logger: ReturnType<LoggerProvider['getLogger']> | undefined;
let configured = false;

function integrationLogger() {
  if (configured) return logger;
  configured = true;

  const key = process.env.VITE_POSTHOG_KEY;
  const host = process.env.VITE_POSTHOG_HOST;
  if (!key || !host) {
    if (process.env.NODE_ENV !== 'production') {
      if (!key) console.error('VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured');
      if (!host) console.error('VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured');
    }
    return undefined;
  }

  // This provider is intentionally not registered globally: only this module's purpose-written records are exported.
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ 'service.name': 'openproblems-server' }),
    processors: [new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: new URL('/i/v1/logs', host).toString(),
        headers: { Authorization: `Bearer ${key}` },
      }),
    })],
  });
  logger = provider.getLogger('posthog-integration');
  return logger;
}

/** Emit an integration-owned operational record without routing existing application logs to PostHog. */
export function posthogLog(message: string, attributes: Record<string, string | number | boolean>) {
  integrationLogger()?.emit({ severityText: 'INFO', body: message, attributes });
}
