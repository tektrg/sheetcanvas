import React, { useEffect, useMemo, useState } from 'react';
import type { ConnectorConfig, GoogleAnalyticsReport } from '../types';
import {
  buildConnectorConfigWithQuery,
  readConnectorQuery,
  type NormalizedConnectorQuery,
  validateConnectorQuery,
} from '../utils/connectedSheetQueries';
import { DEFAULT_GOOGLE_SHEETS_RANGE } from '../utils/googleSheetsBackend';

interface ConnectedSheetQueryPanelProps {
  config: ConnectorConfig;
  isBusy?: boolean;
  onCancel: () => void;
  onSave: (config: ConnectorConfig) => void;
  onSaveAndRefresh: (query: NormalizedConnectorQuery) => Promise<void> | void;
}

const parseList = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const stringifyJsonField = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

const parseOptionalJson = (label: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined };
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { error: `${label} must be valid JSON` };
  }
};

export const ConnectedSheetQueryPanel: React.FC<ConnectedSheetQueryPanelProps> = ({
  config,
  isBusy = false,
  onCancel,
  onSave,
  onSaveAndRefresh,
}) => {
  const normalizedQuery = useMemo(() => readConnectorQuery(config), [config]);

  const [sql, setSql] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [metrics, setMetrics] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dimensionFilterJson, setDimensionFilterJson] = useState('');
  const [metricFilterJson, setMetricFilterJson] = useState('');
  const [orderBysJson, setOrderBysJson] = useState('');
  const [limit, setLimit] = useState('');
  const [spreadsheetIdOrUrl, setSpreadsheetIdOrUrl] = useState('');
  const [range, setRange] = useState(DEFAULT_GOOGLE_SHEETS_RANGE);
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    setValidationMessage('');
    if (!normalizedQuery) return;

    if (normalizedQuery.type === 'clickhouse') {
      setSql(normalizedQuery.sql);
    }

    if (normalizedQuery.type === 'google-analytics') {
      const report = normalizedQuery.report;
      const firstDateRange = report.dateRanges?.[0];
      setPropertyId(normalizedQuery.propertyId);
      setDimensions(report.dimensions?.map(item => item.name).join(',') ?? '');
      setMetrics(report.metrics?.map(item => item.name).join(',') ?? '');
      setStartDate(firstDateRange?.startDate ?? '');
      setEndDate(firstDateRange?.endDate ?? '');
      setDimensionFilterJson(stringifyJsonField(report.dimensionFilter));
      setMetricFilterJson(stringifyJsonField(report.metricFilter));
      setOrderBysJson(stringifyJsonField(report.orderBys));
      setLimit(report.limit ? String(report.limit) : '');
    }

    if (normalizedQuery.type === 'google-sheets') {
      setSpreadsheetIdOrUrl(normalizedQuery.spreadsheetIdOrUrl);
      setRange(normalizedQuery.range || DEFAULT_GOOGLE_SHEETS_RANGE);
    }
  }, [normalizedQuery]);

  const buildQuery = (): NormalizedConnectorQuery | null => {
    if (!normalizedQuery) return null;

    if (normalizedQuery.type === 'clickhouse') {
      return { type: 'clickhouse', sql: sql.trim() };
    }

    if (normalizedQuery.type === 'google-sheets') {
      return {
        type: 'google-sheets',
        spreadsheetIdOrUrl: spreadsheetIdOrUrl.trim(),
        range: range.trim() || DEFAULT_GOOGLE_SHEETS_RANGE,
      };
    }

    const dimensionFilter = parseOptionalJson('Dimension filter', dimensionFilterJson);
    if (dimensionFilter.error) {
      setValidationMessage(dimensionFilter.error);
      return null;
    }

    const metricFilter = parseOptionalJson('Metric filter', metricFilterJson);
    if (metricFilter.error) {
      setValidationMessage(metricFilter.error);
      return null;
    }

    const orderBys = parseOptionalJson('Order by', orderBysJson);
    if (orderBys.error) {
      setValidationMessage(orderBys.error);
      return null;
    }

    const parsedLimit = limit.trim() ? Number(limit.trim()) : undefined;
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
      setValidationMessage('Limit must be a positive whole number');
      return null;
    }

    const report: GoogleAnalyticsReport = {};
    const dimensionNames = parseList(dimensions);
    const metricNames = parseList(metrics);
    if (dimensionNames.length > 0) report.dimensions = dimensionNames.map(name => ({ name }));
    if (metricNames.length > 0) report.metrics = metricNames.map(name => ({ name }));
    if (startDate.trim() || endDate.trim()) {
      if (!startDate.trim() || !endDate.trim()) {
        setValidationMessage('Start date and end date are both required when setting a date range');
        return null;
      }
      report.dateRanges = [{ startDate: startDate.trim(), endDate: endDate.trim() }];
    }
    if (dimensionFilter.value !== undefined) report.dimensionFilter = dimensionFilter.value;
    if (metricFilter.value !== undefined) report.metricFilter = metricFilter.value;
    if (orderBys.value !== undefined) {
      if (!Array.isArray(orderBys.value)) {
        setValidationMessage('Order by must be a JSON array');
        return null;
      }
      report.orderBys = orderBys.value;
    }
    if (parsedLimit !== undefined) report.limit = parsedLimit;

    return { type: 'google-analytics', propertyId: propertyId.trim(), report };
  };

  const handleSave = () => {
    const query = buildQuery();
    if (!query) return;
    const validationError = validateConnectorQuery(config, query);
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }
    setValidationMessage('');
    onSave(buildConnectorConfigWithQuery(config, query));
  };

  const handleSaveAndRefresh = async () => {
    const query = buildQuery();
    if (!query) return;
    const validationError = validateConnectorQuery(config, query);
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }
    setValidationMessage('');
    await onSaveAndRefresh(query);
  };

  if (!normalizedQuery) return null;

  return (
    <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Query
        </div>
        {validationMessage && (
          <div className="min-w-0 flex-1 truncate text-right text-[11px] font-medium text-red-600 dark:text-red-400" title={validationMessage}>
            {validationMessage}
          </div>
        )}
      </div>

      {normalizedQuery.type === 'clickhouse' && (
        <textarea
          className="w-full min-h-[120px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          placeholder="SELECT ..."
        />
      )}

      {normalizedQuery.type === 'google-sheets' && (
        <div className="grid grid-cols-1 gap-3">
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            Spreadsheet URL or ID
            <input
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              value={spreadsheetIdOrUrl}
              onChange={(event) => setSpreadsheetIdOrUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/... or spreadsheet ID"
            />
          </label>
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            A1 Range
            <input
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              placeholder={DEFAULT_GOOGLE_SHEETS_RANGE}
            />
          </label>
        </div>
      )}

      {normalizedQuery.type === 'google-analytics' && (
        <div className="grid grid-cols-1 gap-3">
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            Property ID
            <input
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              placeholder="342555123"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Dimensions
              <input
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={dimensions}
                onChange={(event) => setDimensions(event.target.value)}
                placeholder="date,sessionSource"
              />
            </label>
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Metrics
              <input
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={metrics}
                onChange={(event) => setMetrics(event.target.value)}
                placeholder="activeUsers,sessions"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Start Date
              <input
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                placeholder="28daysAgo"
              />
            </label>
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              End Date
              <input
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                placeholder="today"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Dimension Filter JSON
              <textarea
                rows={2}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={dimensionFilterJson}
                onChange={(event) => setDimensionFilterJson(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Metric Filter JSON
              <textarea
                rows={2}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={metricFilterJson}
                onChange={(event) => setMetricFilterJson(event.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Order By JSON
              <textarea
                rows={2}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={orderBysJson}
                onChange={(event) => setOrderBysJson(event.target.value)}
                placeholder='[{"metric":{"metricName":"activeUsers"},"desc":true}]'
              />
            </label>
            <label className="grid gap-1.5 text-[10px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              Limit
              <input
                type="number"
                min={1}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm normal-case font-normal text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={isBusy}
          className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isBusy}
          className="px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-60"
        >
          Save
        </button>
        <button
          onClick={handleSaveAndRefresh}
          disabled={isBusy}
          className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-60"
        >
          {isBusy ? 'Refreshing...' : 'Save & Refresh'}
        </button>
      </div>
    </div>
  );
};
