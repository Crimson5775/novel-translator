# AURA: Novel Translator

AURA is a premium side-by-side web-based novel translator built with **React** and **Vite**. It provides a fully-featured interface for importing web novels, translating them chapter-by-chapter using advanced LLMs (like Google Gemini) or machine translation (Google Cloud Translation), and managing term translation glossaries.

> [!NOTE]
> **🚀 Under Development & Support Request**
> AURA is currently under active development. If you would like to support the development and testing of this project, you can contribute by sending free Gemini API keys from Google AI Studio (or other API keys) to **illman7887@proton.me**.

---

## ✨ Features

- **Side-by-Side Editor**: Translate novels paragraph-by-paragraph with original and translated text side-by-side.
- **Multiple Gemini API Keys & Key Rotation**: Add multiple Gemini API keys. The runner will automatically rotate through the keys if one hits a `429 (Resource Exhausted / Quota Exceeded)` limit, enabling uninterrupted batch translations.
- **AI Glossary Collector**: Automatically scan your novel chapters using Gemini AI to extract names, terms, locations, and characters (with auto-detected gender: male, female, or unknown) and save them directly into the Glossary Manager.
- **Glossary Term Enforcement**: Pre-translation glossary enforcement ensures names, honorifics, and custom terms are translated consistently across all chapters.
- **Reader Mode**: Toggle between side-by-side editing and distraction-free reading. Swap between the original text and the translated text instantly, and adjust font sizes.
- **Flexible Exporter**: Export translated chapters in `.txt` or `.html` formats, individually or as a ZIP archive.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed (version 18+ recommended).

### Local Installation

1. Clone or download this project.
2. Navigate to the project directory:
   ```bash
   cd novel-translator
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:5173/`.

---

## ⚙️ Configuration & API Keys

To use the translation and glossary extraction features, configure your API keys in the **Settings** tab:

1. **Google Gemini API Keys**:
   - Get your free or paid API keys from the [Google AI Studio](https://aistudio.google.com/).
   - Add one or more keys in the settings panel.
   - Click **Test Key** to verify a key's connection.
   - Click **Add Key** to save it to your local rotation list.
   - You can also run **Test All Keys** to check your list at once.
2. **Google Cloud Translation API Key**:
   - Optional. Configure a standard GCP Translation API key if you want to use traditional Google Translate.
3. Select your preferred default source/target languages and Gemini LLM Model (e.g. `gemini-2.5-flash` or `gemini-2.5-pro`).

*Note: All configuration and API keys are stored securely in your browser's local storage (`localStorage`) and are sent directly to the official API endpoints.*

---

## 📖 How to Use

### 1. Import a Novel
- In the **Library** tab, click **Add Novel**.
- Input the title, author, and description, and select the source and target languages.
- Create chapters and paste the original text paragraphs.

### 2. Collect Glossary Terms (AI Scan)
- Open the novel workspace.
- Click the **AI Glossary Scan** button.
- Choose to scan the current chapter or a custom range.
- The AI will extract characters, gender info, and key terms and present them in a review list.
- Click **Save Checked to Glossary** to register them.

### 3. Run Translation
- Click the **Translate** button in the workspace sidebar.
- Choose whether to translate the current chapter, all untranslated chapters, or a custom range.
- Watch the live progress logs in the workspace console. If a key hits a quota limit, the console will log the rotation to the next key.
- You can pause or cancel translation at any time; your progress is saved automatically.

### 4. Reading & Exporting
- Switch to **Reader Mode** to read translated chapters.
- Click **Export / Download** to export your translation.
