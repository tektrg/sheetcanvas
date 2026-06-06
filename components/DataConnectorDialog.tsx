
import React, { useEffect, useRef, useState } from 'react';
import { ConnectorConfig, ConnectorType } from '../types';
import { X, Database, FileSpreadsheet, BarChart2, Globe, Loader2, CheckCircle2, AlertCircle, KeyRound, RefreshCcw, Code2 } from 'lucide-react';
import { fetchDataFromConnector } from '../utils/dataConnectors';
import { ClickHousePublicConnector, clickhouseResultToMatrix, createClickhouseConnector, listClickhouseConnectors, queryClickhouse, testClickhouseConnector } from '../utils/clickhouseBackend';
import {
  buildGoogleAnalyticsAuthUrl,
  buildGoogleSheetsAuthUrl,
  clearGoogleAuthParams,
  clearGoogleAnalyticsAuth,
  clearGoogleSheetsAuth,
  loadGoogleAnalyticsAuth,
  loadGoogleSheetsAuth
} from '../utils/googleAnalyticsAuth';
import {
  exchangeGoogleAnalyticsAuthCode,
  listGoogleAnalyticsConnectors,
  listGoogleAnalyticsProperties,
  type GoogleAnalyticsProperty,
  type GoogleAnalyticsPublicConnector,
  type GoogleAnalyticsReport
} from '../utils/googleAnalyticsBackend';
import {
  DEFAULT_GOOGLE_SHEETS_RANGE,
  exchangeGoogleSheetsAuthCode,
  listGoogleSheetsConnectors,
  type GoogleSheetsPublicConnector
} from '../utils/googleSheetsBackend';

interface DataConnectorDialogProps {
  onClose: () => void;
  onImport: (title: string, data: string[][], config: ConnectorConfig) => void;
  initialType?: ConnectorType;
}

const GA_DIMENSION_PRESETS = [
  'date',
  'dateHour',
  'sessionSource',
  'sessionMedium',
  'sessionCampaignName',
  'country',
  'city',
  'deviceCategory',
  'pagePath'
];

const GA_METRIC_PRESETS = [
  'activeUsers',
  'sessions',
  'eventCount',
  'totalUsers',
  'newUsers',
  'screenPageViews',
  'bounceRate',
  'engagementRate'
];

