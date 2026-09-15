import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Key, Check, AlertCircle, ExternalLink, Eye, EyeOff, RefreshCw, Loader2, Cpu,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  getAISettingsApi, saveAISettingsApi, testAIApiKeyApi, getAIModelsApi,
  DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS, AIKeyErrorType, AIKeyTestResult,
} from '../../services/api';
import { AISettings } from '../../types';

const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash (Khuyên dùng)',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite (Nhanh, rẻ)',
  'gemini-2.5-pro': 'Gemini 2.5 Pro (Chính xác cao)',
};

const modelLabel = (id: string) => MODEL_LABELS[id] || id;

/** Classify a failed key test (uses backend error_type when present, else message heuristics). */
const classifyTestError = (res: AIKeyTestResult): AIKeyErrorType => {
  if (res.error_type) return res.error_type;
  const msg = (res.message || '').toLowerCase();
  if (/model/.test(msg) && /(not found|not supported|không khả dụng|không tồn tại|404)/.test(msg)) return 'model_not_found';
  if (/(quota|429|rate limit|exhausted)/.test(msg)) return 'quota';
  if (/(network|timeout|connection|kết nối)/.test(msg)) return 'network';
  if (/(api key|api_key|invalid|permission|403|401|400|không hợp lệ)/.test(msg)) return 'invalid_key';
  return 'unknown';
};

interface TestState {
  valid: boolean;
  message: string;
  kind?: AIKeyErrorType;
}

