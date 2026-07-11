import { useAzureMonitor } from '@azure/monitor-opentelemetry';

interface AzureMonitorBootstrapStatus {
  configured: boolean;
  started: boolean;
  error?: string;
}

const state: AzureMonitorBootstrapStatus = {
  configured: Boolean(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING),
  started: false,
};

const globalKey = '__morganAzureMonitorStarted';
const globalState = globalThis as typeof globalThis & { [globalKey]?: boolean };

if (state.configured && !globalState[globalKey]) {
  try {
    useAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
      },
      enableLiveMetrics: true,
      enableTraceBasedSamplingForLogs: true,
    });
    globalState[globalKey] = true;
    state.started = true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
} else if (globalState[globalKey]) {
  state.started = true;
}

export function getAzureMonitorBootstrapStatus(): AzureMonitorBootstrapStatus {
  return { ...state };
}
