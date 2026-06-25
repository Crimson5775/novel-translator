import fs from 'fs';
import { JSDOM } from 'jsdom';

// Mock DOM environment for Node
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.DOMMatrix = dom.window.DOMMatrix || class DOMMatrix {};

// Dynamically import modules after globals are set
const { parseEpub } = await import('./src/services/parser.js');
const { translateWithGemini } = await import('./src/services/translation.js');

async function runTest() {
  const epubPath = "path/to/your/novel.epub";
  const apiKey = "YOUR_GEMINI_API_KEY";
  const model = "gemini-2.5-flash";

  console.log("--- Starting Novel Translation Test ---");
  console.log("Epub Path:", epubPath);
  console.log("Gemini API Key:", apiKey === "YOUR_GEMINI_API_KEY" ? "Placeholder" : apiKey.substring(0, 10) + "...");

  if (!fs.existsSync(epubPath)) {
    console.error("Error: EPUB file does not exist at path:", epubPath);
    process.exit(1);
  }

  try {
    const fileBuffer = fs.readFileSync(epubPath);
    console.log("EPUB loaded from disk. Size:", fileBuffer.length, "bytes");

    // Convert Buffer to ArrayBuffer as expected by JSZip/parseEpub
    const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

    console.log("Parsing EPUB chapters...");
    const chapters = await parseEpub(arrayBuffer);
    console.log(`Successfully parsed ${chapters.length} chapters.`);

    // Take the first 3 chapters that have content
    const testChapters = chapters.slice(0, 3);
    console.log(`\nTesting translation on the first ${testChapters.length} chapters.`);

    for (let i = 0; i < testChapters.length; i++) {
      const ch = testChapters[i];
      console.log(`\n--------------------------------------------`);
      console.log(`Chapter ${i + 1} Title: ${ch.title}`);
      console.log(`Paragraph count: ${ch.paragraphs.length}`);
      
      // Let's translate the first 2 paragraphs as a quick API sanity test to verify Gemini is working
      const paragraphsToTranslate = ch.paragraphs.slice(0, 2);
      console.log(`Translating first ${paragraphsToTranslate.length} paragraphs...`);
      console.log("Source texts:", JSON.stringify(paragraphsToTranslate, null, 2));

      try {
        const translations = await translateWithGemini(
          paragraphsToTranslate,
          apiKey,
          model,
          "Chinese", // Source Lang
          "English", // Target Lang
          [],        // Empty glossary for test
          0.3        // Temperature
        );

        console.log("Translations successful!");
        console.log("Translated texts:", JSON.stringify(translations, null, 2));
      } catch (transErr) {
        console.error(`Error translating Chapter ${i + 1}:`, transErr);
      }
    }

    console.log(`\n--- Test Complete ---`);
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  }
}

runTest();