export const AISettingsCard: React.FC = () => {
  const { t, addToast } = useApp();
  const [settings, setSettings] = useState<AISettings>({
    has_key: false,
    masked_key: '',
    raw_key: '',
    gemini_model: DEFAULT_GEMINI_MODEL,
    ocr_engine: 'auto',
  });
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [engine, setEngine] = useState('auto');
  const [models, setModels] = useState<string[]>(FALLBACK_GEMINI_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestState | null>(null);

  const loadModels = useCallback(async (apiKey?: string) => {
    setModelsLoading(true);
    const list = await getAIModelsApi(apiKey);
    setModels(list);
    setModelsLoading(false);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAISettingsApi();
      setSettings(data);
      if (data.raw_key) {
        setInputKey(data.raw_key);
      }
      setModel(data.gemini_model || DEFAULT_GEMINI_MODEL);
      if (data.ocr_engine) {
        setEngine(data.ocr_engine);
      }
    } catch (e: any) {
      console.error('Error loading AI settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadModels();
  }, [loadSettings, loadModels]);

  const handleSave = async () => {
    try {
      setLoading(true);
      await saveAISettingsApi({
        gemini_api_key: inputKey.trim(),
        gemini_model: model,
        ocr_engine: engine,
      });
      addToast(t.common.success, 'success');
      await loadSettings();
    } catch (e: any) {
      addToast(e?.response?.data?.detail || e.message || t.common.error, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTestKey = async () => {
    const keyToTest = inputKey.trim() || settings.raw_key || '';
    if (!keyToTest) {
      addToast(t.booking.aiSettings.apiKeyPlaceholder, 'error');
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      const res = await testAIApiKeyApi(keyToTest, model);
      if (res.valid) {
        setTestResult({ valid: true, message: res.message || t.booking.aiSettings.keyValid });
        addToast(t.booking.aiSettings.keyValid, 'success');
        // A valid key can list the models actually available to it
        loadModels(keyToTest);
      } else {
        const kind = classifyTestError(res);
        const title =
          kind === 'model_not_found' ? t.common.aiModelUnavailableTitle
          : kind === 'invalid_key' ? t.common.aiKeyInvalidTitle
          : kind === 'quota' ? t.common.aiQuotaTitle
          : kind === 'network' ? t.common.aiNetworkTitle
          : t.booking.aiSettings.keyInvalid;
        setTestResult({ valid: false, message: res.message || title, kind });
        addToast(title, 'error');
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const message = (typeof detail === 'string' && detail) || e.message || 'Connection failed';
      setTestResult({ valid: false, message, kind: 'network' });
      addToast(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const modelOptions = models.includes(model) ? models : [model, ...models];

  const failTitle = testResult && !testResult.valid
    ? testResult.kind === 'model_not_found' ? t.common.aiModelUnavailableTitle
      : testResult.kind === 'invalid_key' ? t.common.aiKeyInvalidTitle
      : testResult.kind === 'quota' ? t.common.aiQuotaTitle
      : testResult.kind === 'network' ? t.common.aiNetworkTitle
      : t.booking.aiSettings.keyInvalid
    : '';
  const failHint = testResult && !testResult.valid
    ? testResult.kind === 'model_not_found' ? t.common.aiModelUnavailableHint
      : testResult.kind === 'invalid_key' ? t.common.aiKeyInvalidHint
      : ''
    : '';

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-3.5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-tr from-purple-500 to-indigo-500 text-white rounded-xl shadow-sm">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {t.booking.aiSettings.title}
            </h4>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/80">
              Gemini Vision
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.booking.aiSettings.subtitle}
          </p>
        </div>
      </div>

      {/* API Key Input */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-purple-500" />
            <span>{t.booking.aiSettings.apiKeyLabel}</span>
          </label>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (window.electronAPI?.openExternal) {
                e.preventDefault();
                window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
              }
            }}
            className="text-[11px] font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400 flex items-center gap-1 hover:underline"
          >
            <span>{t.booking.aiSettings.getKeyLink}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="relative flex items-center">
          <input
            type={showKey ? 'text' : 'password'}
            value={inputKey}
            onChange={(e) => {
              setInputKey(e.target.value);
              setTestResult(null);
            }}
            placeholder={settings.has_key ? `Đã lưu: ${settings.masked_key}` : t.booking.aiSettings.apiKeyPlaceholder}
            className="w-full pl-3 pr-20 py-2 text-xs font-mono bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Engine & Model Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            {t.booking.aiSettings.engineLabel}
          </label>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="w-full text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-xl px-2.5 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
          >
            <option value="auto">{t.booking.aiSettings.engineAuto}</option>
            <option value="ai">{t.booking.aiSettings.engineAI}</option>
            <option value="local">{t.booking.aiSettings.engineLocal}</option>
          </select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {t.booking.aiSettings.modelLabel}
            </label>
            <button
              type="button"
              onClick={() => loadModels(inputKey.trim() || undefined)}
              disabled={modelsLoading}
              title={t.common.aiRefreshModels}
              aria-label={t.common.aiRefreshModels}
              className="p-0.5 rounded text-slate-400 hover:text-purple-600 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${modelsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setTestResult(null);
            }}
            disabled={modelsLoading}
            className="w-full text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-xl px-2.5 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-none disabled:opacity-60"
          >
            {modelsLoading && !models.length ? (
              <option value={model}>{t.common.aiModelsLoading}</option>
            ) : (
              modelOptions.map((m) => (
                <option key={m} value={m}>
                  {modelLabel(m)}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Test feedback */}
      {testResult && (
        <div
          className={`p-2.5 rounded-xl text-xs flex items-start gap-2 ${
            testResult.valid
              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : testResult.kind === 'model_not_found' || testResult.kind === 'quota'
              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
          }`}
        >
          {testResult.valid ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            {!testResult.valid && <p className="font-bold">{failTitle}</p>}
            <p className="font-medium break-words">{testResult.message}</p>
            {failHint && <p className="mt-0.5 opacity-80">{failHint}</p>}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={testing || (!inputKey && !settings.has_key)}
          onClick={handleTestKey}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40"
        >
          {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {testing ? t.common.aiKeyChecking : t.booking.aiSettings.testKey}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={handleSave}
          className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white transition-colors shadow-sm flex items-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t.booking.aiSettings.saveSettings}</span>
        </button>
      </div>
    </div>
  );
};
