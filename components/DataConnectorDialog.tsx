
import React, { useState } from 'react';
import { ConnectorConfig, ConnectorType } from '../types';
import { X, Database, FileSpreadsheet, BarChart2, Globe, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchDataFromConnector } from '../utils/dataConnectors';

interface DataConnectorDialogProps {
  onClose: () => void;
  onImport: (title: string, data: string[][], config: ConnectorConfig) => void;
  initialType?: ConnectorType;
}

export const DataConnectorDialog: React.FC<DataConnectorDialogProps> = ({ onClose, onImport, initialType }) => {
  const [selectedType, setSelectedType] = useState<ConnectorType | null>(initialType || null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Form States
  const [sheetId, setSheetId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [url, setUrl] = useState('');
  const [simulate, setSimulate] = useState(true);

  const handleConnect = async () => {
    if (!selectedType) return;
    
    setStatus('loading');
    setErrorMsg('');

    const config: ConnectorConfig = {
        type: selectedType,
        name: 'Import',
        params: {
            simulate
        }
    };

    if (selectedType === 'google-sheets') config.params.sheetId = sheetId;
    if (selectedType === 'google-analytics') config.params.propertyId = propertyId;
    if (selectedType === 'csv-url') config.params.url = url;

    try {
        const result = await fetchDataFromConnector(config);
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
        case 'google-sheets':
            return (
                <div className="space-y-4 animate-scale-in">
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">Google Sheet ID</label>
                        <input 
                            type="text" 
                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBkJ..."
                            value={sheetId}
                            onChange={e => setSheetId(e.target.value)}
                        />
                        <p className="mt-1 text-[10px] text-neutral-400">Found in the URL of your spreadsheet.</p>
                    </div>
                </div>
            );
        case 'google-analytics':
            return (
                <div className="space-y-4 animate-scale-in">
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase">GA4 Property ID</label>
                        <input 
                            type="text" 
                            className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            placeholder="e.g. 342555123"
                            value={propertyId}
                            onChange={e => setPropertyId(e.target.value)}
                        />
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                    onClick={() => setSelectedType('google-sheets')}
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
                    onClick={() => setSelectedType('google-analytics')}
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
                    onClick={() => setSelectedType('csv-url')}
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
            </div>
            <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-100/50 dark:bg-neutral-900/50">
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
                     selectedType === 'csv-url' ? 'Configure CSV Link' : 'Select Source'}
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
                    {status === 'loading' ? 'Connecting...' : status === 'success' ? 'Connected!' : 'Connect & Import'}
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};
