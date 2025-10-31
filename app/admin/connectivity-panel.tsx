'use client';

import { useCallback, useMemo, useState } from 'react';

export interface ConnectivityPanelProps {
  sessionToken: string | null;
  cloudflare: {
    hasImagesCredentials: boolean;
    hasPurgeCredentials: boolean;
    includeProductUrls: boolean;
    enablePurgeOnPublish: boolean;
    zoneIdLabel: string | null;
  };
  tidbConfigured: boolean;
  algoliaConfigured: boolean;
  algoliaIndexName?: string | null;
}

type ActionStatus = 'idle' | 'loading' | 'success' | 'error';

type CloudflareAction =
  | 'test'
  | 'purge-sitemaps'
  | 'purge-last-batch'
  | 'purge-everything';

interface CloudflareActivityEntry {
  id: string;
  action: CloudflareAction;
  timestamp: string;
  ok: boolean;
  latencyMs?: number;
  rayIds: string[];
  errorCode?: string;
  details?: string;
}

interface TidbResult {
  status: ActionStatus;
  timestamp?: string;
  latencyMs?: number;
  published?: number;
  lastmod?: string | null;
  errorCode?: string;
  details?: string;
}

interface AlgoliaResult {
  status: ActionStatus;
  timestamp?: string;
  latencyMs?: number;
  errorCode?: string;
  details?: string;
}

interface RevalidateResult {
  status: ActionStatus;
  timestamp?: string;
  latencyMs?: number;
  errorCode?: string;
}

const CLOUD_FLARE_ENDPOINTS: Record<CloudflareAction, { url: string; method: 'GET' | 'POST' }> = {
  test: { url: '/api/admin/connectivity/cloudflare/test', method: 'GET' },
  'purge-sitemaps': {
    url: '/api/admin/connectivity/cloudflare/purge-sitemaps',
    method: 'POST',
  },
  'purge-last-batch': {
    url: '/api/admin/connectivity/cloudflare/purge-last-batch',
    method: 'POST',
  },
  'purge-everything': {
    url: '/api/admin/connectivity/cloudflare/purge-everything',
    method: 'POST',
  },
};

const TIDB_ENDPOINT = { url: '/api/admin/connectivity/tidb', method: 'GET' as const };
const ALGOLIA_ENDPOINT = {
  url: '/api/admin/connectivity/algolia',
  method: 'POST' as const,
};
const REVALIDATE_ENDPOINT = {
  url: '/api/admin/connectivity/revalidate-sitemap',
  method: 'POST' as const,
};

function getStatusLabel(status: ActionStatus): string {
  switch (status) {
    case 'success':
      return 'Connected';
    case 'error':
      return 'Down';
    case 'loading':
      return 'Comprobando…';
    default:
      return 'Estado desconocido';
  }
}

function getStatusClass(status: ActionStatus): string {
  switch (status) {
    case 'success':
      return 'status-badge status-success';
    case 'error':
      return 'status-badge status-error';
    default:
      return 'status-badge status-idle';
  }
}

function formatLatency(value?: number): string {
  if (typeof value !== 'number') {
    return '—';
  }
  return `${value} ms`;
}

function formatTimestampLabel(value?: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatRayIds(rayIds: string[]): string {
  if (!rayIds || rayIds.length === 0) {
    return '—';
  }
  return rayIds.join(', ');
}

function getCloudflareActionLabel(action: CloudflareAction): string {
  switch (action) {
    case 'test':
      return 'Test Cloudflare Connection';
    case 'purge-sitemaps':
      return 'Purge Sitemaps';
    case 'purge-last-batch':
      return 'Purge Last Batch URLs';
    case 'purge-everything':
      return 'Purge Everything';
    default:
      return action;
  }
}

type ApiResponse<T extends Record<string, unknown>> = {
  ok: boolean;
  error_code?: string;
  latency_ms?: number;
  ray_ids?: string[];
  details?: string;
} & T;

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('connectivity_panel_parse_error', {
      error: (error as Error)?.message,
      snippet: text.slice(0, 120),
    });
    throw error;
  }
}

