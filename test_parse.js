import fs from 'fs';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

async function testParse() {
  const epubPath = "path/to/your/novel.epub";
  console.log("Reading file:", epubPath);
  
  if (!fs.existsSync(epubPath)) {
    console.error("File does not exist!");
    return;
  }
  
  const buffer = fs.readFileSync(epubPath);
  console.log("File read successfully, size:", buffer.length, "bytes");

  try {
    const zip = await JSZip.loadAsync(buffer);
    console.log("Zip loaded successfully.");

    // Read container.xml
    const containerText = await zip.file('META-INF/container.xml').async('text');
    console.log("container.xml read.");
    
    const dom = new JSDOM(containerText, { contentType: "text/xml" });
    const rootfileEl = dom.window.document.querySelector('rootfile');
    if (!rootfileEl) {
      console.error("No rootfile in container.xml");
      return;
    }
    
    const opfPath = rootfileEl.getAttribute('full-path');
    console.log("OPF Path:", opfPath);
    
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    console.log("OPF Dir:", opfDir);

    const opfText = await zip.file(opfPath).async('text');
    console.log("OPF content read.");

    const opfDom = new JSDOM(opfText, { contentType: "text/xml" });
    
    const items = opfDom.window.document.querySelectorAll('manifest > item');
    const manifest = {};
    items.forEach(item => {
      manifest[item.getAttribute('id')] = item.getAttribute('href');
    });
    console.log("Manifest size:", Object.keys(manifest).length);

    const itemrefs = opfDom.window.document.querySelectorAll('spine > itemref');
    console.log("Spine size (total chapters):", itemrefs.length);

    // Let's inspect the first 10 chapters
    for (let i = 0; i < Math.min(10, itemrefs.length); i++) {
      const idref = itemrefs[i].getAttribute('idref');
      const relHref = manifest[idref];
      console.log(`Chapter ${i + 1} idref:`, idref, "href:", relHref);
      
      const cleanHref = relHref.split('#')[0];
      const fullHref = opfDir + cleanHref;
      const normalizedHref = fullHref.replace(/\/\/+/g, '/');

      const file = zip.file(normalizedHref);
      if (!file) {
        console.error(`Chapter file not found in zip: ${normalizedHref}`);
        continue;
      }

      const htmlContent = await file.async('text');
      const chDom = new JSDOM(htmlContent);
      const title = chDom.window.document.querySelector('title')?.textContent?.trim() ||
                    chDom.window.document.querySelector('h1, h2, h3')?.textContent?.trim() || 
                    `Chapter ${i + 1}`;
      
      const pElements = chDom.window.document.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li');
      const paragraphs = [];
      pElements.forEach(el => {
        const text = el.textContent.trim();
        if (text) paragraphs.push(text);
      });

      console.log(`Chapter ${i + 1} Title:`, title);
      console.log(`Chapter ${i + 1} Paragraph count:`, paragraphs.length);
      if (paragraphs.length > 0) {
        console.log("First paragraph sample:", paragraphs[0].substring(0, 100));
      }
    }
  } catch (err) {
    console.error("Error during parsing:", err);
  }
}

testParse();