export const DataConnectorDialog: React.FC<DataConnectorDialogProps> = ({ onClose, onImport, initialType }) => {
  const [selectedType, setSelectedType] = useState<ConnectorType | null>(initialType || null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Form States
  const [sheetId, setSheetId] = useState('');
  const [sheetRange, setSheetRange] = useState(DEFAULT_GOOGLE_SHEETS_RANGE);
  const [propertyId, setPropertyId] = useState('');
  const [url, setUrl] = useState('');
  const [simulate, setSimulate] = useState(() => (initialType === 'google-analytics' || initialType === 'google-sheets' ? false : true));
  const [gsConnectorId, setGsConnectorId] = useState('');
  const [gsConnectors, setGsConnectors] = useState<GoogleSheetsPublicConnector[]>([]);
  const [gsLoadingConnectors, setGsLoadingConnectors] = useState(false);
  const [gsAuthLoading, setGsAuthLoading] = useState(false);
  const [gsAuthError, setGsAuthError] = useState('');
  const [gaConnectorId, setGaConnectorId] = useState('');
  const [gaUseManualConnectorId, setGaUseManualConnectorId] = useState(false);
  const [gaConnectors, setGaConnectors] = useState<GoogleAnalyticsPublicConnector[]>([]);
  const [gaLoadingConnectors, setGaLoadingConnectors] = useState(false);
  const [gaAuthLoading, setGaAuthLoading] = useState(false);
  const [gaAuthError, setGaAuthError] = useState('');
  const [gaProperties, setGaProperties] = useState<GoogleAnalyticsProperty[]>([]);
  const [gaLoadingProperties, setGaLoadingProperties] = useState(false);
  const [gaPropertyError, setGaPropertyError] = useState('');
  const [gaDimensions, setGaDimensions] = useState('date');
  const [gaMetrics, setGaMetrics] = useState('activeUsers,sessions');
  const [gaDatePreset, setGaDatePreset] = useState<'7d' | '14d' | '28d' | '90d' | 'custom'>('28d');
  const [gaStartDate, setGaStartDate] = useState('');
  const [gaEndDate, setGaEndDate] = useState('');
  const [gaOrderByField, setGaOrderByField] = useState('');
  const [gaOrderByType, setGaOrderByType] = useState<'dimension' | 'metric'>('dimension');
  const [gaOrderByDesc, setGaOrderByDesc] = useState(true);
  const [gaDimensionFilter, setGaDimensionFilter] = useState('');
  const [gaMetricFilter, setGaMetricFilter] = useState('');

  // ClickHouse (backend-proxy) state
  const [chConnectors, setChConnectors] = useState<ClickHousePublicConnector[]>([]);
  const [chSelectedConnectorId, setChSelectedConnectorId] = useState<string>('');
  const [chSql, setChSql] = useState<string>('SELECT 1');
  const [chShowNewConnector, setChShowNewConnector] = useState(false);
  const [chName, setChName] = useState('');
  const [chUrl, setChUrl] = useState('');
  const [chUsername, setChUsername] = useState('');
  const [chPassword, setChPassword] = useState('');
  const [chTesting, setChTesting] = useState(false);
  const [chSaving, setChSaving] = useState(false);
  const [chTestOk, setChTestOk] = useState<boolean | null>(null);
  const clickhouseSqlRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.body.dataset.modalOpen = 'true';
    return () => {
      delete document.body.dataset.modalOpen;
    };
  }, []);

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();

    if (selectedType === 'clickhouse') {
      requestAnimationFrame(() => clickhouseSqlRef.current?.focus());
    }
  }, [selectedType]);

  const loadClickhouseConnectors = async () => {
    const connectors = await listClickhouseConnectors();
    setChConnectors(connectors);
    if (!chSelectedConnectorId && connectors.length > 0) setChSelectedConnectorId(connectors[0].id);
  };

  const loadGoogleAnalyticsConnectors = async () => {
    setGaLoadingConnectors(true);
    setGaAuthError('');
    try {
      const connectors = await listGoogleAnalyticsConnectors();
      setGaConnectors(connectors);
      if (!gaConnectorId && connectors.length > 0) {
        setGaConnectorId(connectors[0].id);
      }
    } catch (e: any) {
      setGaAuthError(e.message || 'Failed to load Google Analytics connectors');
    } finally {
      setGaLoadingConnectors(false);
    }
  };

  const loadGoogleSheetsConnectors = async () => {
    setGsLoadingConnectors(true);
    setGsAuthError('');
    try {
      const connectors = await listGoogleSheetsConnectors();
      setGsConnectors(connectors);
      if (!gsConnectorId && connectors.length > 0) {
        setGsConnectorId(connectors[0].id);
      }
    } catch (e: any) {
      setGsAuthError(e.message || 'Failed to load Google Sheets connectors');
    } finally {
      setGsLoadingConnectors(false);
    }
  };

  const loadGoogleAnalyticsProperties = async (connectorId: string) => {
    if (!connectorId) return;
    setGaLoadingProperties(true);
    setGaPropertyError('');
    try {
      const properties = await listGoogleAnalyticsProperties({ connectorId });
      setGaProperties(properties);
      if (properties.length > 0) {
        const first = properties[0].propertyId;
        const hasMatch = properties.some((prop) => prop.propertyId === propertyId);
        if (!propertyId || !hasMatch) setPropertyId(first);
      }
    } catch (e: any) {
      setGaPropertyError(e.message || 'Failed to load properties');
      setGaProperties([]);
    } finally {
      setGaLoadingProperties(false);
    }
  };

  const handleSelectType = async (type: ConnectorType) => {
    setSelectedType(type);
    setStatus('idle');
    setErrorMsg('');
    // Google OAuth-backed connectors rely on backend connector selection; default to real mode.
    // Other connectors default to simulated mode for the demo experience.
    setSimulate(type === 'google-analytics' || type === 'google-sheets' ? false : true);
    if (type === 'clickhouse') {
      try {
        await loadClickhouseConnectors();
      } catch (e: any) {
        setErrorMsg(e.message || 'Failed to load connectors');
        setStatus('error');
      }
    }
    if (type === 'google-analytics') {
      await loadGoogleAnalyticsConnectors();
    }
    if (type === 'google-sheets') {
      await loadGoogleSheetsConnectors();
    }
  };

  useEffect(() => {
    if (selectedType === 'clickhouse') {
      loadClickhouseConnectors().catch((e: any) => {
        setErrorMsg(e.message || 'Failed to load connectors');
        setStatus('error');
      });
    }
    if (selectedType === 'google-analytics') {
      loadGoogleAnalyticsConnectors();
    }
    if (selectedType === 'google-sheets') {
      loadGoogleSheetsConnectors();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedType !== 'google-analytics') return;
    if (simulate) return;
    if (!gaConnectorId) return;
    loadGoogleAnalyticsProperties(gaConnectorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, simulate, gaConnectorId]);

  useEffect(() => {
    if (selectedType !== 'google-analytics') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    if (!code && !error) return;

    const stored = loadGoogleAnalyticsAuth();
    clearGoogleAuthParams();

    if (error) {
      setGaAuthError(errorDescription || error);
      clearGoogleAnalyticsAuth();
      return;
    }

    if (!stored || !state || stored.state !== state) {
      setGaAuthError('OAuth state mismatch. Please retry connection.');
      clearGoogleAnalyticsAuth();
      return;
    }

    setGaAuthLoading(true);
    exchangeGoogleAnalyticsAuthCode({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri
    })
      .then(({ connector }) => {
        setGaAuthError('');
        setGaConnectorId(connector.id);
        setGaUseManualConnectorId(false);
        setSimulate(false);
        loadGoogleAnalyticsConnectors();
      })
      .catch((e: any) => {
        setGaAuthError(e.message || 'Failed to exchange authorization code');
      })
      .finally(() => {
        setGaAuthLoading(false);
        clearGoogleAnalyticsAuth();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  useEffect(() => {
    if (selectedType !== 'google-sheets') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    if (!code && !error) return;

    const stored = loadGoogleSheetsAuth();
    clearGoogleAuthParams();

    if (error) {
      setGsAuthError(errorDescription || error);
      clearGoogleSheetsAuth();
      return;
    }

    if (!stored || !state || stored.state !== state) {
      setGsAuthError('OAuth state mismatch. Please retry connection.');
      clearGoogleSheetsAuth();
      return;
    }

    setGsAuthLoading(true);
    exchangeGoogleSheetsAuthCode({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri
    })
      .then(({ connector }) => {
        setGsAuthError('');
        setGsConnectorId(connector.id);
        setSimulate(false);
        loadGoogleSheetsConnectors();
      })
      .catch((e: any) => {
        setGsAuthError(e.message || 'Failed to exchange authorization code');
      })
      .finally(() => {
        setGsAuthLoading(false);
        clearGoogleSheetsAuth();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  const startGoogleAnalyticsAuth = async () => {
    const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId || !clientId.trim()) {
      setGaAuthError('Missing VITE_GOOGLE_CLIENT_ID');
      return;
    }
    // Keep redirect URI stable so Google OAuth config can whitelist a single value.
    const redirectUri = `${window.location.origin}/`;
    setGaAuthLoading(true);
    setGaAuthError('');
    try {
      const url = await buildGoogleAnalyticsAuthUrl({
        clientId: clientId.trim(),
        redirectUri
      });
      window.location.assign(url);
    } catch (e: any) {
      setGaAuthError(e.message || 'Failed to start OAuth');
      setGaAuthLoading(false);
    }
  };

  const startGoogleSheetsAuth = async () => {
    const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId || !clientId.trim()) {
      setGsAuthError('Missing VITE_GOOGLE_CLIENT_ID');
      return;
    }
    const redirectUri = `${window.location.origin}/`;
    setGsAuthLoading(true);
    setGsAuthError('');
    try {
      const url = await buildGoogleSheetsAuthUrl({
        clientId: clientId.trim(),
        redirectUri
      });
      window.location.assign(url);
    } catch (e: any) {
      setGsAuthError(e.message || 'Failed to start OAuth');
      setGsAuthLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedType) return;
    
    setStatus('loading');
    setErrorMsg('');

    if (selectedType === 'clickhouse') {
      try {
        const connectorId = chSelectedConnectorId;
        if (!connectorId) throw new Error('Select a ClickHouse connector');
        if (!chSql.trim()) throw new Error('SQL is required');

        const result = await queryClickhouse({ connectorId, sql: chSql.trim() });
        const matrix = clickhouseResultToMatrix(result);
        const connector = chConnectors.find((c) => c.id === connectorId);
        const title = connector ? `ClickHouse: ${connector.name}` : 'ClickHouse Query';

        const config: ConnectorConfig = {
          type: 'clickhouse',
          name: connector ? `ClickHouse: ${connector.name}` : 'ClickHouse',
          connectionId: connectorId,
          query: { sql: chSql.trim() },
          lastRefreshedAt: Date.now(),
          truncated: !!result.truncated,
          lastError: '',
        };

        setStatus('success');
        setTimeout(() => {
          onImport(title, matrix, config);
          onClose();
        }, 300);
        return;
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e.message || 'Failed to run query');
        return;
      }
    }

    const config: ConnectorConfig = {
        type: selectedType,
        name: 'Import',
        params: {
            simulate
        }
    };

    if (selectedType === 'google-sheets') {
        if (!sheetId.trim()) {
            setStatus('error');
            setErrorMsg('Google Sheets URL or ID is required');
            return;
        }
        if (!simulate && !gsConnectorId.trim()) {
            setStatus('error');
            setErrorMsg('Select a Google Sheets connector');
            return;
        }
        config.name = 'Google Sheets';
        config.connectionId = gsConnectorId.trim();
        config.query = {
            spreadsheetIdOrUrl: sheetId.trim(),
            range: sheetRange.trim() || DEFAULT_GOOGLE_SHEETS_RANGE
        };
        config.lastRefreshedAt = Date.now();
        config.params.spreadsheetIdOrUrl = sheetId.trim();
        config.params.range = sheetRange.trim() || DEFAULT_GOOGLE_SHEETS_RANGE;
    }
    if (selectedType === 'google-analytics') {
        if (!propertyId.trim()) {
            setStatus('error');
            setErrorMsg('GA4 property ID is required');
            return;
        }
        if (!simulate && !gaConnectorId.trim()) {
            setStatus('error');
            setErrorMsg('Select a Google Analytics connector');
            return;
        }

        const dims = gaDimensions
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        const metrics = gaMetrics
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        const report: GoogleAnalyticsReport = {};
        if (dims.length > 0) report.dimensions = dims.map((name) => ({ name }));
        if (metrics.length > 0) report.metrics = metrics.map((name) => ({ name }));

        if (gaDatePreset !== 'custom') {
            const days = gaDatePreset.replace('d', '');
            report.dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
        } else if (gaStartDate && gaEndDate) {
            report.dateRanges = [{ startDate: gaStartDate, endDate: gaEndDate }];
        }

        if (gaOrderByField.trim()) {
            report.orderBys = [
                gaOrderByType === 'metric'
                    ? { metric: { metricName: gaOrderByField.trim() }, desc: gaOrderByDesc }
                    : { dimension: { dimensionName: gaOrderByField.trim() }, desc: gaOrderByDesc }
            ];
        }

        const dimensionFilter = gaDimensionFilter.trim();
        const metricFilter = gaMetricFilter.trim();
        if (dimensionFilter) {
            try {
                report.dimensionFilter = JSON.parse(dimensionFilter);
            } catch {
                setStatus('error');
                setErrorMsg('Dimension filter must be valid JSON');
                return;
            }
        }
        if (metricFilter) {
            try {
                report.metricFilter = JSON.parse(metricFilter);
            } catch {
                setStatus('error');
                setErrorMsg('Metric filter must be valid JSON');
                return;
            }
        }

        config.connectionId = gaConnectorId.trim();
        config.query = { propertyId: propertyId.trim(), report: Object.keys(report).length > 0 ? report : {} };
        config.lastRefreshedAt = Date.now();
    }
    if (selectedType === 'csv-url') config.params.url = url;

    try {
        const result = await fetchDataFromConnector(config);
        config.truncated = !!result.truncated;
        setStatus('success');
        setTimeout(() => {
            onImport(result.title, result.data, config);
            onClose();
        }, 500);
    } catch (e: any) {
        setStatus('error');
        setErrorMsg(e.message || "Failed to connect");
    }
  };

  const renderConfigForm = () => {
    switch (selectedType) {
        case 'clickhouse':
            return (
                <div className="space-y-5 animate-scale-in">
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Connector</label>
                        <div className="flex gap-2">
                            <select
                                className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                value={chSelectedConnectorId}
                                onChange={e => setChSelectedConnectorId(e.target.value)}
                            >
                                <option value="" disabled>
                                    {chConnectors.length === 0 ? 'No connectors yet' : 'Select connector'}
                                </option>
                                {chConnectors.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.name} ({new URL(c.url).host})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={async () => {
                                    try {
                                        setStatus('idle');
                                        setErrorMsg('');
                                        await loadClickhouseConnectors();
                                    } catch (e: any) {
                                        setErrorMsg(e.message || 'Failed to refresh connectors');
                                        setStatus('error');
                                    }
                                }}
                                className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2"
                                title="Refresh list"
                            >
                                <RefreshCcw size={14} />
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                setChShowNewConnector(!chShowNewConnector);
                                setChTestOk(null);
                            }}
                            className="text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline flex items-center gap-2"
                        >
                            <KeyRound size={14} />
                            {chShowNewConnector ? 'Hide new connector' : 'Create new connector'}
                        </button>
                    </div>

                    {chShowNewConnector && (
                        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-900/40 space-y-3">
                            <div className="grid grid-cols-1 gap-3">
                                <div>
                                    <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">Name (optional)</label>
                                    <input
                                        type="text"
                                        className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                        placeholder="e.g. Prod ClickHouse"
                                        value={chName}
                                        onChange={e => setChName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">ClickHouse URL</label>
                                    <input
                                        type="text"
                                        className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                        placeholder="https://host:8443/?database=default"
                                        value={chUrl}
                                        onChange={e => setChUrl(e.target.value)}
                                    />
                                    <p className="mt-1 text-[10px] text-neutral-400">
                                        Uses ClickHouse HTTP endpoint. Backend will add default JSON format.
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">Username</label>
                                        <input
                                            type="text"
                                            className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                            value={chUsername}
                                            onChange={e => setChUsername(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">Password</label>
                                        <input
                                            type="password"
                                            className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                            value={chPassword}
                                            onChange={e => setChPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <button
                                    onClick={async () => {
                                        setChTesting(true);
                                        setChTestOk(null);
                                        try {
                                            await testClickhouseConnector({ name: chName || undefined, url: chUrl, username: chUsername, password: chPassword });
                                            setChTestOk(true);
                                        } catch (e: any) {
                                            setChTestOk(false);
                                            setStatus('error');
                                            setErrorMsg(e.message || 'Test failed');
                                        } finally {
                                            setChTesting(false);
                                        }
                                    }}
                                    disabled={!chUrl.trim() || !chUsername.trim() || !chPassword || chTesting || chSaving}
                                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                                        !chUrl.trim() || !chUsername.trim() || !chPassword || chTesting || chSaving
                                            ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'
                                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                                    }`}
                                >
                                    {chTesting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                    Test
                                </button>
                                <button
                                    onClick={async () => {
                                        setChSaving(true);
                                        try {
                                            const connector = await createClickhouseConnector({ name: chName || undefined, url: chUrl, username: chUsername, password: chPassword });
                                            await loadClickhouseConnectors();
                                            setChSelectedConnectorId(connector.id);
                                            setChShowNewConnector(false);
                                            setChName('');
                                            setChUrl('');
                                            setChUsername('');
                                            setChPassword('');
                                            setChTestOk(null);
                                        } catch (e: any) {
                                            setStatus('error');
                                            setErrorMsg(e.message || 'Failed to save connector');
                                        } finally {
                                            setChSaving(false);
                                        }
                                    }}
                                    disabled={!chUrl.trim() || !chUsername.trim() || !chPassword || chSaving}
                                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                                        !chUrl.trim() || !chUsername.trim() || !chPassword || chSaving
                                            ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'
                                            : 'bg-teal-600 text-white hover:bg-teal-700'
                                    }`}
                                >
                                    {chSaving ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                                    Save connector
                                </button>
                            </div>
                            {chTestOk === true && (
                                <div className="text-xs text-teal-700 dark:text-teal-300 flex items-center gap-2">
                                    <CheckCircle2 size={14} /> Connection OK
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">SQL</label>
	                        <textarea
	                            ref={clickhouseSqlRef}
	                            className="w-full min-h-[160px] bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
	                            value={chSql}
	                            onChange={e => setChSql(e.target.value)}
	                            placeholder="SELECT ..."
	                        />
                        <p className="mt-1 text-[10px] text-neutral-400">
                            Runs via backend proxy. Only SELECT/WITH queries are allowed.
                        </p>
                    </div>
                </div>
            );
        case 'google-sheets':
            return (
                <div className="space-y-4 animate-scale-in">
                    {!simulate && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">Google Sheets connector</label>
                                <button
                                    onClick={startGoogleSheetsAuth}
                                    className="text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline flex items-center gap-2"
                                >
                                    <KeyRound size={14} />
                                    {gsAuthLoading ? 'Connecting...' : 'Connect Google'}
                                </button>
                            </div>
                            {gsAuthError && (
                                <div className="text-[11px] text-red-500 dark:text-red-400 flex items-center gap-2">
                                    <AlertCircle size={12} />
                                    {gsAuthError}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50 disabled:opacity-60"
                                    value={gsConnectorId}
                                    onChange={e => setGsConnectorId(e.target.value)}
                                    disabled={gsLoadingConnectors}
                                >
                                    <option value="" disabled>
                                        {gsLoadingConnectors ? 'Loading connectors...' : 'Select connector'}
                                    </option>
                                    {gsConnectors.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.name} ({c.id.slice(0, 6)}...)
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={loadGoogleSheetsConnectors}
                                    className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2"
                                    title="Refresh list"
                                >
                                    <RefreshCcw size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Google Sheets URL or ID</label>
                        <input
                            type="text"
                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            placeholder="https://docs.google.com/spreadsheets/d/... or spreadsheet ID"
                            value={sheetId}
                            onChange={e => setSheetId(e.target.value)}
                        />
                        <p className="mt-1 text-[10px] text-neutral-400">Use a sheet you can access with the connected Google account.</p>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">A1 range</label>
                        <input
                            type="text"
                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            placeholder={DEFAULT_GOOGLE_SHEETS_RANGE}
                            value={sheetRange}
                            onChange={e => setSheetRange(e.target.value)}
                        />
                        <p className="mt-1 text-[10px] text-neutral-400">Defaults to {DEFAULT_GOOGLE_SHEETS_RANGE}.</p>
                    </div>
                </div>
            );
        case 'google-analytics':
            return (
                <div className="space-y-4 animate-scale-in">
                    {!simulate && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">Google Analytics connector</label>
                                <button
                                    onClick={startGoogleAnalyticsAuth}
                                    className="text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline flex items-center gap-2"
                                >
                                    <KeyRound size={14} />
                                    {gaAuthLoading ? 'Connecting...' : 'Connect Google'}
                                </button>
                            </div>
                            {gaAuthError && (
                                <div className="text-[11px] text-red-500 dark:text-red-400 flex items-center gap-2">
                                    <AlertCircle size={12} />
                                    {gaAuthError}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50 disabled:opacity-60"
                                    value={gaUseManualConnectorId ? '' : gaConnectorId}
                                    onChange={e => setGaConnectorId(e.target.value)}
                                    disabled={gaUseManualConnectorId || gaLoadingConnectors}
                                >
                                    <option value="" disabled>
                                        {gaLoadingConnectors ? 'Loading connectors...' : 'Select connector'}
                                    </option>
                                    {gaConnectors.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.name} ({c.id.slice(0, 6)}…)
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={loadGoogleAnalyticsConnectors}
                                    className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2"
                                    title="Refresh list"
                                >
                                    <RefreshCcw size={14} />
                                </button>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                                <input
                                    id="ga-manual-id"
                                    type="checkbox"
                                    checked={gaUseManualConnectorId}
                                    onChange={(e) => setGaUseManualConnectorId(e.target.checked)}
                                    className="rounded text-teal-600 focus:ring-teal-500"
                                />
                                <label htmlFor="ga-manual-id" className="cursor-pointer select-none">
                                    Enter connector ID manually
                                </label>
                            </div>
                            {gaUseManualConnectorId && (
                                <input
                                    type="text"
                                    className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    placeholder="Connector UUID"
                                    value={gaConnectorId}
                                    onChange={e => setGaConnectorId(e.target.value)}
                                />
                            )}
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">GA4 Property ID</label>
                        {!simulate && gaProperties.length > 0 && !gaPropertyError ? (
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    value={propertyId}
                                    onChange={e => setPropertyId(e.target.value)}
                                >
                                    {gaProperties.map((prop) => (
                                        <option key={prop.propertyId} value={prop.propertyId}>
                                            {prop.displayName}{prop.accountDisplayName ? ` • ${prop.accountDisplayName}` : ''}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => loadGoogleAnalyticsProperties(gaConnectorId)}
                                    className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2"
                                    title="Refresh properties"
                                    disabled={!gaConnectorId}
                                >
                                    <RefreshCcw size={14} />
                                </button>
                            </div>
                        ) : (
                            <input 
                                type="text" 
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                placeholder="e.g. 342555123"
                                value={propertyId}
                                onChange={e => setPropertyId(e.target.value)}
                            />
                        )}
                        {gaLoadingProperties && (
                            <p className="mt-1 text-[10px] text-neutral-400">Loading properties…</p>
                        )}
                        {gaPropertyError && (
                            <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">{gaPropertyError}</p>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Dimensions</label>
                            <input 
                                type="text" 
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                placeholder="date,sessionSource"
                                value={gaDimensions}
                                onChange={e => setGaDimensions(e.target.value)}
                            />
                            <div className="mt-2 flex flex-wrap gap-1">
                                {GA_DIMENSION_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                            const existing = gaDimensions.split(',').map((item) => item.trim()).filter(Boolean);
                                            if (!existing.includes(preset)) {
                                                setGaDimensions([...existing, preset].join(','));
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                                    >
                                        {preset}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-1 text-[10px] text-neutral-400">Comma-separated GA4 dimension names.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Metrics</label>
                            <input 
                                type="text" 
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                placeholder="activeUsers,sessions"
                                value={gaMetrics}
                                onChange={e => setGaMetrics(e.target.value)}
                            />
                            <div className="mt-2 flex flex-wrap gap-1">
                                {GA_METRIC_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                            const existing = gaMetrics.split(',').map((item) => item.trim()).filter(Boolean);
                                            if (!existing.includes(preset)) {
                                                setGaMetrics([...existing, preset].join(','));
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                                    >
                                        {preset}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-1 text-[10px] text-neutral-400">Comma-separated GA4 metric names.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Date range</label>
                            <select
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                value={gaDatePreset}
                                onChange={e => setGaDatePreset(e.target.value as '7d' | '14d' | '28d' | '90d' | 'custom')}
                            >
                                <option value="7d">Last 7 days</option>
                                <option value="14d">Last 14 days</option>
                                <option value="28d">Last 28 days</option>
                                <option value="90d">Last 90 days</option>
                                <option value="custom">Custom</option>
                            </select>
                            {gaDatePreset === 'custom' && (
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">Start date</label>
                                        <input
                                            type="date"
                                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                            value={gaStartDate}
                                            onChange={e => setGaStartDate(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1.5">End date</label>
                                        <input
                                            type="date"
                                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                            value={gaEndDate}
                                            onChange={e => setGaEndDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">Order by</label>
                            <div className="grid grid-cols-3 gap-3">
                                <input
                                    type="text"
                                    className="col-span-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    placeholder="dimension or metric name"
                                    value={gaOrderByField}
                                    onChange={e => setGaOrderByField(e.target.value)}
                                />
                                <select
                                    className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    value={gaOrderByType}
                                    onChange={e => setGaOrderByType(e.target.value as 'dimension' | 'metric')}
                                >
                                    <option value="dimension">Dimension</option>
                                    <option value="metric">Metric</option>
                                </select>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                                <input
                                    type="checkbox"
                                    checked={gaOrderByDesc}
                                    onChange={e => setGaOrderByDesc(e.target.checked)}
                                    className="rounded text-teal-600 focus:ring-teal-500"
                                />
                                Descending
                            </label>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Dimension filter (JSON)</label>
                                <textarea
                                    rows={2}
                                    className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    placeholder='{"filter": {"fieldName": "country", "stringFilter": {"value": "United States"}}}'
                                    value={gaDimensionFilter}
                                    onChange={e => setGaDimensionFilter(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Metric filter (JSON)</label>
                                <textarea
                                    rows={2}
                                    className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                                    placeholder='{"filter": {"fieldName": "activeUsers", "numericFilter": {"operation": "GREATER_THAN", "value": {"int64Value": "100"}}}}'
                                    value={gaMetricFilter}
                                    onChange={e => setGaMetricFilter(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            );
        case 'csv-url':
            return (
                <div className="space-y-4 animate-scale-in">
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">CSV URL</label>
                        <input 
                            type="text" 
                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            placeholder="https://example.com/data.csv"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                        />
                    </div>
                </div>
            );
        default:
            return <div className="h-32 flex items-center justify-center text-sm text-neutral-400 italic">Select a source from the left to configure.</div>;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white dark:bg-neutral-850 rounded-xl shadow-2xl w-full max-w-2xl border border-neutral-200 dark:border-neutral-700 relative z-10 flex overflow-hidden h-[500px]">
        
        {/* Sidebar */}
        <div className="w-1/3 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-700 flex flex-col">
            <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center gap-2">
                <Database size={18} className="text-teal-600 dark:text-teal-400" />
                <h3 className="font-semibold text-neutral-800 dark:text-neutral-100">Connect Data</h3>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto flex-1">
	                <button 
	                    onClick={() => handleSelectType('google-sheets')}
	                    className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors ${selectedType === 'google-sheets' ? 'bg-white dark:bg-neutral-800 shadow-sm text-teal-600 dark:text-teal-400' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
	                >
	                    <div className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">
	                        <FileSpreadsheet size={16} />
                    </div>
                    <div>
                        <div className="text-sm font-medium">Google Sheets</div>
                        <div className="text-[10px] opacity-70">Import cells & ranges</div>
                    </div>
                </button>
	                <button 
	                    onClick={() => handleSelectType('google-analytics')}
	                    className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors ${selectedType === 'google-analytics' ? 'bg-white dark:bg-neutral-800 shadow-sm text-teal-600 dark:text-teal-400' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
	                >
	                     <div className="p-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded">
	                        <BarChart2 size={16} />
                    </div>
                    <div>
                        <div className="text-sm font-medium">Google Analytics</div>
                        <div className="text-[10px] opacity-70">Import GA4 reports</div>
                    </div>
                </button>
	                <button 
	                    onClick={() => handleSelectType('csv-url')}
	                    className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors ${selectedType === 'csv-url' ? 'bg-white dark:bg-neutral-800 shadow-sm text-teal-600 dark:text-teal-400' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
	                >
	                     <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
	                        <Globe size={16} />
                    </div>
                    <div>
                        <div className="text-sm font-medium">CSV from URL</div>
                        <div className="text-[10px] opacity-70">Live CSV feed</div>
	                    </div>
	                </button>
	                <button 
	                    onClick={() => handleSelectType('clickhouse')}
	                    className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors ${selectedType === 'clickhouse' ? 'bg-white dark:bg-neutral-800 shadow-sm text-teal-600 dark:text-teal-400' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
	                >
	                     <div className="p-1.5 bg-neutral-100 dark:bg-neutral-900/30 text-neutral-700 dark:text-neutral-200 rounded">
	                        <Database size={16} />
	                    </div>
	                    <div>
	                        <div className="text-sm font-medium">ClickHouse</div>
	                        <div className="text-[10px] opacity-70">Connected sheet via backend proxy</div>
	                    </div>
	                </button>
	            </div>
	            <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-100/50 dark:bg-neutral-900/50">
	                {selectedType === 'clickhouse' ? (
	                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
	                        <Code2 size={14} />
	                        Uses backend proxy; configure `VITE_BACKEND_URL` and optional `VITE_API_BEARER_TOKEN`.
	                    </div>
	                ) : (
	                     <>
	                         <div className="flex items-center gap-2">
	                             <input 
	                                type="checkbox" 
	                                id="sim-mode"
	                                checked={simulate}
	                                onChange={e => setSimulate(e.target.checked)}
	                                className="rounded text-teal-600 focus:ring-teal-500"
	                             />
	                             <label htmlFor="sim-mode" className="text-xs text-neutral-500 cursor-pointer select-none">
	                                 Simulate API (Demo Mode)
	                             </label>
	                         </div>
	                         <p className="text-[10px] text-neutral-400 mt-1 leading-tight">
	                             Uncheck to use real API endpoints (requires configured API keys/OAuth in environment).
	                         </p>
	                     </>
	                )}
	            </div>
	        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col relative">
            <button onClick={onClose} className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
                <X size={20} />
            </button>
            
	            <div className="p-6 border-b border-neutral-200 dark:border-neutral-700">
	                <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
	                    {selectedType === 'google-sheets' ? 'Configure Google Sheets' : 
	                     selectedType === 'google-analytics' ? 'Configure Analytics' :
	                     selectedType === 'csv-url' ? 'Configure CSV Link' :
	                     selectedType === 'clickhouse' ? 'Configure ClickHouse' : 'Select Source'}
	                </h2>
	            </div>

            <div className="flex-1 p-6 overflow-y-auto">
                {renderConfigForm()}

                {status === 'error' && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm flex items-center gap-2">
                        <AlertCircle size={16} />
                        {errorMsg}
                    </div>
                )}
            </div>

            <div className="p-6 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50 flex justify-end gap-3">
                 <button 
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                >
                    Cancel
                </button>
	                <button 
	                    onClick={handleConnect}
	                    disabled={!selectedType || status === 'loading'}
	                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-all flex items-center gap-2
	                        ${!selectedType || status === 'loading' ? 'bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'}
	                    `}
	                >
	                    {status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : 
	                     status === 'success' ? <CheckCircle2 size={16} /> : null}
	                    {selectedType === 'clickhouse'
	                        ? status === 'loading'
	                            ? 'Running...'
	                            : status === 'success'
	                                ? 'Done!'
	                                : 'Run & Create Sheet'
	                        : status === 'loading'
	                            ? 'Connecting...'
	                            : status === 'success'
	                                ? 'Connected!'
	                                : 'Connect & Import'}
	                </button>
	            </div>
	        </div>

      </div>
    </div>
  );
};