export default function ConnectivityPanel(props: ConnectivityPanelProps) {
  const { sessionToken, cloudflare, tidbConfigured, algoliaConfigured, algoliaIndexName } = props;

  const [cloudflareState, setCloudflareState] = useState<{
    status: ActionStatus;
    runningAction: CloudflareAction | null;
    lastResult: CloudflareActivityEntry | null;
    activity: CloudflareActivityEntry[];
    hasRecordedBatch: boolean;
  }>(() => ({
    status: 'idle',
    runningAction: null,
    lastResult: null,
    activity: [],
    hasRecordedBatch: false,
  }));

  const [tidbState, setTidbState] = useState<TidbResult>({ status: 'idle' });
  const [algoliaState, setAlgoliaState] = useState<AlgoliaResult>({ status: 'idle' });
  const [revalidateState, setRevalidateState] = useState<RevalidateResult>({ status: 'idle' });

  const callEndpoint = useCallback(
    async <T extends Record<string, unknown>>(
      url: string,
      method: 'GET' | 'POST',
      body?: unknown
    ): Promise<ApiResponse<T>> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }
      let requestBody: BodyInit | undefined;
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        requestBody = body !== undefined ? JSON.stringify(body) : JSON.stringify({});
      }

      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        credentials: 'include',
      });
      const json = await readJson<ApiResponse<T>>(response);
      return json;
    },
    [sessionToken]
  );

  const runCloudflareAction = useCallback(
    async (action: CloudflareAction) => {
      const endpoint = CLOUD_FLARE_ENDPOINTS[action];
      setCloudflareState((prev) => ({
        ...prev,
        status: 'loading',
        runningAction: action,
      }));

      try {
        const data = await callEndpoint<Record<string, unknown>>(
          endpoint.url,
          endpoint.method
        );
        const timestamp = new Date().toISOString();
        const entry: CloudflareActivityEntry = {
          id: `${timestamp}-${action}`,
          action,
          timestamp,
          ok: data.ok,
          latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
          rayIds: Array.isArray(data.ray_ids) ? data.ray_ids : [],
          errorCode: data.error_code,
          details: typeof data.details === 'string' ? data.details : undefined,
        };

        console[data.ok ? 'info' : 'warn']('cloudflare_admin_action', {
          action,
          ok: data.ok,
          errorCode: data.error_code,
          latencyMs: data.latency_ms,
          rayIds: entry.rayIds,
        });

        setCloudflareState((prev) => ({
          status: data.ok ? 'success' : 'error',
          runningAction: null,
          lastResult: entry,
          activity: [entry, ...prev.activity].slice(0, 10),
          hasRecordedBatch:
            action === 'purge-sitemaps'
              ? data.ok || prev.hasRecordedBatch
              : action === 'purge-last-batch'
              ? data.ok
                ? true
                : data.error_code === 'no_previous_batch'
                ? false
                : prev.hasRecordedBatch
              : prev.hasRecordedBatch,
        }));
      } catch (error) {
        const timestamp = new Date().toISOString();
        const entry: CloudflareActivityEntry = {
          id: `${timestamp}-${action}`,
          action,
          timestamp,
          ok: false,
          rayIds: [],
          errorCode: 'network_error',
          details: (error as Error)?.message,
        };
        console.error('cloudflare_admin_action_failed', {
          action,
          error: (error as Error)?.message,
        });
        setCloudflareState((prev) => ({
          status: 'error',
          runningAction: null,
          lastResult: entry,
          activity: [entry, ...prev.activity].slice(0, 10),
          hasRecordedBatch: prev.hasRecordedBatch,
        }));
      }
    },
    [callEndpoint]
  );

  const testTidb = useCallback(async () => {
    setTidbState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const data = await callEndpoint<{ published?: number; lastmod?: string | null }>(
        TIDB_ENDPOINT.url,
        TIDB_ENDPOINT.method
      );
      const timestamp = new Date().toISOString();
      setTidbState({
        status: data.ok ? 'success' : 'error',
        timestamp,
        latencyMs: data.latency_ms,
        published: data.published,
        lastmod: data.lastmod ?? null,
        errorCode: data.ok ? undefined : data.error_code,
        details: data.ok ? undefined : data.details,
      });
      console[data.ok ? 'info' : 'warn']('tidb_admin_test', {
        ok: data.ok,
        latencyMs: data.latency_ms,
        errorCode: data.error_code,
      });
    } catch (error) {
      console.error('tidb_admin_test_failed', { error: (error as Error)?.message });
      setTidbState({
        status: 'error',
        timestamp: new Date().toISOString(),
        errorCode: 'network_error',
        details: (error as Error)?.message,
      });
    }
  }, [callEndpoint]);

  const testAlgolia = useCallback(async () => {
    setAlgoliaState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const data = await callEndpoint<Record<string, unknown>>(
        ALGOLIA_ENDPOINT.url,
        ALGOLIA_ENDPOINT.method
      );
      const timestamp = new Date().toISOString();
      setAlgoliaState({
        status: data.ok ? 'success' : 'error',
        timestamp,
        latencyMs: data.latency_ms,
        errorCode: data.ok ? undefined : data.error_code,
        details: data.ok ? undefined : (data.details as string | undefined),
      });
      console[data.ok ? 'info' : 'warn']('algolia_admin_test', {
        ok: data.ok,
        latencyMs: data.latency_ms,
        errorCode: data.error_code,
      });
    } catch (error) {
      console.error('algolia_admin_test_failed', { error: (error as Error)?.message });
      setAlgoliaState({
        status: 'error',
        timestamp: new Date().toISOString(),
        errorCode: 'network_error',
        details: (error as Error)?.message,
      });
    }
  }, [callEndpoint]);

  const triggerRevalidate = useCallback(async () => {
    setRevalidateState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const data = await callEndpoint<Record<string, unknown>>(
        REVALIDATE_ENDPOINT.url,
        REVALIDATE_ENDPOINT.method
      );
      const timestamp = new Date().toISOString();
      setRevalidateState({
        status: data.ok ? 'success' : 'error',
        timestamp,
        latencyMs: data.latency_ms,
        errorCode: data.ok ? undefined : data.error_code,
      });
      console[data.ok ? 'info' : 'warn']('revalidate_sitemap_action', {
        ok: data.ok,
        latencyMs: data.latency_ms,
        errorCode: data.error_code,
      });
    } catch (error) {
      console.error('revalidate_sitemap_action_failed', {
        error: (error as Error)?.message,
      });
      setRevalidateState({
        status: 'error',
        timestamp: new Date().toISOString(),
        errorCode: 'network_error',
      });
    }
  }, [callEndpoint]);

  const cloudflareStatus = useMemo<ActionStatus>(() => {
    if (cloudflareState.runningAction) {
      return 'loading';
    }
    return cloudflareState.status;
  }, [cloudflareState.runningAction, cloudflareState.status]);

  return (
    <div className="admin-grid">
      <section className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Cloudflare</h2>
            <p className="admin-card-description">
              Prueba la conectividad con la API de Cloudflare y ejecuta purgas manuales de caché.
            </p>
          </div>
          <span className={getStatusClass(cloudflareStatus)}>{getStatusLabel(cloudflareStatus)}</span>
        </div>

        <div className="metric-grid">
          <div className="metric-block">
            <span className="metric-label">Zone ID</span>
            <span className="metric-value">{cloudflare.zoneIdLabel ?? '—'}</span>
            <span className="metric-secondary">
              Autopurge {cloudflare.enablePurgeOnPublish ? 'habilitado' : 'deshabilitado'} · Productos{' '}
              {cloudflare.includeProductUrls ? 'incluidos' : 'omitidos'}
            </span>
          </div>
          <div className="metric-block">
            <span className="metric-label">Último resultado</span>
            <span className="metric-value">
              {cloudflareState.lastResult
                ? `${getCloudflareActionLabel(cloudflareState.lastResult.action)} · ${cloudflareState.lastResult.ok ? 'OK' : 'Error'}`
                : 'Aún no ejecutado'}
            </span>
            <span className="metric-secondary">
              {cloudflareState.lastResult
                ? formatTimestampLabel(cloudflareState.lastResult.timestamp)
                : 'Sin registro'}
            </span>
          </div>
          <div className="metric-block">
            <span className="metric-label">Última latencia</span>
            <span className="metric-value">
              {formatLatency(cloudflareState.lastResult?.latencyMs)}
            </span>
            <span className="metric-secondary">
              Ray IDs: {formatRayIds(cloudflareState.lastResult?.rayIds ?? [])}
            </span>
          </div>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="admin-button"
            onClick={() => runCloudflareAction('test')}
            disabled={
              !cloudflare.hasImagesCredentials ||
              Boolean(cloudflareState.runningAction)
            }
          >
            {cloudflareState.runningAction === 'test' ? 'Testing…' : 'Test Cloudflare Connection'}
          </button>
          <button
            type="button"
            className="admin-button"
            onClick={() => runCloudflareAction('purge-sitemaps')}
            disabled={
              !cloudflare.hasPurgeCredentials || Boolean(cloudflareState.runningAction)
            }
          >
            {cloudflareState.runningAction === 'purge-sitemaps'
              ? 'Purging…'
              : 'Purge Sitemaps'}
          </button>
          <button
            type="button"
            className="admin-button"
            onClick={() => runCloudflareAction('purge-last-batch')}
            disabled={
              !cloudflare.hasPurgeCredentials ||
              Boolean(cloudflareState.runningAction) ||
              !cloudflareState.hasRecordedBatch
            }
          >
            {cloudflareState.runningAction === 'purge-last-batch'
              ? 'Purging…'
              : 'Purge Last Batch URLs'}
          </button>
          <button
            type="button"
            className="admin-button"
            onClick={() => runCloudflareAction('purge-everything')}
            disabled={
              !cloudflare.hasPurgeCredentials || Boolean(cloudflareState.runningAction)
            }
          >
            {cloudflareState.runningAction === 'purge-everything'
              ? 'Purging…'
              : 'Purge Everything'}
          </button>
        </div>

        {!cloudflare.hasPurgeCredentials && (
          <div className="warning-block">
            Configura CLOUDFLARE_ZONE_ID y CLOUDFLARE_API_TOKEN para habilitar las purgas manuales.
          </div>
        )}

        <div>
          <span className="metric-label">Actividad reciente</span>
          {cloudflareState.activity.length === 0 ? (
            <p className="muted">No hay ejecuciones registradas todavía.</p>
          ) : (
            <div className="activity-list">
              {cloudflareState.activity.map((entry) => (
                <div key={entry.id} className="activity-item">
                  <div className="activity-headline">
                    <span>{getCloudflareActionLabel(entry.action)}</span>
                    <span>{formatTimestampLabel(entry.timestamp)}</span>
                  </div>
                  <div className="activity-meta">
                    <span>Latencia: {formatLatency(entry.latencyMs)}</span>
                    <span>Ray IDs: {formatRayIds(entry.rayIds)}</span>
                  </div>
                  {!entry.ok && (
                    <div className="activity-error">
                      Error: {entry.errorCode ?? 'unknown'}{' '}
                      {entry.details ? `— ${entry.details}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="admin-grid admin-grid-two">
        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-card-title">TiDB</h2>
              <p className="admin-card-description">
                Ejecuta consultas básicas para verificar la disponibilidad de la base de datos.
              </p>
            </div>
            <span className={getStatusClass(tidbState.status)}>{getStatusLabel(tidbState.status)}</span>
          </div>

          <div className="metric-grid">
            <div className="metric-block">
              <span className="metric-label">Latencia</span>
              <span className="metric-value">{formatLatency(tidbState.latencyMs)}</span>
              <span className="metric-secondary">
                {tidbState.timestamp ? formatTimestampLabel(tidbState.timestamp) : 'Sin registro'}
              </span>
            </div>
            <div className="metric-block">
              <span className="metric-label">Productos publicados</span>
              <span className="metric-value">
                {typeof tidbState.published === 'number' ? tidbState.published : '—'}
              </span>
            </div>
            <div className="metric-block">
              <span className="metric-label">Último update</span>
              <span className="metric-value">
                {tidbState.lastmod ? formatTimestampLabel(tidbState.lastmod) : '—'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="admin-button"
            onClick={testTidb}
            disabled={!tidbConfigured || tidbState.status === 'loading'}
          >
            {tidbState.status === 'loading' ? 'Testing…' : 'Test TiDB Connection'}
          </button>

          {!tidbConfigured && (
            <div className="warning-block">
              Configura las variables de TiDB para habilitar esta prueba de conectividad.
            </div>
          )}

          {tidbState.status === 'error' && tidbState.errorCode && (
            <div className="error-block">
              Código: {tidbState.errorCode}
              {tidbState.details ? ` — ${tidbState.details}` : ''}
            </div>
          )}
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-card-title">Algolia</h2>
              <p className="admin-card-description">
                Comprueba el acceso al índice configurado y la latencia de la API.
              </p>
            </div>
            <span className={getStatusClass(algoliaState.status)}>{getStatusLabel(algoliaState.status)}</span>
          </div>

          <div className="metric-grid">
            <div className="metric-block">
              <span className="metric-label">Latencia</span>
              <span className="metric-value">{formatLatency(algoliaState.latencyMs)}</span>
              <span className="metric-secondary">
                {algoliaState.timestamp ? formatTimestampLabel(algoliaState.timestamp) : 'Sin registro'}
              </span>
            </div>
            <div className="metric-block">
              <span className="metric-label">Índice</span>
              <span className="metric-value">{algoliaIndexName ?? '—'}</span>
              <span className="metric-secondary">
                Estado: {algoliaState.status === 'success' ? 'Existe' : 'Sin confirmar'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="admin-button"
            onClick={testAlgolia}
            disabled={!algoliaConfigured || algoliaState.status === 'loading'}
          >
            {algoliaState.status === 'loading' ? 'Testing…' : 'Test Algolia Connection'}
          </button>

          {!algoliaConfigured && (
            <div className="warning-block">
              Configura ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY y ALGOLIA_INDEX para ejecutar la prueba.
            </div>
          )}

          {algoliaState.status === 'error' && algoliaState.errorCode && (
            <div className="error-block">
              Código: {algoliaState.errorCode}
              {algoliaState.details ? ` — ${algoliaState.details}` : ''}
            </div>
          )}
        </section>
      </div>

      <section className="admin-card revalidate-card">
        <div className="revalidate-layout">
          <div className="revalidate-text">
            <h2 className="admin-card-title">Revalidate Sitemap</h2>
            <p className="admin-card-description">
              Lanza una verificación rápida del sitemap público para confirmar que la caché se actualizó.
            </p>
            <div>
              <span className="metric-label">Último resultado</span>
              <span className="metric-value">
                {revalidateState.timestamp ? formatTimestampLabel(revalidateState.timestamp) : 'Sin registro'}
              </span>
              <span className="metric-secondary">
                Latencia: {formatLatency(revalidateState.latencyMs)}
              </span>
            </div>
          </div>
          <div>
            <span className={getStatusClass(revalidateState.status)}>
              {getStatusLabel(revalidateState.status)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="admin-button"
          onClick={triggerRevalidate}
          disabled={revalidateState.status === 'loading'}
        >
          {revalidateState.status === 'loading' ? 'Revalidating…' : 'Revalidate Sitemap'}
        </button>
        {revalidateState.status === 'error' && revalidateState.errorCode && (
          <div className="error-block">Código: {revalidateState.errorCode}</div>
        )}
      </section>
    </div>
  );
}
