import React, { useState, useEffect, useRef } from 'react';
import { Upload, BookOpen, Trash2, Library as LibIcon, FileText, Loader } from 'lucide-react';
import { saveNovel, getNovels, deleteNovel, saveChapter } from '../db/db';
import { parseTxt, parseEpub, parsePdf } from '../services/parser';

export default function Library({ onSelectNovel }) {
  const [novels, setNovels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      const list = await getNovels();
      setNovels(list);
    } catch (err) {
      console.error('Failed to load novels:', err);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    
    if (ext !== '.txt' && ext !== '.epub' && ext !== '.pdf') {
      alert('Unsupported file format. Please upload a TXT, EPUB, or PDF file.');
      return;
    }

    setLoading(true);
    setLoadingMessage(`Reading ${fileName}...`);

    try {
      let parsedChapters = [];
      const reader = new FileReader();

      if (ext === '.txt') {
        const text = await new Promise((resolve, reject) => {
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsText(file);
        });
        setLoadingMessage('Parsing chapters and paragraphs...');
        parsedChapters = parseTxt(text);
      } else if (ext === '.epub') {
        const buffer = await new Promise((resolve, reject) => {
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsArrayBuffer(file);
        });
        setLoadingMessage('Parsing EPUB container and chapters...');
        parsedChapters = await parseEpub(buffer);
      } else if (ext === '.pdf') {
        const buffer = await new Promise((resolve, reject) => {
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsArrayBuffer(file);
        });
        setLoadingMessage('Extracting PDF page-by-page text content (this may take a minute for large files)...');
        parsedChapters = await parsePdf(buffer);
      }

      if (parsedChapters.length === 0) {
        throw new Error('No content could be extracted from the file.');
      }

      setLoadingMessage(`Scaffolding database for ${parsedChapters.length} chapters...`);
      
      const novelId = 'novel_' + Date.now();
      const settings = JSON.parse(localStorage.getItem('aura_settings') || '{}');
      
      const novel = {
        id: novelId,
        title: fileName.substring(0, fileName.lastIndexOf('.')),
        author: 'Unknown Author',
        format: ext.substring(1).toUpperCase(),
        addedAt: Date.now(),
        totalChapters: parsedChapters.length,
        sourceLanguage: settings.defaultSourceLanguage || 'auto',
        targetLanguage: settings.defaultTargetLanguage || 'en',
        translatedPercentage: 0
      };

      // Save each chapter
      for (let i = 0; i < parsedChapters.length; i++) {
        const parsedCh = parsedChapters[i];
        const chapter = {
          novelId: novelId,
          chapterIndex: i,
          title: parsedCh.title,
          paragraphs: parsedCh.paragraphs.map((p, pIdx) => ({
            id: pIdx,
            sourceText: p,
            translatedText: '',
            status: 'untranslated'
          }))
        };
        await saveChapter(chapter);
      }

      // Save the novel metadata
      await saveNovel(novel);
      
      setLoading(false);
      // Automatically route user to the workspace of the newly created novel
      onSelectNovel(novelId);
    } catch (err) {
      console.error('Failed to parse file:', err);
      alert('Error parsing file: ' + err.message);
      setLoading(false);
    }
    
    // Clear input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (id, title, e) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete "${title}" and all its translations?`)) {
      setLoading(true);
      setLoadingMessage(`Deleting ${title}...`);
      try {
        await deleteNovel(id);
        await loadNovels();
      } catch (err) {
        console.error('Failed to delete novel:', err);
        alert('Failed to delete novel: ' + err.message);
      }
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Novel Library</h1>
        <button className="btn btn-primary" onClick={handleUploadClick}>
          <Upload size={18} /> Upload Novel
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="file-input-hidden"
        accept=".txt,.epub,.pdf"
      />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p style={{ fontWeight: 600, fontSize: '1.1rem' }}>{loadingMessage}</p>
        </div>
      )}

      {novels.length === 0 ? (
        <div className="card upload-card" onClick={handleUploadClick}>
          <LibIcon className="upload-icon" />
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Your Library is Empty</h2>
          <p style={{ color: 'var(--text-secondary)', maxW: '400px' }}>
            Upload a novel in TXT, EPUB, or PDF format. We will split it into chapters and paragraphs so you can translate it.
          </p>
          <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }}>
            Choose File
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {novels.map((novel) => (
            <div
              key={novel.id}
              className="card novel-card"
              onClick={() => onSelectNovel(novel.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="novel-info">
                <div className="novel-meta">
                  <span className="novel-badge">{novel.format}</span>
                  <span>Added {new Date(novel.addedAt).toLocaleDateString()}</span>
                </div>
                <h3 className="novel-title">{novel.title}</h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Chapters: {novel.totalChapters}
                </span>
                
                <div className="progress-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Translation Progress</span>
                    <span style={{ color: 'var(--text-primary)' }}>{Math.round(novel.translatedPercentage || 0)}%</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${novel.translatedPercentage || 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="novel-actions">
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  onClick={() => onSelectNovel(novel.id)}
                >
                  <BookOpen size={16} /> Open Workspace
                </button>
                <button
                  className="btn btn-danger"
                  style={{ padding: '0.5rem' }}
                  onClick={(e) => handleDelete(novel.id, novel.title, e)}
                  title="Delete Novel"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
