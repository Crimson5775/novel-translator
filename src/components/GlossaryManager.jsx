import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, Trash2, Search, Download, Upload, HelpCircle, Sparkles, Loader } from 'lucide-react';
import { saveGlossaryTerm, getGlossaryTerms, deleteGlossaryTerm, getNovels } from '../db/db';
import { translateWithGemini, translateWithGoogle } from '../services/translation';

export default function GlossaryManager() {
  const [terms, setTerms] = useState([]);
  const [novels, setNovels] = useState([]);
  const [filterNovelId, setFilterNovelId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  
  // Form State
  const [form, setForm] = useState({
    id: undefined,
    sourceTerm: '',
    targetTerm: '',
    scopeType: 'global', // 'global', 'single', 'custom'
    novelId: '', // single novel id
    novelIds: [], // custom selection of multiple novel ids
    caseSensitive: false,
    category: 'general', // 'general', 'character'
    gender: 'unknown' // 'male', 'female', 'unknown'
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const novelsList = await getNovels();
      setNovels(novelsList);
      
      // Load all terms (passing null gets everything from DB, which we filter locally)
      const allTerms = await getGlossaryTerms(null);
      setTerms(allTerms);
    } catch (err) {
      console.error('Failed to load glossary/novels:', err);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleAutoTranslate = async () => {
    if (!form.sourceTerm.trim()) {
      alert('Please enter a Source Term first.');
      return;
    }

    const savedSettings = localStorage.getItem('aura_settings');
    if (!savedSettings) {
      alert('API settings not found. Please configure your API keys in Settings tab.');
      return;
    }

    const settings = JSON.parse(savedSettings);
    const geminiKey = settings.geminiApiKey;
    const googleKey = settings.googleApiKey;
    
    // Choose engine based on keys
    let engineToUse = '';
    if (geminiKey) engineToUse = 'gemini';
    else if (googleKey) engineToUse = 'google';
    else {
      alert('No active API keys found. Please configure Gemini or Google Cloud API Key in the Settings tab.');
      return;
    }

    setIsAutoTranslating(true);
    try {
      let translationResult = '';
      const textToTranslate = form.sourceTerm.trim();
      
      // Get languages
      const sourceLangCode = settings.defaultSourceLanguage || 'auto';
      const targetLangCode = settings.defaultTargetLanguage || 'en';
      
      if (engineToUse === 'gemini') {
        const results = await translateWithGemini(
          [textToTranslate],
          geminiKey,
          settings.geminiModel || 'gemini-2.5-flash',
          'Detect Automatically',
          'English',
          []
        );
        translationResult = results[0];
      } else {
        const results = await translateWithGoogle(
          [textToTranslate],
          googleKey,
          sourceLangCode,
          targetLangCode,
          []
        );
        translationResult = results[0];
      }

      if (translationResult) {
        setForm(prev => ({ ...prev, targetTerm: translationResult.trim() }));
      } else {
        alert('Translation returned an empty result.');
      }
    } catch (err) {
      console.error('Failed to auto-translate glossary term:', err);
      alert('Auto-translate failed: ' + err.message);
    } finally {
      setIsAutoTranslating(false);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!form.sourceTerm.trim() || !form.targetTerm.trim()) {
      alert('Please fill in both Source Term and Target Term.');
      return;
    }

    if (form.scopeType === 'single' && !form.novelId) {
      alert('Please select a novel for Single Novel scope.');
      return;
    }

    if (form.scopeType === 'custom' && form.novelIds.length === 0) {
      alert('Please select at least one novel for Certain Novels scope.');
      return;
    }

    // Determine final values to save in database
    const finalNovelId = form.scopeType === 'single' ? form.novelId : null;
    const finalNovelIds = form.scopeType === 'custom' ? form.novelIds : [];

    try {
      const saved = await saveGlossaryTerm({
        id: form.id,
        sourceTerm: form.sourceTerm.trim(),
        targetTerm: form.targetTerm.trim(),
        novelId: finalNovelId,
        novelIds: finalNovelIds,
        caseSensitive: form.caseSensitive,
        category: form.category,
        gender: form.category === 'character' ? form.gender : 'unknown',
        description: form.category === 'character' ? `Character (Gender: ${form.gender})` : 'General Term'
      });

      // Update terms list
      if (form.id) {
        setTerms(prev => prev.map(t => t.id === saved.id ? saved : t));
      } else {
        setTerms(prev => [...prev, saved]);
      }

      // Reset form
      setForm({
        id: undefined,
        sourceTerm: '',
        targetTerm: '',
        scopeType: 'global',
        novelId: '',
        novelIds: [],
        caseSensitive: false,
        category: 'general',
        gender: 'unknown'
      });
      
      alert(form.id ? 'Term updated successfully!' : 'Term added successfully!');
    } catch (err) {
      console.error('Failed to save glossary term:', err);
      alert('Error saving glossary term: ' + err.message);
    }
  };

  const handleEditClick = (term) => {
    let scopeType = 'global';
    if (term.novelIds && term.novelIds.length > 0) {
      scopeType = 'custom';
    } else if (term.novelId) {
      scopeType = 'single';
    }

    setForm({
      id: term.id,
      sourceTerm: term.sourceTerm,
      targetTerm: term.targetTerm,
      scopeType: scopeType,
      novelId: term.novelId || '',
      novelIds: term.novelIds || [],
      caseSensitive: !!term.caseSensitive,
      category: term.category || 'general',
      gender: term.gender || 'unknown'
    });
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this glossary term?')) {
      try {
        await deleteGlossaryTerm(id);
        setTerms(prev => prev.filter(t => t.id !== id));
      } catch (err) {
        console.error('Failed to delete glossary term:', err);
        alert('Failed to delete glossary term: ' + err.message);
      }
    }
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(terms, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `aura_glossary_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!Array.isArray(importedData)) {
          throw new Error('Import file must contain an array of glossary terms.');
        }

        let importedCount = 0;
        for (const item of importedData) {
          if (item.sourceTerm && item.targetTerm) {
            await saveGlossaryTerm({
              sourceTerm: item.sourceTerm.trim(),
              targetTerm: item.targetTerm.trim(),
              novelId: item.novelId || null,
              novelIds: item.novelIds || [],
              caseSensitive: !!item.caseSensitive,
              category: item.category || 'general',
              gender: item.gender || 'unknown',
              description: item.description || (item.category === 'character' ? `Character (Gender: ${item.gender || 'unknown'})` : 'General Term')
            });
            importedCount++;
          }
        }
        
        alert(`Successfully imported ${importedCount} glossary terms!`);
        loadData();
      } catch (err) {
        console.error('Glossary import failed:', err);
        alert('Failed to import glossary terms: ' + err.message);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Filter terms based on Search and Selected Novel
  const filteredTerms = terms.filter(t => {
    const matchesSearch = 
      t.sourceTerm.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.targetTerm.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesNovel = 
      filterNovelId === 'all' || 
      (filterNovelId === 'global' && !t.novelId && (!t.novelIds || t.novelIds.length === 0)) ||
      (t.novelId === filterNovelId) ||
      (t.novelIds && t.novelIds.includes(filterNovelId));

    return matchesSearch && matchesNovel;
  });

  const getNovelTitle = (novelId) => {
    if (!novelId) return 'Global';
    const nov = novels.find(n => n.id === novelId);
    return nov ? nov.title : 'Deleted Novel';
  };

  const getTermScopeDisplay = (term) => {
    if (term.novelIds && term.novelIds.length > 0) {
      if (term.novelIds.length === 1) {
        return getNovelTitle(term.novelIds[0]);
      }
      return `${term.novelIds.length} Novels`;
    }
    return getNovelTitle(term.novelId);
  };

  const getTermScopeTooltip = (term) => {
    if (term.novelIds && term.novelIds.length > 0) {
      return term.novelIds.map(id => getNovelTitle(id)).join(', ');
    }
    return getNovelTitle(term.novelId);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Glossary Manager</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={16} /> Export JSON
          </button>
          <button className="btn btn-secondary" onClick={handleImportClick}>
            <Upload size={16} /> Import JSON
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            className="file-input-hidden"
            accept=".json"
          />
        </div>
      </div>

      <div className="glossary-layout">
        {/* Left Side: Form */}
        <div className="card term-form-card">
          <h2 style={{ marginBottom: '1.25rem', fontFamily: 'var(--font-display)', fontSize: '1.3rem' }}>
            {form.id ? 'Edit Glossary Term' : 'Add New Glossary Term'}
          </h2>
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="label" htmlFor="sourceTerm">Source Term (Original Word)</label>
              <input
                type="text"
                id="sourceTerm"
                name="sourceTerm"
                className="input"
                placeholder="e.g. Cultivator or Character Name"
                value={form.sourceTerm}
                onChange={handleInputChange}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="targetTerm">Target Term (Translated Word)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  id="targetTerm"
                  name="targetTerm"
                  className="input"
                  placeholder="e.g. Practitioner or Translated Name"
                  value={form.targetTerm}
                  onChange={handleInputChange}
                  required
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleAutoTranslate}
                  disabled={isAutoTranslating}
                  title="Auto-translate using AI API Key"
                  style={{ padding: '0.5rem 0.75rem' }}
                >
                  {isAutoTranslating ? <Loader size={16} className="spinner" /> : <Sparkles size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="scopeType">Novel Scope</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="scopeType"
                    value="global"
                    checked={form.scopeType === 'global'}
                    onChange={() => setForm(prev => ({ ...prev, scopeType: 'global' }))}
                  />
                  Global (Applies to all novels)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="scopeType"
                    value="single"
                    checked={form.scopeType === 'single'}
                    onChange={() => setForm(prev => ({ ...prev, scopeType: 'single' }))}
                  />
                  Single Novel Only
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="scopeType"
                    value="custom"
                    checked={form.scopeType === 'custom'}
                    onChange={() => setForm(prev => ({ ...prev, scopeType: 'custom' }))}
                  />
                  Certain Novels (Select multiple)
                </label>
              </div>

              {form.scopeType === 'single' && (
                <select
                  id="novelId"
                  name="novelId"
                  className="input select"
                  value={form.novelId}
                  onChange={handleInputChange}
                >
                  <option value="">Select a novel...</option>
                  {novels.map(novel => (
                    <option key={novel.id} value={novel.id}>{novel.title}</option>
                  ))}
                </select>
              )}

              {form.scopeType === 'custom' && (
                <div style={{ 
                  maxHeight: '120px', 
                  overflowY: 'auto', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-md)', 
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'var(--bg-input)'
                }}>
                  {novels.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No novels in library.</span>
                  ) : (
                    novels.map(novel => {
                      const isChecked = form.novelIds.includes(novel.id);
                      return (
                        <label key={novel.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.25rem 0', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setForm(prev => {
                                const list = prev.novelIds.includes(novel.id)
                                  ? prev.novelIds.filter(id => id !== novel.id)
                                  : [...prev.novelIds, novel.id];
                                return { ...prev, novelIds: list };
                              });
                            }}
                          />
                          {novel.title}
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="category">Category</label>
              <select
                id="category"
                name="category"
                className="input select"
                value={form.category}
                onChange={handleInputChange}
              >
                <option value="general">General Term</option>
                <option value="character">Character / Person</option>
              </select>
            </div>

            {form.category === 'character' && (
              <div>
                <label className="label" htmlFor="gender">Gender</label>
                <select
                  id="gender"
                  name="gender"
                  className="input select"
                  value={form.gender}
                  onChange={handleInputChange}
                >
                  <option value="unknown">Unknown Gender</option>
                  <option value="male">Male (♂)</option>
                  <option value="female">Female (♀)</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
              <input
                type="checkbox"
                id="caseSensitive"
                name="caseSensitive"
                checked={form.caseSensitive}
                onChange={handleInputChange}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="caseSensitive" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                Case Sensitive Match
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                <Plus size={16} /> {form.id ? 'Update Term' : 'Add Term'}
              </button>
              {form.id && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setForm({ id: undefined, sourceTerm: '', targetTerm: '', scopeType: 'global', novelId: '', novelIds: [], caseSensitive: false, category: 'general', gender: 'unknown' })}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Side: List & Filters */}
        <div className="glossary-list-container">
          <div className="table-search-bar">
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search glossary terms..."
                className="input"
                style={{ paddingLeft: '2.75rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <select
              className="input select"
              style={{ width: '220px' }}
              value={filterNovelId}
              onChange={(e) => setFilterNovelId(e.target.value)}
            >
              <option value="all">All Terms</option>
              <option value="global">Global Only</option>
              {novels.map(n => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>

          <div className="glossary-table-wrapper">
            {filteredTerms.length === 0 ? (
              <div className="empty-state">
                <HelpCircle className="empty-state-icon" />
                <p>No glossary terms found.</p>
              </div>
            ) : (
              <table className="glossary-table">
                <thead>
                  <tr>
                    <th>Source Term</th>
                    <th>Target Term</th>
                    <th>Scope</th>
                    <th>Options</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTerms.map((term) => (
                    <tr
                      key={term.id}
                      onClick={() => handleEditClick(term)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ fontWeight: 600 }}>{term.sourceTerm}</td>
                      <td style={{ color: 'var(--accent-color)', fontWeight: 500 }}>{term.targetTerm}</td>
                      <td 
                        style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                        title={getTermScopeTooltip(term)}
                      >
                        {getTermScopeDisplay(term)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          {term.caseSensitive && <span className="term-case-badge">Aa</span>}
                          {term.category === 'character' && (
                            <span style={{ 
                              fontSize: '0.75rem', 
                              padding: '0.1rem 0.35rem', 
                              borderRadius: '4px', 
                              backgroundColor: term.gender === 'male' ? 'rgba(99,102,241,0.15)' : term.gender === 'female' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                              color: term.gender === 'male' ? '#818cf8' : term.gender === 'female' ? '#c084fc' : 'var(--text-secondary)',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.15rem'
                            }}>
                              {term.gender === 'male' ? 'Male ♂' : term.gender === 'female' ? 'Female ♀' : 'Character ❓'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.35rem 0.5rem', borderRadius: '4px' }}
                          onClick={(e) => handleDelete(term.id, e)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
