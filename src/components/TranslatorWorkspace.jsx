import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Square, Download, Sparkles, BookOpen, AlertTriangle, CheckCircle, Edit3, Loader, Sliders, Trash2, ChevronLeft, ChevronRight, X, Plus, Minus } from 'lucide-react';
import { getNovel, getChapters, getChapter, saveChapter, saveNovel, getGlossaryTerms, saveGlossaryTerm, deleteChapterAndReindex } from '../db/db';
import JSZip from 'jszip';
import { translateWithGemini, translateWithGoogle, extractGlossaryFromText, translateWithOpenRouter, extractGlossaryFromTextWithOpenRouter } from '../services/translation';
import { LANGUAGES } from './Settings';

const BATCH_SIZE = 8; // Process 8 paragraphs at a time

export default function TranslatorWorkspace({ novelId, onBack }) {
  const [novel, setNovel] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [activeChapter, setActiveChapter] = useState(null);
  
  // Settings & Keys loaded from localStorage
  const [apiSettings, setApiSettings] = useState({
    geminiApiKey: '',
    googleApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    defaultSourceLanguage: 'zh',
    defaultTargetLanguage: 'en'
  });
  
  const [engine, setEngine] = useState('gemini'); // 'gemini', 'openrouter', or 'google'
  const [glossary, setGlossary] = useState([]);
  
  // Translation process state
  const [isTranslating, setIsTranslating] = useState(false);
  const [activeBatchIndex, setActiveBatchIndex] = useState(-1);
  const cancelTranslateRef = useRef(false);

  // Translation control options
  const [translationRange, setTranslationRange] = useState('current'); // 'current', 'all', 'range'
  const [rangeStartChapterIndex, setRangeStartChapterIndex] = useState(0);
  const [rangeEndChapterIndex, setRangeEndChapterIndex] = useState(0);
  const [applyGlossary, setApplyGlossary] = useState(true);

  // Advanced Controls
  const [temperature, setTemperature] = useState(0.3);
  const [batchSize, setBatchSize] = useState(8);
  const [cooldownDelay, setCooldownDelay] = useState(0); // in seconds

  // Live status logs console
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);

  // Sidebar toggle for smaller screens (open by default on desktop)
  const [showSidebar, setShowSidebar] = useState(true);

  // Reader Mode & Font Sizing
  const [viewMode, setViewMode] = useState('split'); // 'split' (editor) or 'reader' (reader)
  const [readerFontSize, setReaderFontSize] = useState(18); // default font size 18px
  const [readerTextMode, setReaderTextMode] = useState('translation'); // 'translation' or 'original'

  // Background translation monitoring state
  const [translatingChapterIndex, setTranslatingChapterIndex] = useState(null);
  const [translationProgress, setTranslationProgress] = useState(null);

  // Granular Export Modal Options
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportScope, setExportScope] = useState('current'); // 'current', 'range', 'all'
  const [exportFormat, setExportFormat] = useState('txt'); // 'txt', 'html'
  const [exportSplitFiles, setExportSplitFiles] = useState(false); // separate files inside ZIP

  // AI Glossary Collector Modal Options
  const [showGlossaryScanModal, setShowGlossaryScanModal] = useState(false);
  const [glossaryScanScope, setGlossaryScanScope] = useState('current'); // 'current', 'first5', 'first10', 'range', 'all'
  const [scanStartChapterIndex, setScanStartChapterIndex] = useState(0);
  const [scanEndChapterIndex, setScanEndChapterIndex] = useState(0);
  const [isScanningGlossary, setIsScanningGlossary] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanProgress, setScanProgress] = useState(null);

  // Sync scrolling refs
  const leftPaneRef = useRef(null);
  const rightPaneRef = useRef(null);
  const isSyncScrolling = useRef(false);
  const activeKeyIndexRef = useRef(0);
  const activeOpenRouterKeyIndexRef = useRef(0);

  useEffect(() => {
    loadNovelData();
  }, [novelId]);

  useEffect(() => {
    if (chapters.length > 0) {
      loadChapter(activeChapterIndex);
    }
  }, [activeChapterIndex, chapters]);

  // Scroll logs terminal to bottom on update
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadNovelData = async () => {
    try {
      const nov = await getNovel(novelId);
      setNovel(nov);

      const chs = await getChapters(novelId);
      setChapters(chs);
      setRangeEndChapterIndex(chs.length > 0 ? chs.length - 1 : 0);

      const terms = await getGlossaryTerms(novelId);
      setGlossary(terms);

      // Load settings
      const savedSettings = localStorage.getItem('aura_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setApiSettings(parsed);
        // Default translation engine choice based on keys available
        if (parsed.geminiApiKey) {
          setEngine('gemini');
        } else if (parsed.openRouterApiKey) {
          setEngine('openrouter');
        } else if (parsed.googleApiKey) {
          setEngine('google');
        }
      }
    } catch (err) {
      console.error('Failed to load novel workspace data:', err);
    }
  };

  const loadChapter = async (index) => {
    try {
      const ch = await getChapter(novelId, index);
      setActiveChapter(ch);
    } catch (err) {
      console.error('Failed to load chapter:', err);
    }
  };

  const callGeminiWithFallback = async (apiCallFunction, ...args) => {
    const keys = apiSettings.geminiApiKeys && apiSettings.geminiApiKeys.length > 0
      ? apiSettings.geminiApiKeys 
      : (apiSettings.geminiApiKey ? [apiSettings.geminiApiKey] : []);
    
    const activeKeys = keys.map(k => k.trim()).filter(Boolean);
    if (activeKeys.length === 0) {
      throw new Error('No Gemini API Key is configured.');
    }

    let attempts = 0;
    const maxAttempts = activeKeys.length;
    let lastError = null;

    while (attempts < maxAttempts) {
      const currentIdx = (activeKeyIndexRef.current + attempts) % activeKeys.length;
      const keyToUse = activeKeys[currentIdx];

      try {
        const overriddenArgs = [...args];
        overriddenArgs[1] = keyToUse; // Replace apiKey (second argument)
        const result = await apiCallFunction(...overriddenArgs);
        
        // Success: persist this working key index for subsequent batches
        activeKeyIndexRef.current = currentIdx;
        return result;
      } catch (err) {
        const errMsg = err.message || '';
        const isQuotaError = errMsg.includes('429') || 
                             errMsg.toLowerCase().includes('quota') || 
                             errMsg.toLowerCase().includes('rate limit') || 
                             errMsg.toLowerCase().includes('resource_exhausted') ||
                             errMsg.toLowerCase().includes('limit');
        
        if (isQuotaError && activeKeys.length > 1) {
          const rotationMsg = `Gemini API Key #${currentIdx + 1} quota exceeded. Rotating to Key #${((currentIdx + 1) % activeKeys.length) + 1}...`;
          addLog(rotationMsg, 'warning');
          
          // Also show on the progress card if present
          setTranslationProgress(prev => prev ? {
            ...prev,
            status: 'Rotating API Key...'
          } : null);
          
          attempts++;
          lastError = err;
          
          // Wait 1 second before retrying with next key
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          throw err;
        }
      }
    }

    throw new Error(`All ${activeKeys.length} Gemini API keys failed or exceeded quota. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  };

  const callOpenRouterWithFallback = async (apiCallFunction, ...args) => {
    const keys = apiSettings.openRouterApiKeys && apiSettings.openRouterApiKeys.length > 0
      ? apiSettings.openRouterApiKeys 
      : (apiSettings.openRouterApiKey ? [apiSettings.openRouterApiKey] : []);
    
    const activeKeys = keys.map(k => k.trim()).filter(Boolean);
    if (activeKeys.length === 0) {
      throw new Error('No OpenRouter API Key is configured.');
    }

    let attempts = 0;
    const maxAttempts = activeKeys.length;
    let lastError = null;

    while (attempts < maxAttempts) {
      const currentIdx = (activeOpenRouterKeyIndexRef.current + attempts) % activeKeys.length;
      const keyToUse = activeKeys[currentIdx];

      try {
        const overriddenArgs = [...args];
        overriddenArgs[1] = keyToUse; // Replace apiKey (second argument)
        const result = await apiCallFunction(...overriddenArgs);
        
        // Success: persist this working key index for subsequent batches
        activeOpenRouterKeyIndexRef.current = currentIdx;
        return result;
      } catch (err) {
        const errMsg = err.message || '';
        const isQuotaError = errMsg.includes('429') || 
                             errMsg.toLowerCase().includes('quota') || 
                             errMsg.toLowerCase().includes('rate limit') || 
                             errMsg.toLowerCase().includes('resource_exhausted') ||
                             errMsg.toLowerCase().includes('limit');
        
        if (isQuotaError && activeKeys.length > 1) {
          const rotationMsg = `OpenRouter API Key #${currentIdx + 1} quota/rate limit hit. Rotating to Key #${((currentIdx + 1) % activeKeys.length) + 1}...`;
          addLog(rotationMsg, 'warning');
          
          setTranslationProgress(prev => prev ? {
            ...prev,
            status: 'Rotating API Key...'
          } : null);
          
          attempts++;
          lastError = err;
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          throw err;
        }
      }
    }

    throw new Error(`All ${activeKeys.length} OpenRouter API keys failed or exceeded quota. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  };

  const handleDeleteChapter = async () => {
    if (!activeChapter) return;
    const confirmDelete = confirm(`Are you sure you want to delete chapter "${activeChapter.title || `Chapter ${activeChapterIndex + 1}`}"? This will permanently remove it and reindex all subsequent chapters.`);
    if (!confirmDelete) return;

    try {
      addLog(`Deleting chapter: ${activeChapter.title}`, 'warning');
      await deleteChapterAndReindex(novelId, activeChapterIndex);
      
      // Reload chapters
      const chs = await getChapters(novelId);
      setChapters(chs);
      
      // Adjust active chapter index
      let newIdx = activeChapterIndex;
      if (chs.length === 0) {
        setActiveChapter(null);
        setActiveChapterIndex(0);
      } else {
        if (newIdx >= chs.length) {
          newIdx = chs.length - 1;
        }
        setActiveChapterIndex(newIdx);
        // Explicitly load the chapter at new index
        await loadChapter(newIdx);
      }
      
      // Update overall progress since a chapter was deleted
      await updateNovelOverallProgress();
      alert('Chapter deleted and database reindexed successfully!');
    } catch (err) {
      console.error('Failed to delete chapter:', err);
      alert('Failed to delete chapter: ' + err.message);
    }
  };


  const addLog = (text, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [
      ...prev,
      { id: Date.now() + Math.random(), timestamp, text, type }
    ]);
  };

  // Sync scroll left & right
  const handleScroll = (source, target) => {
    if (isSyncScrolling.current) return;
    isSyncScrolling.current = true;
    
    if (source.current && target.current) {
      const percentage = source.current.scrollTop / (source.current.scrollHeight - source.current.clientHeight);
      target.current.scrollTop = percentage * (target.current.scrollHeight - target.current.clientHeight);
    }
    
    // Clear sync lock
    setTimeout(() => {
      isSyncScrolling.current = false;
    }, 50);
  };

  // Manual Edit translated paragraph
  const handleParagraphEdit = async (pIdx, text) => {
    if (!activeChapter) return;
    
    const updatedParagraphs = activeChapter.paragraphs.map(p => {
      if (p.id === pIdx) {
        return {
          ...p,
          translatedText: text,
          status: text.trim() ? 'edited' : 'untranslated'
        };
      }
      return p;
    });

    const updatedChapter = { ...activeChapter, paragraphs: updatedParagraphs };
    setActiveChapter(updatedChapter);
    
    // Save to DB
    await saveChapter(updatedChapter);
    await updateNovelOverallProgress();
  };

  // Update novel metadata progress
  const updateNovelOverallProgress = async () => {
    try {
      const allChapters = await getChapters(novelId);
      let totalParagraphs = 0;
      let translatedCount = 0;

      allChapters.forEach(ch => {
        totalParagraphs += ch.paragraphs.length;
        translatedCount += ch.paragraphs.filter(p => p.status === 'translated' || p.status === 'edited').length;
      });

      const percentage = totalParagraphs > 0 ? (translatedCount / totalParagraphs) * 100 : 0;
      
      const updatedNovel = {
        ...novel,
        translatedPercentage: percentage
      };
      setNovel(updatedNovel);
      await saveNovel(updatedNovel);
    } catch (err) {
      console.error('Failed to update overall progress:', err);
    }
  };

  const processExtractedCharacters = async (extractedCharacters) => {
    if (!extractedCharacters || extractedCharacters.length === 0) return;

    try {
      const existingTerms = await getGlossaryTerms(novelId);
      let updatedAny = false;

      for (const char of extractedCharacters) {
        if (!char.sourceName || !char.targetName) continue;
        const source = char.sourceName.trim();
        const target = char.targetName.trim();
        const gender = (char.gender || 'unknown').toLowerCase();

        // Check if there is an existing term in the glossary matching this source term
        const existing = existingTerms.find(
          t => t.sourceTerm.toLowerCase() === source.toLowerCase()
        );

        if (existing) {
          const oldGender = (existing.gender || 'unknown').toLowerCase();
          // If the gender was unknown in the DB, but is now known (male or female), update the DB!
          if (oldGender === 'unknown' && (gender === 'male' || gender === 'female')) {
            const updated = {
              ...existing,
              gender: gender,
              description: `Character (Gender: ${gender === 'male' ? 'Male' : 'Female'})`
            };
            await saveGlossaryTerm(updated);
            updatedAny = true;
            addLog(`Updated gender in Glossary for: "${source}" (${target}) -> ${gender}`, 'success');
            
            // Show status update on the progress card
            setTranslationProgress(prev => prev ? {
              ...prev,
              status: `Glossary: Updated "${source}" gender to ${gender}`
            } : null);
          }
        } else {
          // Add new character glossary term
          const newTerm = {
            novelId: novelId,
            sourceTerm: source,
            targetTerm: target,
            caseSensitive: false,
            category: 'character',
            gender: gender,
            description: `Character (Gender: ${gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : 'Unknown'})`
          };
          await saveGlossaryTerm(newTerm);
          updatedAny = true;
          addLog(`Added character to Glossary: "${source}" (${target}) [${gender}]`, 'success');
          
          // Show status update on the progress card
          setTranslationProgress(prev => prev ? {
            ...prev,
            status: `Glossary: Extracted "${source}" [${gender}]`
          } : null);
        }
      }

      // If any terms were added or updated, reload glossary state so they apply to subsequent translation requests
      if (updatedAny) {
        const terms = await getGlossaryTerms(novelId);
        setGlossary(terms);
      }
    } catch (err) {
      console.error('Failed to process extracted characters:', err);
    }
  };

  // Unified Start Translation Handler
  const handleStartTranslation = async (forceOverwrite = false) => {
    if (isTranslating) return;

    const key = engine === 'gemini' ? apiSettings.geminiApiKey : engine === 'openrouter' ? apiSettings.openRouterApiKey : apiSettings.googleApiKey;
    if (!key) {
      alert(`API Key is missing. Please configure your ${engine === 'gemini' ? 'Gemini' : engine === 'openrouter' ? 'OpenRouter' : 'Google Cloud'} API Key in Settings.`);
      return;
    }

    // Determine range indexes
    let startIdx = 0;
    let endIdx = chapters.length - 1;

    if (translationRange === 'current') {
      startIdx = activeChapterIndex;
      endIdx = activeChapterIndex;
    } else if (translationRange === 'range') {
      startIdx = rangeStartChapterIndex;
      endIdx = rangeEndChapterIndex;
      if (startIdx > endIdx) {
        const temp = startIdx;
        startIdx = endIdx;
        endIdx = temp;
      }
    }

    // 1. Calculate total paragraphs to translate across the selected range
    let totalParagraphsToTranslate = 0;
    const chaptersToProcess = [];

    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      const chapter = await getChapter(novelId, cIdx);
      if (chapter) {
        const count = forceOverwrite 
          ? chapter.paragraphs.length
          : chapter.paragraphs.filter(p => p.status === 'untranslated' || p.status === 'progress' || !p.translatedText.trim()).length;
        
        if (count > 0) {
          totalParagraphsToTranslate += count;
          chaptersToProcess.push({ index: cIdx, title: chapter.title, untranslatedCount: count });
        }
      }
    }

    if (totalParagraphsToTranslate === 0) {
      alert('No paragraphs found to translate in the selected range.');
      return;
    }

    setIsTranslating(true);
    cancelTranslateRef.current = false;
    
    // Set initial progress
    setTranslationProgress({
      status: 'Initializing...',
      percent: 0,
      chaptersDone: 0,
      totalChapters: chaptersToProcess.length,
      translatedParagraphs: 0,
      totalParagraphs: totalParagraphsToTranslate,
      error: null
    });

    const activeGlossaryForCall = applyGlossary ? glossary : [];
    let translatedParagraphsCount = 0;
    let chaptersCompleted = 0;

    try {
      // Loop through chapters that actually need translation
      for (const chInfo of chaptersToProcess) {
        if (cancelTranslateRef.current) break;

        const cIdx = chInfo.index;
        setTranslatingChapterIndex(cIdx);

        // Load the chapter content for translation
        const chapterToTranslate = await getChapter(novelId, cIdx);
        
        // Find paragraph indices to translate
        const untranslatedIndices = [];
        let modified = false;
        chapterToTranslate.paragraphs.forEach((p, idx) => {
          if (forceOverwrite) {
            untranslatedIndices.push(idx);
            p.status = 'untranslated';
            modified = true;
          } else if (p.status === 'untranslated' || p.status === 'progress' || !p.translatedText.trim()) {
            untranslatedIndices.push(idx);
            if (p.status === 'progress' || !p.translatedText.trim()) {
              p.status = 'untranslated';
              modified = true;
            }
          }
        });
        if (modified) {
          await saveChapter(chapterToTranslate);
        }

        // Translate this chapter's untranslated paragraph batches
        for (let i = 0; i < untranslatedIndices.length; i += batchSize) {
          if (cancelTranslateRef.current) break;

          const batchIndices = untranslatedIndices.slice(i, i + batchSize);
          setActiveBatchIndex(batchIndices[0]);

          const currentBatchNumber = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(untranslatedIndices.length / batchSize);
          
          setTranslationProgress(prev => ({
            ...prev,
            status: `Translating "${chapterToTranslate.title}" (Batch ${currentBatchNumber}/${totalBatches})...`
          }));

          // Mark paragraphs as in progress
          chapterToTranslate.paragraphs = chapterToTranslate.paragraphs.map((p, idx) => {
            if (batchIndices.includes(idx)) return { ...p, status: 'progress' };
            return p;
          });

          // Update active chapter live if the user is currently viewing it
          if (cIdx === activeChapterIndex) {
            setActiveChapter({ ...chapterToTranslate });
          }

          const batchTexts = batchIndices.map(idx => chapterToTranslate.paragraphs[idx].sourceText);
          const sourceLangName = LANGUAGES.find(l => l.code === novel.sourceLanguage)?.name || 'Chinese';
          const targetLangName = LANGUAGES.find(l => l.code === novel.targetLanguage)?.name || 'English';

          let translations = [];
          let extractedCharacters = [];
          if (engine === 'gemini') {
            const result = await callGeminiWithFallback(
              translateWithGemini,
              batchTexts,
              null, // Will be overridden
              apiSettings.geminiModel,
              sourceLangName,
              targetLangName,
              activeGlossaryForCall,
              temperature,
              true // extractEntities = true
            );
            translations = result.translations;
            extractedCharacters = result.extractedCharacters;
          } else if (engine === 'openrouter') {
            const result = await callOpenRouterWithFallback(
              translateWithOpenRouter,
              batchTexts,
              null, // Will be overridden
              apiSettings.openRouterModel || 'google/gemini-2.5-flash',
              sourceLangName,
              targetLangName,
              activeGlossaryForCall,
              temperature,
              true // extractEntities = true
            );
            translations = result.translations;
            extractedCharacters = result.extractedCharacters;
          } else {
            translations = await translateWithGoogle(
              batchTexts,
              apiSettings.googleApiKey,
              novel.sourceLanguage,
              novel.targetLanguage,
              activeGlossaryForCall
            );
          }

          // Process the extracted characters in the background
          if (extractedCharacters && extractedCharacters.length > 0) {
            await processExtractedCharacters(extractedCharacters);
          }

          // Apply translations with spacing formatting
          chapterToTranslate.paragraphs = chapterToTranslate.paragraphs.map((p, idx) => {
            if (batchIndices.includes(idx)) {
              const subIdx = batchIndices.indexOf(idx);
              const rawText = translations[subIdx] || '';
              // Format sentence spacing: make sure there is a space after punctuation followed by a capital letter
              const formattedText = rawText.replace(/([.!?])([A-Z])/g, '$1 $2');
              return {
                ...p,
                translatedText: formattedText,
                status: 'translated'
              };
            }
            return p;
          });

          // Save to DB and update UI if viewed
          if (cIdx === activeChapterIndex) {
            setActiveChapter({ ...chapterToTranslate });
          }
          await saveChapter(chapterToTranslate);
          await updateNovelOverallProgress();

          // Increment paragraph counters and update progress
          translatedParagraphsCount += batchIndices.length;
          const currentPercent = Math.min(100, Math.round((translatedParagraphsCount / totalParagraphsToTranslate) * 100));
          
          setTranslationProgress(prev => ({
            ...prev,
            percent: currentPercent,
            translatedParagraphs: translatedParagraphsCount
          }));

          // Wait cooldown delay if set and it's not the last batch
          if (cooldownDelay > 0 && i + batchSize < untranslatedIndices.length && !cancelTranslateRef.current) {
            setTranslationProgress(prev => ({
              ...prev,
              status: `Rate limiting: waiting ${cooldownDelay}s...`
            }));
            await new Promise(resolve => setTimeout(resolve, cooldownDelay * 1000));
          }
        }

        chaptersCompleted++;
        setTranslationProgress(prev => ({
          ...prev,
          chaptersDone: chaptersCompleted
        }));
      }

      if (!cancelTranslateRef.current) {
        setTranslationProgress(prev => ({
          ...prev,
          percent: 100,
          status: 'Translation completed!'
        }));
        alert('Translation completed successfully!');
      } else {
        alert('Translation paused.');
      }
    } catch (err) {
      console.error('Translation error:', err);
      setTranslationProgress(prev => ({
        ...prev,
        status: 'Error encountered',
        error: err.message
      }));
      alert('Translation error: ' + err.message);
    } finally {
      setIsTranslating(false);
      setActiveBatchIndex(-1);
      setTranslatingChapterIndex(null);
    }
  };

  const handleStopTranslation = () => {
    cancelTranslateRef.current = true;
    setIsTranslating(false);
    addLog('Stopping translation runner...', 'warning');
  };

  const handleStartGlossaryScan = async () => {
    if (!apiSettings.geminiApiKey) {
      alert('AI Glossary Collection requires a Google Gemini API Key. Please configure it in the Settings tab.');
      return;
    }

    // Determine range
    let startIdx = 0;
    let endIdx = chapters.length - 1;

    if (glossaryScanScope === 'current') {
      startIdx = activeChapterIndex;
      endIdx = activeChapterIndex;
    } else if (glossaryScanScope === 'first5') {
      startIdx = 0;
      endIdx = Math.min(4, chapters.length - 1);
    } else if (glossaryScanScope === 'first10') {
      startIdx = 0;
      endIdx = Math.min(9, chapters.length - 1);
    } else if (glossaryScanScope === 'range') {
      startIdx = scanStartChapterIndex;
      endIdx = scanEndChapterIndex;
      if (startIdx > endIdx) {
        const temp = startIdx;
        startIdx = endIdx;
        endIdx = temp;
      }
    }

    setIsScanningGlossary(true);
    setScanStatus('Initializing scan...');
    setScanProgress({ current: 0, total: endIdx - startIdx + 1, percent: 0 });

    let addedTermsCount = 0;
    let updatedTermsCount = 0;

    // Helper process local to scan
    const processExtractedScanCharacters = async (extracted) => {
      if (!extracted || extracted.length === 0) return;
      const existingTerms = await getGlossaryTerms(novelId);
      
      for (const char of extracted) {
        if (!char.sourceName || !char.targetName) continue;
        const source = char.sourceName.trim();
        const target = char.targetName.trim();
        const gender = (char.gender || 'unknown').toLowerCase();
        const category = (char.category || 'character').toLowerCase();

        const existing = existingTerms.find(
          t => t.sourceTerm.toLowerCase() === source.toLowerCase()
        );

        if (existing) {
          const oldGender = (existing.gender || 'unknown').toLowerCase();
          if (oldGender === 'unknown' && (gender === 'male' || gender === 'female')) {
            const updated = {
              ...existing,
              gender: gender,
              description: `Character (Gender: ${gender === 'male' ? 'Male' : 'Female'})`
            };
            await saveGlossaryTerm(updated);
            updatedTermsCount++;
            addLog(`AI Scan: Updated gender for "${source}" (${target}) -> ${gender}`, 'success');
          }
        } else {
          const newTerm = {
            novelId: novelId,
            sourceTerm: source,
            targetTerm: target,
            caseSensitive: false,
            category: category,
            gender: category === 'character' ? gender : 'unknown',
            description: category === 'character' 
              ? `Character (Gender: ${gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : 'Unknown'})`
              : `Key Term`
          };
          await saveGlossaryTerm(newTerm);
          addedTermsCount++;
          addLog(`AI Scan: Added to glossary: "${source}" (${target}) [${gender}]`, 'success');
        }
      }
    };

    try {
      const sourceLangName = LANGUAGES.find(l => l.code === novel.sourceLanguage)?.name || 'Chinese';
      const targetLangName = LANGUAGES.find(l => l.code === novel.targetLanguage)?.name || 'English';

      for (let idx = startIdx; idx <= endIdx; idx++) {
        const chapter = await getChapter(novelId, idx);
        if (!chapter) continue;

        const currentChNum = idx - startIdx + 1;
        const totalChs = endIdx - startIdx + 1;
        setScanStatus(`Scanning "${chapter.title || `Chapter ${idx + 1}`}"...`);
        setScanProgress({
          current: currentChNum,
          total: totalChs,
          percent: Math.round(((currentChNum - 1) / totalChs) * 100)
        });

        // Split paragraphs into batches of 15 paragraphs to avoid exceeding Gemini batch limits
        const paragraphsText = chapter.paragraphs.map(p => p.sourceText).filter(t => t.trim().length > 0);
        
        const scanBatchSize = 15;
        for (let pIdx = 0; pIdx < paragraphsText.length; pIdx += scanBatchSize) {
          const batch = paragraphsText.slice(pIdx, pIdx + scanBatchSize);
        let result;
        if (engine === 'gemini') {
          result = await callGeminiWithFallback(
            extractGlossaryFromText,
            batch,
            null, // Will be overridden
            apiSettings.geminiModel,
            sourceLangName,
            targetLangName
          );
        } else if (engine === 'openrouter') {
          result = await callOpenRouterWithFallback(
            extractGlossaryFromTextWithOpenRouter,
            batch,
            null, // Will be overridden
            apiSettings.openRouterModel || 'google/gemini-2.5-flash',
            sourceLangName,
            targetLangName
          );
        } else {
          const hasGemini = apiSettings.geminiApiKeys && apiSettings.geminiApiKeys.length > 0;
          const hasOpenRouter = apiSettings.openRouterApiKeys && apiSettings.openRouterApiKeys.length > 0;
          if (hasGemini) {
            result = await callGeminiWithFallback(
              extractGlossaryFromText,
              batch,
              null,
              apiSettings.geminiModel,
              sourceLangName,
              targetLangName
            );
          } else if (hasOpenRouter) {
            result = await callOpenRouterWithFallback(
              extractGlossaryFromTextWithOpenRouter,
              batch,
              null,
              apiSettings.openRouterModel || 'google/gemini-2.5-flash',
              sourceLangName,
              targetLangName
            );
          } else {
            throw new Error('Glossary Scan requires either Google Gemini or OpenRouter to be configured in Settings.');
          }
        }
        if (result.extractedCharacters && result.extractedCharacters.length > 0) {
          await processExtractedScanCharacters(result.extractedCharacters);
        }
        }

        setScanProgress(prev => ({
          ...prev,
          percent: Math.round((currentChNum / totalChs) * 100)
        }));
      }

      // Refresh glossary state
      const terms = await getGlossaryTerms(novelId);
      setGlossary(terms);

      alert(`Glossary scan completed successfully!\nAdded: ${addedTermsCount} new terms\nUpdated: ${updatedTermsCount} existing terms`);
      setShowGlossaryScanModal(false);
    } catch (err) {
      console.error('Glossary scan failed:', err);
      alert('Glossary scan failed: ' + err.message);
    } finally {
      setIsScanningGlossary(false);
      setScanProgress(null);
    }
  };

  // Unified Export Handler
  const handleExport = async () => {
    try {
      let chaptersToExport = [];

      // 1. Get chapters based on selected scope
      if (exportScope === 'current') {
        if (!activeChapter) return;
        chaptersToExport = [activeChapter];
      } else if (exportScope === 'range') {
        let startIdx = rangeStartChapterIndex;
        let endIdx = rangeEndChapterIndex;
        if (startIdx > endIdx) {
          const temp = startIdx;
          startIdx = endIdx;
          endIdx = temp;
        }
        
        // Load all chapters in the range from IndexedDB
        for (let idx = startIdx; idx <= endIdx; idx++) {
          const ch = await getChapter(novelId, idx);
          if (ch) chaptersToExport.push(ch);
        }
      } else {
        // all
        chaptersToExport = await getChapters(novelId);
      }

      if (chaptersToExport.length === 0) {
        alert('No chapters found to export.');
        return;
      }

      // Helper to generate file contents
      const generateTextContent = (ch) => {
        let content = `${ch.title}\n`;
        content += `=========================================\n\n`;
        ch.paragraphs.forEach(p => {
          content += `${p.translatedText.trim() || p.sourceText}\n\n`;
        });
        return content;
      };

      const generateHtmlContent = (ch) => {
        let content = `<h2>${ch.title}</h2>\n`;
        ch.paragraphs.forEach(p => {
          const txt = (p.translatedText.trim() || p.sourceText)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          content += `<p>${txt}</p>\n`;
        });
        return content;
      };

      // 2. Execute Export
      if (exportSplitFiles && (exportScope === 'range' || exportScope === 'all')) {
        // ZIP Export
        const zip = new JSZip();
        chaptersToExport.forEach((ch) => {
          let fileContent = '';
          const filenameIndex = String(ch.chapterIndex + 1).padStart(3, '0');
          const safeTitle = (ch.title || `Chapter ${ch.chapterIndex + 1}`).replace(/[/\\?%*:|"<>]/g, '-');
          
          if (exportFormat === 'txt') {
            fileContent = generateTextContent(ch);
            zip.file(`${filenameIndex}_${safeTitle}.txt`, fileContent);
          } else {
            // HTML file wrapper
            const bodyHtml = generateHtmlContent(ch);
            fileContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${ch.title}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.8; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    p { text-indent: 2em; margin: 1.2em 0; text-align: justify; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
            zip.file(`${filenameIndex}_${safeTitle}.html`, fileContent);
          }
        });

        const blob = await zip.generateAsync({ type: 'blob' });
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", URL.createObjectURL(blob));
        downloadAnchor.setAttribute("download", `${novel.title}_chapters.zip`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      } else {
        // Single File Export (Merged)
        let fileContent = '';
        if (exportFormat === 'txt') {
          fileContent = `${novel.title} - AI Translated Novel\n\n`;
          chaptersToExport.forEach(ch => {
            fileContent += `\n\n=========================================\n`;
            fileContent += generateTextContent(ch);
          });

          const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute("href", URL.createObjectURL(blob));
          downloadAnchor.setAttribute("download", `${novel.title}_translated.txt`);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
        } else {
          // HTML
          let bodyHtml = '';
          chaptersToExport.forEach(ch => {
            bodyHtml += generateHtmlContent(ch);
          });

          fileContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${novel.title}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.8; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; }
    h1 { text-align: center; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-top: 40px; }
    p { text-indent: 2em; margin: 1.2em 0; text-align: justify; }
  </style>
</head>
<body>
  <h1>${novel.title}</h1>
  ${bodyHtml}
</body>
</html>`;

          const blob = new Blob([fileContent], { type: 'text/html;charset=utf-8' });
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute("href", URL.createObjectURL(blob));
          downloadAnchor.setAttribute("download", `${novel.title}_translated.html`);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
        }
      }

      setShowExportModal(false);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export: ' + err.message);
    }
  };

  const handlePrevChapter = () => {
    if (activeChapterIndex > 0) {
      setActiveChapterIndex(activeChapterIndex - 1);
    }
  };

  const handleNextChapter = () => {
    if (activeChapterIndex < chapters.length - 1) {
      setActiveChapterIndex(activeChapterIndex + 1);
    }
  };

  if (!novel) {
    return (
      <div className="workspace-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
        <Loader className="spinner" />
        <span style={{ color: 'var(--text-secondary)' }}>Loading novel metadata...</span>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="workspace-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem', padding: '2rem' }}>
        <AlertTriangle size={48} style={{ color: 'var(--warning)' }} />
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: '0.5rem' }}>No Chapters Found</h2>
          <p style={{ color: 'var(--text-secondary)' }}>No chapters were loaded. Try re-importing the novel.</p>
        </div>
        <button className="btn btn-primary" onClick={onBack}>
          <ArrowLeft size={16} /> Return to Library
        </button>
      </div>
    );
  }

  if (!activeChapter) {
    return (
      <div className="workspace-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
        <Loader className="spinner" />
        <span style={{ color: 'var(--text-secondary)' }}>Loading chapter content from database...</span>
      </div>
    );
  }

  // Calculated chapter progress stats
  const chTotalParagraphs = activeChapter.paragraphs.length;
  const chTranslatedParagraphs = activeChapter.paragraphs.filter(p => p.status === 'translated' || p.status === 'edited').length;

  return (
    <div className="workspace-container">
      {/* Workspace Header Toolbar */}
      <div className="workspace-header">
        <div className="workspace-title-area">
          <button className="btn-back" onClick={onBack} title="Back to Library">
            <ArrowLeft size={20} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Workspace</span>
            <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{novel.title}</span>
          </div>
        </div>

        <div className="workspace-chapter-selector" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Chapter:</span>
          <button 
            className="btn btn-secondary" 
            style={{ padding: '0.4rem', border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center' }}
            onClick={handlePrevChapter}
            disabled={activeChapterIndex === 0 || isTranslating}
            title="Previous Chapter"
          >
            <ChevronLeft size={16} />
          </button>
          <select
            className="input select"
            style={{ width: '220px', padding: '0.4rem 2rem 0.4rem 0.8rem', borderRadius: '6px' }}
            value={activeChapterIndex}
            onChange={(e) => setActiveChapterIndex(Number(e.target.value))}
            disabled={isTranslating}
          >
            {chapters.map((ch, idx) => (
              <option key={idx} value={idx}>
                {ch.title || `Chapter ${idx + 1}`}
              </option>
            ))}
          </select>
          <button 
            className="btn btn-secondary" 
            style={{ padding: '0.4rem', border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center' }}
            onClick={handleNextChapter}
            disabled={activeChapterIndex === chapters.length - 1 || isTranslating}
            title="Next Chapter"
          >
            <ChevronRight size={16} />
          </button>

          <button 
            className="btn btn-secondary"
            onClick={handleDeleteChapter}
            disabled={isTranslating}
            title="Delete this chapter and reindex subsequent chapters"
            style={{ padding: '0.4rem', marginLeft: '0.25rem', border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center' }}
          >
            <Trash2 size={16} style={{ color: 'var(--danger)' }} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {viewMode === 'split' ? (
            <button 
              className="btn btn-secondary" 
              onClick={() => setViewMode('reader')} 
              title="Switch to clean Reader View"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
            >
              <BookOpen size={15} /> Reader View
            </button>
          ) : (
            <button 
              className="btn btn-secondary" 
              onClick={() => setViewMode('split')} 
              title="Switch to side-by-side Editor"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
            >
              <Edit3 size={15} /> Editor View
            </button>
          )}

          <button 
            className="btn btn-secondary" 
            onClick={() => setShowExportModal(true)} 
            title="Export Novel Configurations"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
          >
            <Download size={15} /> Export
          </button>

          {isTranslating ? (
            <button 
              className="btn btn-danger" 
              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }} 
              onClick={handleStopTranslation}
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} 
              onClick={handleStartTranslation}
            >
              <Play size={14} /> Translate
            </button>
          )}

          <button
            className="btn btn-secondary btn-sidebar-toggle"
            onClick={() => setShowSidebar(!showSidebar)}
            title="Toggle settings & logs sidebar"
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <Sliders size={14} /> {showSidebar ? 'Hide Controls' : 'Show Controls'}
          </button>
        </div>
      </div>

      {/* Main Workspace Panels */}
      <div className={`workspace-main mode-${viewMode} sidebar-${showSidebar ? 'open' : 'closed'}`}>
        {viewMode === 'reader' ? (
          /* Reader Optimized View Panel */
          <div className="reader-container">
            {/* Inline Reader Toolbar */}
            <div className="reader-toolbar">
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {activeChapter.title || `Chapter ${activeChapterIndex + 1}`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {/* Original/Translation Segmented Toggle */}
                <div className="reader-controls-group">
                  <button 
                    className={`btn ${readerTextMode === 'original' ? 'active' : ''}`}
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: '6px 0 0 6px', fontWeight: 600 }}
                    onClick={() => setReaderTextMode('original')}
                  >
                    Original
                  </button>
                  <button 
                    className={`btn ${readerTextMode === 'translation' ? 'active' : ''}`}
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: '0 6px 6px 0', borderLeft: 'none', fontWeight: 600 }}
                    onClick={() => setReaderTextMode('translation')}
                  >
                    Translation
                  </button>
                </div>

                <div className="reader-controls-group">
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Font Size:</span>
                  <button 
                    className="btn-font-adjust" 
                    onClick={() => setReaderFontSize(f => Math.max(14, f - 2))} 
                    disabled={readerFontSize <= 14} 
                    title="Decrease text size"
                  >
                    <Minus size={12} />
                  </button>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '36px', textAlign: 'center' }}>
                    {readerFontSize}px
                  </span>
                  <button 
                    className="btn-font-adjust" 
                    onClick={() => setReaderFontSize(f => Math.min(28, f + 2))} 
                    disabled={readerFontSize >= 28} 
                    title="Increase text size"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Main Center Reading Content */}
            <div className="reader-content" style={{ fontSize: `${readerFontSize}px` }}>
              {activeChapter.paragraphs.map((p, idx) => {
                const isTranslated = p.status === 'translated' || p.status === 'edited' || p.translatedText.trim();
                const showOriginal = readerTextMode === 'original';
                return (
                  <p 
                    key={p.id} 
                    className={`reader-paragraph ${!isTranslated && !showOriginal ? 'untranslated-fallback' : ''}`}
                  >
                    {showOriginal ? p.sourceText : (isTranslated ? p.translatedText : p.sourceText)}
                  </p>
                );
              })}
            </div>

            {/* Bottom Navigation Pagination */}
            <div className="reader-pagination">
              <button 
                className="btn btn-secondary" 
                onClick={handlePrevChapter} 
                disabled={activeChapterIndex === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <ChevronLeft size={16} /> Prev Chapter
              </button>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                {activeChapterIndex + 1} / {chapters.length}
              </span>
              <button 
                className="btn btn-secondary" 
                onClick={handleNextChapter} 
                disabled={activeChapterIndex === chapters.length - 1}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                Next Chapter <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ) : (
          /* Dual-Pane Side-by-Side Editor Panels */
          <>
            {/* Left Panel: Original Text */}
            <div className="workspace-pane">
              <div className="pane-header">
                <span>ORIGINAL ({LANGUAGES.find(l => l.code === novel.sourceLanguage)?.name || 'Detect'})</span>
                <span style={{ fontSize: '0.75rem' }}>Total paragraphs: {chTotalParagraphs}</span>
              </div>
              <div
                className="pane-content"
                ref={leftPaneRef}
                onScroll={() => handleScroll(leftPaneRef, rightPaneRef)}
              >
                {activeChapter.paragraphs.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`paragraph-block ${activeBatchIndex === idx ? 'active' : ''}`}
                  >
                    <span className="paragraph-index">#{idx + 1}</span>
                    <p className="paragraph-text">{p.sourceText}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Panel: Translated Text (Editable) */}
            <div className="workspace-pane">
              <div className="pane-header">
                <span>TRANSLATION ({LANGUAGES.find(l => l.code === novel.targetLanguage)?.name || 'English'})</span>
                <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  Translated: {chTranslatedParagraphs}/{chTotalParagraphs}
                </span>
              </div>
              <div
                className="pane-content"
                ref={rightPaneRef}
                onScroll={() => handleScroll(rightPaneRef, leftPaneRef)}
              >
                {activeChapter.paragraphs.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`paragraph-block ${activeBatchIndex === idx ? 'active' : ''}`}
                  >
                    <span className="paragraph-index">#{idx + 1}</span>
                    
                    <textarea
                      className="paragraph-textarea"
                      value={p.translatedText}
                      onChange={(e) => handleParagraphEdit(p.id, e.target.value)}
                      placeholder="Translation text area... Click to translate or type manually to edit."
                    />

                    <div className="paragraph-status-bar">
                      {p.status === 'untranslated' && (
                        <span className="status-indicator status-untranslated">Untranslated</span>
                      )}
                      {p.status === 'progress' && (
                        <span className="status-indicator status-progress">
                          <Loader size={12} className="spinner" style={{ animationDuration: '0.8s' }} /> Translating
                        </span>
                      )}
                      {p.status === 'translated' && (
                        <span className="status-indicator status-translated">
                          <CheckCircle size={12} /> Translated
                        </span>
                      )}
                      {p.status === 'edited' && (
                        <span className="status-indicator status-edited">
                          <Edit3 size={12} /> Edited
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Configuration / Glossary Sidebar */}
        <div className={`workspace-sidebar ${showSidebar ? 'open' : ''}`}>
          {/* Close button inside drawer for mobile */}
          <button 
            className="btn btn-secondary btn-sidebar-toggle"
            onClick={() => setShowSidebar(false)}
            style={{ width: '100%', marginBottom: '0.5rem', padding: '0.4rem', fontSize: '0.8rem' }}
          >
            Close Settings
          </button>

          {/* Engine Config */}
          <div className="sidebar-section">
            <span className="sidebar-title">Translation Engine</span>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="engine"
                  value="gemini"
                  checked={engine === 'gemini'}
                  onChange={() => setEngine('gemini')}
                  disabled={isTranslating}
                />
                Google Gemini LLM
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="engine"
                  value="openrouter"
                  checked={engine === 'openrouter'}
                  onChange={() => setEngine('openrouter')}
                  disabled={isTranslating}
                />
                OpenRouter LLM
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="engine"
                  value="google"
                  checked={engine === 'google'}
                  onChange={() => setEngine('google')}
                  disabled={isTranslating}
                />
                Google Cloud Translate
              </label>
            </div>

            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {engine === 'gemini' && (
                apiSettings.geminiApiKey ? (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span className="status-dot active"></span> Gemini Key Active
                  </span>
                ) : (
                  <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertTriangle size={14} /> Gemini Key Missing
                  </span>
                )
              )}
              {engine === 'openrouter' && (
                apiSettings.openRouterApiKey ? (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span className="status-dot active"></span> OpenRouter Key Active
                  </span>
                ) : (
                  <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertTriangle size={14} /> OpenRouter Key Missing
                  </span>
                )
              )}
              {engine === 'google' && (
                apiSettings.googleApiKey ? (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span className="status-dot active"></span> Google Cloud Key Active
                  </span>
                ) : (
                  <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertTriangle size={14} /> Google Key Missing
                  </span>
                )
              )}
            </div>
          </div>

          {/* Translation Control panel */}
          <div className="sidebar-section">
            <span className="sidebar-title">Translation Control</span>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="translationRange"
                  value="current"
                  checked={translationRange === 'current'}
                  onChange={() => setTranslationRange('current')}
                  disabled={isTranslating}
                />
                Current Chapter
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="translationRange"
                  value="all"
                  checked={translationRange === 'all'}
                  onChange={() => setTranslationRange('all')}
                  disabled={isTranslating}
                />
                All Chapters
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="radio"
                  name="translationRange"
                  value="range"
                  checked={translationRange === 'range'}
                  onChange={() => setTranslationRange('range')}
                  disabled={isTranslating}
                />
                Custom Range
              </label>
            </div>

            {translationRange === 'range' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>From:</label>
                  <select
                    className="input select"
                    style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', fontSize: '0.8rem', borderRadius: '4px', height: '32px' }}
                    value={rangeStartChapterIndex}
                    onChange={(e) => setRangeStartChapterIndex(Number(e.target.value))}
                    disabled={isTranslating}
                  >
                    {chapters.map((ch, idx) => (
                      <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>To:</label>
                  <select
                    className="input select"
                    style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', fontSize: '0.8rem', borderRadius: '4px', height: '32px' }}
                    value={rangeEndChapterIndex}
                    onChange={(e) => setRangeEndChapterIndex(Number(e.target.value))}
                    disabled={isTranslating}
                  >
                    {chapters.map((ch, idx) => (
                      <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <input
                type="checkbox"
                id="applyGlossary"
                checked={applyGlossary}
                onChange={(e) => setApplyGlossary(e.target.checked)}
                disabled={isTranslating}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="applyGlossary" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                Apply Glossary Terms
              </label>
            </div>

            {/* Tuning Parameters Collapsible/Group */}
            <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>Tuning Controls</span>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {engine === 'gemini' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                      <label htmlFor="temperature">Temperature:</label>
                      <span style={{ fontWeight: 600 }}>{temperature}</span>
                    </div>
                    <input
                      type="range"
                      id="temperature"
                      min="0.0"
                      max="1.0"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      disabled={isTranslating}
                      style={{ width: '100%', cursor: 'pointer' }}
                      title="Lower is more literal, higher is more creative"
                    />
                  </div>
                )}

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                    <label htmlFor="batchSize">Batch Size (Paragraphs):</label>
                    <span style={{ fontWeight: 600 }}>{batchSize}</span>
                  </div>
                  <select
                    id="batchSize"
                    className="input select"
                    style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', fontSize: '0.8rem', borderRadius: '4px', height: '32px' }}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    disabled={isTranslating}
                  >
                    <option value="3">3 paragraphs (Safer)</option>
                    <option value="5">5 paragraphs</option>
                    <option value="8">8 paragraphs (Default)</option>
                    <option value="12">12 paragraphs (Faster)</option>
                    <option value="16">16 paragraphs (Large context)</option>
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                    <label htmlFor="cooldownDelay">API Cooldown Delay:</label>
                    <span style={{ fontWeight: 600 }}>{cooldownDelay}s</span>
                  </div>
                  <select
                    id="cooldownDelay"
                    className="input select"
                    style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', fontSize: '0.8rem', borderRadius: '4px', height: '32px' }}
                    value={cooldownDelay}
                    onChange={(e) => setCooldownDelay(Number(e.target.value))}
                    disabled={isTranslating}
                  >
                    <option value="0">No Delay (Instant)</option>
                    <option value="1">1 second delay</option>
                    <option value="2">2 seconds delay</option>
                    <option value="3">3 seconds delay</option>
                    <option value="5">5 seconds delay (Free Tier key safe)</option>
                    <option value="10">10 seconds delay</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {isTranslating ? (
                <button 
                  className="btn btn-danger" 
                  style={{ width: '100%', padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} 
                  onClick={handleStopTranslation}
                >
                  <Square size={16} /> Stop Translation
                </button>
              ) : (
                <>
                  <button 
                    className="btn btn-primary" 
                    style={{ width: '100%', padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} 
                    onClick={() => handleStartTranslation(false)}
                  >
                    <Play size={16} /> Start Translation
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    style={{ width: '100%', padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }} 
                    onClick={() => handleStartTranslation(true)}
                    title="Translate all paragraphs in selected scope, overwriting existing translations"
                  >
                    <Sparkles size={16} style={{ color: 'var(--warning)' }} /> Re-translate Range
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Active Translation Progress Card (Replaces Live Log console) */}
          {translationProgress && (
            <div className="sidebar-section">
              <span className="sidebar-title">Translation Run Progress</span>
              <div className="translation-progress-card">
                <div className="progress-card-header">
                  <span className="progress-status" title={translationProgress.status}>
                    {translationProgress.status}
                  </span>
                  <span className="progress-percent">{translationProgress.percent}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${translationProgress.percent}%` }}
                  ></div>
                </div>
                {translationProgress.error && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.8rem', padding: '0.4rem', borderRadius: '4px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)' }}>
                    {translationProgress.error}
                  </div>
                )}
                <div className="progress-card-footer">
                  <span>Chapters: {translationProgress.chaptersDone} / {translationProgress.totalChapters}</span>
                  <span>Paragraphs: {translationProgress.translatedParagraphs} / {translationProgress.totalParagraphs}</span>
                </div>
              </div>
            </div>
          )}

          {/* Progress Stats */}
          <div className="sidebar-section">
            <span className="sidebar-title">Overall Progress</span>
            <div className="sidebar-stats">
              <div className="stat-box">
                <div className="stat-val">{Math.round(novel.translatedPercentage || 0)}%</div>
                <div className="stat-lbl">Translated</div>
              </div>
              <div className="stat-box">
                <div className="stat-val">{chapters.length}</div>
                <div className="stat-lbl">Chapters</div>
              </div>
            </div>
          </div>

          {/* Active Glossary Terms */}
          <div className="sidebar-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span className="sidebar-title" style={{ borderBottom: 'none', paddingBottom: 0 }}>Active Glossary ({glossary.length})</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)' }}
                onClick={() => setShowGlossaryScanModal(true)}
                disabled={isTranslating}
                title="Scan novel chapters using AI to collect characters and terms"
              >
                <Sparkles size={12} style={{ color: 'var(--accent-color)' }} /> AI Collect
              </button>
            </div>
            {glossary.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                No active glossary terms for this novel scope. Add terms in the Glossary tab.
              </p>
            ) : (
              <div className="sidebar-terms-list" style={{ maxHeight: '120px' }}>
                {glossary.map((term) => (
                  <div key={term.id} className="sidebar-term-pill">
                    <span className="sidebar-term-source">{term.sourceTerm}</span>
                    <span className="sidebar-term-target">{term.targetTerm}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Export Options Modal Overlay */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Export Options</h2>
              <button className="btn-close-modal" onClick={() => setShowExportModal(false)} title="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Scope selection */}
              <div className="form-group">
                <label className="form-label">Scope</label>
                <select 
                  className="input select" 
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value)}
                >
                  <option value="current">Current Chapter ({activeChapter.title || `Chapter ${activeChapterIndex + 1}`})</option>
                  <option value="range">Custom Range</option>
                  <option value="all">All Chapters ({chapters.length})</option>
                </select>
              </div>

              {/* Custom range controls */}
              {exportScope === 'range' && (
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">From</label>
                    <select 
                      className="input select" 
                      value={rangeStartChapterIndex}
                      onChange={(e) => setRangeStartChapterIndex(Number(e.target.value))}
                    >
                      {chapters.map((ch, idx) => (
                        <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">To</label>
                    <select 
                      className="input select" 
                      value={rangeEndChapterIndex}
                      onChange={(e) => setRangeEndChapterIndex(Number(e.target.value))}
                    >
                      {chapters.map((ch, idx) => (
                        <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Format selection */}
              <div className="form-group">
                <label className="form-label">Format</label>
                <select 
                  className="input select" 
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                >
                  <option value="txt">Plain Text (.txt)</option>
                  <option value="html">Web Page (.html)</option>
                </select>
              </div>

              {/* Split files checkbox */}
              {(exportScope === 'range' || exportScope === 'all') && (
                <div className="form-group" style={{ marginTop: '0.25rem' }}>
                  <label className="form-checkbox-label">
                    <input 
                      type="checkbox" 
                      className="form-checkbox"
                      checked={exportSplitFiles}
                      onChange={(e) => setExportSplitFiles(e.target.checked)}
                    />
                    Export as separate files (ZIP archive)
                  </label>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleExport}>
                Download Export
              </button>
            </div>
          </div>
        </div>
      )}
      {/* AI Glossary Collector Modal Overlay */}
      {showGlossaryScanModal && (
        <div className="modal-overlay" onClick={() => !isScanningGlossary && setShowGlossaryScanModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={20} style={{ color: 'var(--accent-color)' }} /> AI Glossary Collector
              </h2>
              {!isScanningGlossary && (
                <button className="btn-close-modal" onClick={() => setShowGlossaryScanModal(false)} title="Close">
                  <X size={20} />
                </button>
              )}
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Scan the novel's chapters using Gemini AI to automatically identify characters, their genders, and key terminology, and add them to your glossary.
              </p>

              {isScanningGlossary ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', padding: '1.5rem 0' }}>
                  <Loader className="spinner" />
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{scanStatus}</span>
                  {scanProgress && (
                    <div style={{ width: '100%' }}>
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${scanProgress.percent}%` }}></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        <span>Chapter {scanProgress.current} / {scanProgress.total}</span>
                        <span>{scanProgress.percent}%</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Scope to Scan</label>
                    <select 
                      className="input select" 
                      value={glossaryScanScope}
                      onChange={(e) => setGlossaryScanScope(e.target.value)}
                    >
                      <option value="current">Current Chapter ({activeChapter.title || `Chapter ${activeChapterIndex + 1}`})</option>
                      <option value="first5">First 5 Chapters</option>
                      <option value="first10">First 10 Chapters</option>
                      <option value="range">Custom Range</option>
                      <option value="all">All Chapters ({chapters.length})</option>
                    </select>
                  </div>

                  {glossaryScanScope === 'range' && (
                    <div className="form-row">
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">From</label>
                        <select 
                          className="input select" 
                          value={scanStartChapterIndex}
                          onChange={(e) => setScanStartChapterIndex(Number(e.target.value))}
                        >
                          {chapters.map((ch, idx) => (
                            <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">To</label>
                        <select 
                          className="input select" 
                          value={scanEndChapterIndex}
                          onChange={(e) => setScanEndChapterIndex(Number(e.target.value))}
                        >
                          {chapters.map((ch, idx) => (
                            <option key={idx} value={idx}>{ch.title || `Chapter ${idx + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {!isScanningGlossary && (
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowGlossaryScanModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleStartGlossaryScan}>
                  Start Scan
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
