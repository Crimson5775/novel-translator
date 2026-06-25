import React, { useState, useEffect } from 'react';
import Library from './components/Library';
import GlossaryManager from './components/GlossaryManager';
import Settings from './components/Settings';
import TranslatorWorkspace from './components/TranslatorWorkspace';
import { Library as LibIcon, Book, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { initDB } from './db/db';

export default function App() {
  const [tab, setTab] = useState('library'); // 'library', 'glossary', 'settings', 'workspace'
  const [selectedNovelId, setSelectedNovelId] = useState(null);
  
  // Settings state to sync navbar indicators
  const [settings, setSettings] = useState({
    geminiApiKey: '',
    googleApiKey: '',
    openRouterApiKey: '',
    openRouterApiKeys: [],
    defaultSourceLanguage: 'zh',
    defaultTargetLanguage: 'en',
    geminiModel: 'gemini-2.5-flash',
    openRouterModel: 'google/gemini-2.5-flash'
  });

  useEffect(() => {
    // Initialize IndexedDB
    initDB().catch(err => {
      console.error('Failed to initialize database:', err);
      alert('Failed to initialize browser database. Please check your storage settings.');
    });

    // Load settings
    const saved = localStorage.getItem('aura_settings');
    let config = {
      geminiApiKey: '',
      googleApiKey: '',
      openRouterApiKey: '',
      openRouterApiKeys: [],
      defaultSourceLanguage: 'zh',
      defaultTargetLanguage: 'en',
      geminiModel: 'gemini-2.5-flash',
      openRouterModel: 'google/gemini-2.5-flash'
    };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        config = { ...config, ...parsed };
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    localStorage.setItem('aura_settings', JSON.stringify(config));
    setSettings(config);
  }, []);

  const handleSettingsSave = (newSettings) => {
    setSettings(newSettings);
  };

  const activeKeysCount = [settings.geminiApiKey, settings.googleApiKey, settings.openRouterApiKey].filter(Boolean).length;

  return (
    <div className="app-container">
      {/* Visual background gradients */}
      <div className="bg-glow"></div>
      <div className="bg-glow-2"></div>

      {/* Hide navbar on workspace mode for fullscreen focus */}
      {tab !== 'workspace' && (
        <header className="navbar">
          <div className="brand" onClick={() => setTab('library')} style={{ cursor: 'pointer' }}>
            <div className="brand-icon">
              <Sparkles size={18} />
            </div>
            <span>AURA</span>
          </div>

          <nav className="nav-links">
            <button
              className={`nav-link ${tab === 'library' ? 'active' : ''}`}
              onClick={() => setTab('library')}
            >
              <LibIcon size={16} /> Library
            </button>
            <button
              className={`nav-link ${tab === 'glossary' ? 'active' : ''}`}
              onClick={() => setTab('glossary')}
            >
              <Book size={16} /> Glossary
            </button>
            <button
              className={`nav-link ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => setTab('settings')}
            >
              <SettingsIcon size={16} /> Settings
              {activeKeysCount === 0 && (
                <span 
                  style={{
                    width: '6px',
                    height: '6px',
                    backgroundColor: 'var(--danger)',
                    borderRadius: '50%',
                    display: 'inline-block',
                    marginLeft: '2px',
                    boxShadow: '0 0 6px var(--danger)'
                  }}
                  title="API Keys missing"
                ></span>
              )}
            </button>
          </nav>
        </header>
      )}

      {/* Active Component Router */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {tab === 'library' && (
          <Library
            onSelectNovel={(id) => {
              setSelectedNovelId(id);
              setTab('workspace');
            }}
          />
        )}
        {tab === 'glossary' && <GlossaryManager />}
        {tab === 'settings' && (
          <Settings onSaveSettings={handleSettingsSave} />
        )}
        {tab === 'workspace' && (
          <TranslatorWorkspace
            novelId={selectedNovelId}
            onBack={() => setTab('library')}
          />
        )}
      </main>
    </div>
  );
}
