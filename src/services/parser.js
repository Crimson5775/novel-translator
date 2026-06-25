import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version || '6.0.227'}/build/pdf.worker.min.mjs`;

/**
 * Utility to strip HTML tags and parse paragraphs
 * @param {string} html 
 * @returns {string[]} array of paragraphs
 */
function parseHtmlParagraphs(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Find all p tags, or select block elements if no p tags
  const pElements = doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li');
  if (pElements.length > 0) {
    const paragraphs = [];
    pElements.forEach(el => {
      const text = el.textContent.trim();
      if (text) paragraphs.push(text);
    });
    return paragraphs;
  }
  
  // Fallback: split text by newlines
  const text = doc.body?.textContent || doc.documentElement.textContent || '';
  return text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

/**
 * Helper to split a large list of paragraphs into chunks of chapters
 * @param {string[]} paragraphs 
 * @param {number} size 
 * @returns {Array<{title: string, paragraphs: string[]}>}
 */
function chunkParagraphsToChapters(paragraphs, size = 40) {
  const chapters = [];
  let chapterIndex = 1;
  for (let i = 0; i < paragraphs.length; i += size) {
    const chunk = paragraphs.slice(i, i + size);
    chapters.push({
      title: `Part ${chapterIndex}`,
      paragraphs: chunk
    });
    chapterIndex++;
  }
  return chapters;
}

// --- TXT Parser ---
export function parseTxt(text) {
  // Regex to detect chapter boundaries
  // Matches "Chapter 1", "Chapter I", "第十二章", "Volume 1", "Prologue", etc.
  const chapterRegex = /^\s*(?:chapter|volume|section|prologue|epilogue|第[一二三四五六七八九十百千万\d]+[章节回分卷])\b/i;
  
  const lines = text.split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;
  let currentParagraphs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line is a chapter header
    if (chapterRegex.test(line) && line.length < 100) {
      // Save previous chapter if exists
      if (currentChapter || currentParagraphs.length > 0) {
        chapters.push({
          title: currentChapter || 'Prologue',
          paragraphs: [...currentParagraphs]
        });
      }
      currentChapter = line;
      currentParagraphs = [];
    } else {
      currentParagraphs.push(line);
    }
  }

  // Push last chapter
  if (currentChapter || currentParagraphs.length > 0) {
    chapters.push({
      title: currentChapter || 'Chapter 1',
      paragraphs: [...currentParagraphs]
    });
  }

  // If we couldn't detect any structured chapters, chunk the paragraphs
  if (chapters.length <= 1) {
    const allParagraphs = chapters.length === 1 ? chapters[0].paragraphs : currentParagraphs;
    if (allParagraphs.length > 0) {
      return chunkParagraphsToChapters(allParagraphs, 40); // 40 paragraphs per chapter
    }
  }

  return chapters;
}

// --- EPUB Parser ---
export async function parseEpub(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  // 1. Read container.xml to find the OPF file path
  const containerText = await zip.file('META-INF/container.xml').async('text');
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerText, 'text/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  if (!rootfileEl) throw new Error('Invalid EPUB: container.xml has no rootfile.');
  
  const opfPath = rootfileEl.getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  
  // 2. Read OPF file
  const opfText = await zip.file(opfPath).async('text');
  const opfDoc = parser.parseFromString(opfText, 'text/xml');
  
  // Build manifest mapping (id -> href)
  const items = opfDoc.querySelectorAll('manifest > item');
  const manifest = {};
  items.forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });
  
  // Read spine order
  const itemrefs = opfDoc.querySelectorAll('spine > itemref');
  const chapters = [];
  
  for (let i = 0; i < itemrefs.length; i++) {
    const idref = itemrefs[i].getAttribute('idref');
    const relHref = manifest[idref];
    if (!relHref) continue;
    
    // Resolve full path inside zip
    // Href might contain a hash (#some-id), strip it
    const cleanHref = relHref.split('#')[0];
    const fullHref = opfDir + cleanHref;
    const normalizedHref = fullHref.replace(/\/\/+/g, '/'); // normalize double slashes
    
    const file = zip.file(normalizedHref);
    if (!file) continue;
    
    const htmlContent = await file.async('text');
    const chapterDoc = parser.parseFromString(htmlContent, 'text/html');
    
    // Extract title
    let title = chapterDoc.querySelector('title')?.textContent?.trim() ||
                  chapterDoc.querySelector('h1, h2, h3')?.textContent?.trim();
                  
    const paragraphs = parseHtmlParagraphs(htmlContent);
    
    if (paragraphs.length > 0) {
      chapters.push({
        title: title || `Chapter ${chapters.length + 1}`,
        paragraphs
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract any chapters from EPUB spine.');
  }

  return chapters;
}

// --- PDF Parser ---
export async function parsePdf(arrayBuffer) {
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const chapters = [];
  
  // For PDFs, we can group pages (e.g. 5 pages per "Chapter" block)
  const pagesPerChapter = 5;
  let currentPageGroup = [];
  let chapterIndex = 1;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Extract lines based on items
    let lastY = null;
    let lines = [];
    let currentLine = '';

    for (const item of textContent.items) {
      // If item is on a new line (y coordinate changed significantly)
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        currentLine = item.str;
      } else {
        currentLine += (currentLine ? ' ' : '') + item.str;
      }
      lastY = item.transform[5];
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    // Join lines to form paragraphs (usually separated by spacing in layout, 
    // but here we can group paragraphs by double line breaks or sentence endings)
    const pageText = lines.join('\n');
    const paragraphs = pageText
      .split(/\n\n+/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
      
    currentPageGroup.push(...paragraphs);

    if (i % pagesPerChapter === 0 || i === numPages) {
      if (currentPageGroup.length > 0) {
        const startPage = i - currentPageGroup.length + 1; // dummy start calculation, or just range
        chapters.push({
          title: `Pages ${i - (i % pagesPerChapter === 0 ? pagesPerChapter - 1 : (i % pagesPerChapter) - 1)} - ${i}`,
          paragraphs: [...currentPageGroup]
        });
        currentPageGroup = [];
        chapterIndex++;
      }
    }
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract any text from PDF.');
  }

  return chapters;
}
