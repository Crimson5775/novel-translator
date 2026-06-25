import React, { useState, useEffect } from 'react';
import { Save, Key, Shield, Globe, CheckCircle, AlertTriangle, Loader, Trash2, Play, Sparkles } from 'lucide-react';
import { translateWithGemini, translateWithGoogle, translateWithOpenRouter } from '../services/translation';

export const LANGUAGES = [
  { name: 'English', code: 'en' },
  { name: 'Chinese (Simplified)', code: 'zh' },
  { name: 'Japanese', code: 'ja' },
  { name: 'Korean', code: 'ko' },
  { name: 'Spanish', code: 'es' },
  { name: 'French', code: 'fr' },
  { name: 'German', code: 'de' },
  { name: 'Russian', code: 'ru' },
  { name: 'Arabic', code: 'ar' }
];

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Recommended - Fast & Cheap)' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (High Quality - Slower)' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
];

export const OPENROUTER_MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Very Cheap & High Quality)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'custom', name: 'Custom Model (Specify below)' }
];

export default function Settings({ onSaveSettings }) {
  const [settings, setSettings] = useState({
    geminiApiKey: '',
    geminiApiKeys: [],
    googleApiKey: '',
    openRouterApiKey: '',
    openRouterApiKeys: [],
    defaultSourceLanguage: 'zh',
    defaultTargetLanguage: 'en',
    geminiModel: 'gemini-2.5-flash',
    openRouterModel: 'google/gemini-2.5-flash'
  });
  
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newOpenRouterKeyInput, setNewOpenRouterKeyInput] = useState('');
  const [savedStatus, setSavedStatus] = useState(false);
  const [keyTestStatuses, setKeyTestStatuses] = useState({}); // { [keyIndex]: { state, message } }
  const [openRouterKeyTestStatuses, setOpenRouterKeyTestStatuses] = useState({}); // { [keyIndex]: { state, message } }
  
  const [testingStatus, setTestingStatus] = useState({
    gemini: { state: 'idle', message: '' }, // 'idle', 'loading', 'success', 'error'
    google: { state: 'idle', message: '' },
    openrouter: { state: 'idle', message: '' }
  });

  useEffect(() => {
    const saved = localStorage.getItem('aura_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const keys = parsed.geminiApiKeys || (parsed.geminiApiKey ? [parsed.geminiApiKey] : []);
        const orKeys = parsed.openRouterApiKeys || (parsed.openRouterApiKey ? [parsed.openRouterApiKey] : []);
        setSettings(prev => ({ 
          ...prev, 
          ...parsed,
          geminiApiKeys: keys,
          openRouterApiKeys: orKeys
        }));
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    const primaryKey = settings.geminiApiKeys && settings.geminiApiKeys.length > 0 ? settings.geminiApiKeys[0] : '';
    const primaryOrKey = settings.openRouterApiKeys && settings.openRouterApiKeys.length > 0 ? settings.openRouterApiKeys[0] : '';
    const updatedSettings = {
      ...settings,
      geminiApiKey: primaryKey,
      openRouterApiKey: primaryOrKey
    };
    localStorage.setItem('aura_settings', JSON.stringify(updatedSettings));
    setSavedStatus(true);
    if (onSaveSettings) {
      onSaveSettings(updatedSettings);
    }
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const testApiKey = async (type, keyToTest = null) => {
    const key = keyToTest || (type === 'gemini' ? settings.geminiApiKey : type === 'google' ? settings.googleApiKey : settings.openRouterApiKey);
    if (!key) {
      setTestingStatus(prev => ({ ...prev, [type]: { state: 'error', message: 'API Key is empty!' } }));
      return;
    }

    setTestingStatus(prev => ({ ...prev, [type]: { state: 'loading', message: 'Testing connection...' } }));
    
    try {
      if (type === 'gemini') {
        // Test Gemini with a simple prompt
        await translateWithGemini(
          ['Test connection. Respond with only the word OK.'],
          key,
          settings.geminiModel,
          'English',
          'English',
          []
        );
      } else if (type === 'openrouter') {
        // Test OpenRouter with a simple prompt
        await translateWithOpenRouter(
          ['Test connection. Respond with only the word OK.'],
          key,
          settings.openRouterModel || 'google/gemini-2.5-flash',
          'English',
          'English',
          []
        );
      } else {
        // Test Google Translate with a simple word
        await translateWithGoogle(
          ['Hello'],
          key,
          'en',
          'es',
          []
        );
      }
      setTestingStatus(prev => ({ ...prev, [type]: { state: 'success', message: 'API Key is working correctly!' } }));
    } catch (err) {
      console.error(`API Key test error (${type}):`, err);
      // Clean up error message if it's too long
      let errMsg = err.message || 'Verification failed.';
      if (errMsg.includes('API_KEY_INVALID') || errMsg.toLowerCase().includes('invalid')) {
        errMsg = 'Invalid API Key. Please check the key and try again.';
      } else if (errMsg.includes('quota') || errMsg.includes('429')) {
        errMsg = 'API Key is valid but quota is exceeded.';
      }
      setTestingStatus(prev => ({ ...prev, [type]: { state: 'error', message: errMsg } }));
    }
  };

  const testSpecificKey = async (idx, key) => {
    setKeyTestStatuses(prev => ({
      ...prev,
      [idx]: { state: 'loading', message: 'Testing...' }
    }));

    try {
      await translateWithGemini(
        ['Test connection. Respond with only the word OK.'],
        key,
        settings.geminiModel,
        'English',
        'English',
        []
      );

      setKeyTestStatuses(prev => ({
        ...prev,
        [idx]: { state: 'success', message: 'Working!' }
      }));
    } catch (err) {
      console.error(`API Key test error (key #${idx + 1}):`, err);
      let errMsg = err.message || 'Verification failed.';
      if (errMsg.includes('API_KEY_INVALID')) {
        errMsg = 'Invalid Key';
      } else if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.toLowerCase().includes('limit')) {
        errMsg = 'Quota Exceeded';
      } else {
        errMsg = 'Failed';
      }
      setKeyTestStatuses(prev => ({
        ...prev,
        [idx]: { state: 'error', message: errMsg }
      }));
    }
  };

  const testAllKeys = async () => {
    if (!settings.geminiApiKeys || settings.geminiApiKeys.length === 0) return;
    for (let i = 0; i < settings.geminiApiKeys.length; i++) {
      await testSpecificKey(i, settings.geminiApiKeys[i]);
    }
  };

  const testSpecificOpenRouterKey = async (idx, key) => {
    setOpenRouterKeyTestStatuses(prev => ({
      ...prev,
      [idx]: { state: 'loading', message: 'Testing...' }
    }));

    try {
      await translateWithOpenRouter(
        ['Test connection. Respond with only the word OK.'],
        key,
        settings.openRouterModel || 'google/gemini-2.5-flash',
        'English',
        'English',
        []
      );

      setOpenRouterKeyTestStatuses(prev => ({
        ...prev,
        [idx]: { state: 'success', message: 'Working!' }
      }));
    } catch (err) {
      console.error(`OpenRouter API Key test error (key #${idx + 1}):`, err);
      let errMsg = err.message || 'Verification failed.';
      if (errMsg.includes('API_KEY_INVALID') || errMsg.toLowerCase().includes('invalid')) {
        errMsg = 'Invalid Key';
      } else if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.toLowerCase().includes('limit')) {
        errMsg = 'Quota Exceeded';
      } else {
        errMsg = 'Failed';
      }
      setOpenRouterKeyTestStatuses(prev => ({
        ...prev,
        [idx]: { state: 'error', message: errMsg }
      }));
    }
  };

  const testAllOpenRouterKeys = async () => {
    if (!settings.openRouterApiKeys || settings.openRouterApiKeys.length === 0) return;
    for (let i = 0; i < settings.openRouterApiKeys.length; i++) {
      await testSpecificOpenRouterKey(i, settings.openRouterApiKeys[i]);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Configuration Settings</h1>
      </div>

      <div className="settings-grid">
        <div className="settings-section">
          {/* API Keys Card */}
          <div className="card api-card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)' }}>
              <Key size={20} className="color-primary" /> API Authentication Keys
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Enter your official API keys. These are saved locally in your browser's local storage and are sent only to official API endpoints.
            </p>

            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              color: 'var(--text-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              marginTop: '0.5rem'
            }}>
              <div style={{ fontWeight: 600, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Sparkles size={14} /> Active Development Notice
              </div>
              <p style={{ margin: 0 }}>
                AURA is under active development. You can support the project by sending free Gemini API keys (from Google AI Studio) or other keys to:
                <a href="mailto:illman7887@proton.me" style={{ color: 'var(--accent-color)', fontWeight: '600', marginLeft: '0.25rem', textDecoration: 'none' }}>
                  illman7887@proton.me
                </a>
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="label" style={{ marginBottom: 0 }}>Google Gemini API Keys</label>
                  {settings.geminiApiKeys && settings.geminiApiKeys.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={testAllKeys}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', border: '1px solid var(--border-color)' }}
                    >
                      Test All Keys
                    </button>
                  )}
                </div>
                
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Add one or more keys. The translation runner will rotate keys if one hits a quota limit.
                </p>

                {/* List of keys */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {settings.geminiApiKeys && settings.geminiApiKeys.map((key, idx) => {
                    const status = keyTestStatuses[idx] || { state: 'idle', message: '' };
                    return (
                      <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <div className="input" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', height: '38px', borderRadius: '8px' }}>
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            🔑 Key #{idx + 1}: {key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : key}
                          </span>
                          
                          {/* Status Badge */}
                          {status.state === 'idle' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>Untested</span>
                          )}
                          {status.state === 'loading' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(245,158,11,0.1)', color: '#fcd34d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Loader size={10} className="spinner" style={{ animationDuration: '0.8s' }} /> Testing
                            </span>
                          )}
                          {status.state === 'success' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'var(--success-glow)', color: 'var(--success)', fontWeight: 600 }}>Working ✅</span>
                          )}
                          {status.state === 'error' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'var(--danger-glow)', color: 'var(--danger)', fontWeight: 600 }} title={status.message}>
                              {status.message} ❌
                            </span>
                          )}
                        </div>
                        
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => testSpecificKey(idx, key)}
                          disabled={status.state === 'loading'}
                          style={{ padding: '0.5rem', minWidth: '38px', height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Test this API Key"
                        >
                          <Play size={14} style={{ color: 'var(--primary-color)' }} />
                        </button>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            const updated = settings.geminiApiKeys.filter((_, i) => i !== idx);
                            setSettings(prev => ({ ...prev, geminiApiKeys: updated }));
                            const updatedStatuses = { ...keyTestStatuses };
                            delete updatedStatuses[idx];
                            setKeyTestStatuses(updatedStatuses);
                          }}
                          style={{ padding: '0.5rem', minWidth: '38px', height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Remove this API Key"
                        >
                          <Trash2 size={15} style={{ color: 'var(--danger)' }} />
                        </button>
                      </div>
                    );
                  })}
                  {(!settings.geminiApiKeys || settings.geminiApiKeys.length === 0) && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                      No Gemini API keys added yet. Add at least one key below to translate.
                    </p>
                  )}
                </div>

                {/* Add new key input */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="password"
                    id="newGeminiKey"
                    className="input"
                    placeholder="Enter Google Gemini API Key (AIzaSy...)"
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => testApiKey('gemini', newKeyInput)}
                    disabled={testingStatus.gemini.state === 'loading' || !newKeyInput.trim()}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    {testingStatus.gemini.state === 'loading' ? <Loader size={14} className="spinner" /> : 'Test Key'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (!newKeyInput.trim()) return;
                      const trimmed = newKeyInput.trim();
                      if (settings.geminiApiKeys && settings.geminiApiKeys.includes(trimmed)) {
                        alert('This API key is already in the list.');
                        return;
                      }
                      setSettings(prev => ({
                        ...prev,
                        geminiApiKeys: [...(prev.geminiApiKeys || []), trimmed]
                      }));
                      setNewKeyInput('');
                    }}
                    disabled={!newKeyInput.trim()}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    Add Key
                  </button>
                </div>
                {testingStatus.gemini.state !== 'idle' && (
                  <div style={{ 
                    marginTop: '0.4rem', 
                    fontSize: '0.85rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.25rem',
                    color: testingStatus.gemini.state === 'success' ? 'var(--success)' : testingStatus.gemini.state === 'loading' ? 'var(--text-secondary)' : 'var(--danger)'
                  }}>
                    {testingStatus.gemini.state === 'success' && <CheckCircle size={14} />}
                    {testingStatus.gemini.state === 'error' && <AlertTriangle size={14} />}
                    {testingStatus.gemini.state === 'loading' && <Loader size={14} className="spinner" style={{ animationDuration: '0.8s' }} />}
                    <span>{testingStatus.gemini.message}</span>
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="label" style={{ marginBottom: 0 }}>OpenRouter API Keys</label>
                  {settings.openRouterApiKeys && settings.openRouterApiKeys.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={testAllOpenRouterKeys}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', border: '1px solid var(--border-color)' }}
                    >
                      Test All Keys
                    </button>
                  )}
                </div>
                
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Add one or more keys. The translation runner will rotate OpenRouter keys if one hits a quota limit.
                </p>

                {/* List of OpenRouter keys */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {settings.openRouterApiKeys && settings.openRouterApiKeys.map((key, idx) => {
                    const status = openRouterKeyTestStatuses[idx] || { state: 'idle', message: '' };
                    return (
                      <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <div className="input" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', height: '38px', borderRadius: '8px' }}>
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            🔑 Key #{idx + 1}: {key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : key}
                          </span>
                          
                          {/* Status Badge */}
                          {status.state === 'idle' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>Untested</span>
                          )}
                          {status.state === 'loading' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'rgba(245,158,11,0.1)', color: '#fcd34d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Loader size={10} className="spinner" style={{ animationDuration: '0.8s' }} /> Testing
                            </span>
                          )}
                          {status.state === 'success' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'var(--success-glow)', color: 'var(--success)', fontWeight: 600 }}>Working ✅</span>
                          )}
                          {status.state === 'error' && (
                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', backgroundColor: 'var(--danger-glow)', color: 'var(--danger)', fontWeight: 600 }} title={status.message}>
                              {status.message} ❌
                            </span>
                          )}
                        </div>
                        
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => testSpecificOpenRouterKey(idx, key)}
                          disabled={status.state === 'loading'}
                          style={{ padding: '0.5rem', minWidth: '38px', height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Test this API Key"
                        >
                          <Play size={14} style={{ color: 'var(--primary-color)' }} />
                        </button>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            const updated = settings.openRouterApiKeys.filter((_, i) => i !== idx);
                            setSettings(prev => ({ ...prev, openRouterApiKeys: updated }));
                            const updatedStatuses = { ...openRouterKeyTestStatuses };
                            delete updatedStatuses[idx];
                            setOpenRouterKeyTestStatuses(updatedStatuses);
                          }}
                          style={{ padding: '0.5rem', minWidth: '38px', height: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Remove this API Key"
                        >
                          <Trash2 size={15} style={{ color: 'var(--danger)' }} />
                        </button>
                      </div>
                    );
                  })}
                  {(!settings.openRouterApiKeys || settings.openRouterApiKeys.length === 0) && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                      No OpenRouter API keys added yet. Add at least one key below to translate.
                    </p>
                  )}
                </div>

                {/* Add new key input */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="password"
                    id="newOpenRouterKey"
                    className="input"
                    placeholder="Enter OpenRouter API Key (sk-or-...)"
                    value={newOpenRouterKeyInput}
                    onChange={(e) => setNewOpenRouterKeyInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => testApiKey('openrouter', newOpenRouterKeyInput)}
                    disabled={testingStatus.openrouter.state === 'loading' || !newOpenRouterKeyInput.trim()}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    {testingStatus.openrouter.state === 'loading' ? <Loader size={14} className="spinner" /> : 'Test Key'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (!newOpenRouterKeyInput.trim()) return;
                      const trimmed = newOpenRouterKeyInput.trim();
                      if (settings.openRouterApiKeys && settings.openRouterApiKeys.includes(trimmed)) {
                        alert('This API key is already in the list.');
                        return;
                      }
                      setSettings(prev => ({
                        ...prev,
                        openRouterApiKeys: [...(prev.openRouterApiKeys || []), trimmed]
                      }));
                      setNewOpenRouterKeyInput('');
                    }}
                    disabled={!newOpenRouterKeyInput.trim()}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    Add Key
                  </button>
                </div>
                {testingStatus.openrouter.state !== 'idle' && (
                  <div style={{ 
                    marginTop: '0.4rem', 
                    fontSize: '0.85rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.25rem',
                    color: testingStatus.openrouter.state === 'success' ? 'var(--success)' : testingStatus.openrouter.state === 'loading' ? 'var(--text-secondary)' : 'var(--danger)'
                  }}>
                    {testingStatus.openrouter.state === 'success' && <CheckCircle size={14} />}
                    {testingStatus.openrouter.state === 'error' && <AlertTriangle size={14} />}
                    {testingStatus.openrouter.state === 'loading' && <Loader size={14} className="spinner" style={{ animationDuration: '0.8s' }} />}
                    <span>{testingStatus.openrouter.message}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="label" htmlFor="googleApiKey">Google Cloud Translation API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="password"
                    id="googleApiKey"
                    name="googleApiKey"
                    className="input"
                    placeholder="AIzaSy..."
                    value={settings.googleApiKey}
                    onChange={handleChange}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => testApiKey('google')}
                    disabled={testingStatus.google.state === 'loading'}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    {testingStatus.google.state === 'loading' ? <Loader size={14} className="spinner" /> : 'Test Key'}
                  </button>
                </div>
                {testingStatus.google.state !== 'idle' && (
                  <div style={{ 
                    marginTop: '0.4rem', 
                    fontSize: '0.85rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.25rem',
                    color: testingStatus.google.state === 'success' ? 'var(--success)' : testingStatus.google.state === 'loading' ? 'var(--text-secondary)' : 'var(--danger)'
                  }}>
                    {testingStatus.google.state === 'success' && <CheckCircle size={14} />}
                    {testingStatus.google.state === 'error' && <AlertTriangle size={14} />}
                    {testingStatus.google.state === 'loading' && <Loader size={14} className="spinner" style={{ animationDuration: '0.8s' }} />}
                    <span>{testingStatus.google.message}</span>
                  </div>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                  Get a key from the Google Cloud Platform console (requires billing enabled).
                </span>
              </div>
            </div>
          </div>

          {/* Model Configuration Card */}
          <div className="card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)' }}>
              <Shield size={20} className="color-primary" /> AI Translation Model Settings
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Configure default LLM models for the translation engines.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label className="label" htmlFor="geminiModel">Google Gemini Model</label>
              <select
                id="geminiModel"
                name="geminiModel"
                className="input select"
                value={settings.geminiModel}
                onChange={handleChange}
              >
                {GEMINI_MODELS.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="openRouterModel">OpenRouter Model</label>
              <select
                id="openRouterModelSelect"
                className="input select"
                value={OPENROUTER_MODELS.some(m => m.id === settings.openRouterModel) ? settings.openRouterModel : 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setSettings(prev => ({ ...prev, openRouterModel: '' }));
                  } else {
                    setSettings(prev => ({ ...prev, openRouterModel: val }));
                  }
                }}
                style={{ marginBottom: '0.5rem' }}
              >
                {OPENROUTER_MODELS.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
                {!OPENROUTER_MODELS.some(m => m.id === settings.openRouterModel) && settings.openRouterModel !== '' && (
                  <option value={settings.openRouterModel}>Custom: {settings.openRouterModel}</option>
                )}
              </select>

              {(!OPENROUTER_MODELS.some(m => m.id === settings.openRouterModel) || settings.openRouterModel === '') && (
                <input
                  type="text"
                  name="openRouterModel"
                  className="input"
                  placeholder="Enter custom OpenRouter model string (e.g. meta-llama/llama-3-8b-instruct)"
                  value={settings.openRouterModel}
                  onChange={handleChange}
                  style={{ marginTop: '0.25rem' }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Settings Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
              <Globe size={18} /> Default Languages
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label className="label" htmlFor="defaultSourceLanguage">Default Source Language</label>
                <select
                  id="defaultSourceLanguage"
                  name="defaultSourceLanguage"
                  className="input select"
                  value={settings.defaultSourceLanguage}
                  onChange={handleChange}
                >
                  <option value="auto">Detect Automatically</option>
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="defaultTargetLanguage">Default Target Language</label>
                <select
                  id="defaultTargetLanguage"
                  name="defaultTargetLanguage"
                  className="input select"
                  value={settings.defaultTargetLanguage}
                  onChange={handleChange}
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <button type="button" className="btn btn-primary" onClick={handleSave} style={{ width: '100%', padding: '0.85rem' }}>
            <Save size={18} /> {savedStatus ? 'Settings Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
