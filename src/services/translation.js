// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies glossary terms to text for Google Translate (pre-translation replacement).
 * Replacing the source term with the target term in the source text before sending
 * to Google Translate works because Google Translate typically leaves target-language words intact.
 */
export function applyGlossaryPre(text, terms) {
  if (!terms || terms.length === 0) return text;
  let result = text;
  
  // Sort terms by length descending to prevent partial replacements of longer terms
  const sortedTerms = [...terms].sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  
  sortedTerms.forEach(term => {
    if (!term.sourceTerm || !term.targetTerm) return;
    const flags = term.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegExp(term.sourceTerm), flags);
    result = result.replace(regex, term.targetTerm);
  });
  return result;
}

/**
 * Translates a batch of paragraphs using Google Gemini API
 * @param {string[]} paragraphs - Array of paragraphs to translate
 * @param {string} apiKey - Gemini API Key
 * @param {string} model - e.g., 'gemini-2.5-flash'
 * @param {string} sourceLang - Source language (e.g., 'Chinese')
 * @param {string} targetLang - Target language (e.g., 'English')
 * @param {Array} glossary - Array of glossary terms ({sourceTerm, targetTerm, caseSensitive})
 * @param {number} temperature - creativity slider (0.0 to 1.0)
 * @returns {Promise<string[]>} - Array of translated paragraphs
 */
export async function translateWithGemini(paragraphs, apiKey, model = 'gemini-2.5-flash', sourceLang, targetLang, glossary = [], temperature = 0.3, extractEntities = false) {
  if (!apiKey) throw new Error('Gemini API key is required.');
  if (paragraphs.length === 0) return extractEntities ? { translations: [], extractedCharacters: [] } : [];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build glossary prompt instructions
  let glossaryInstructions = '';
  if (glossary.length > 0) {
    glossaryInstructions = 'You MUST strictly enforce the following term translations:\n';
    glossary.forEach(term => {
      glossaryInstructions += `- "${term.sourceTerm}" MUST be translated as "${term.targetTerm}"\n`;
    });
  }

  let systemPrompt = '';
  if (extractEntities) {
    systemPrompt = `You are a professional literary translator specializing in translating novels from ${sourceLang} to ${targetLang}.
Your goal is to provide a natural, engaging, and high-quality literary translation while preserving the original style, formatting, and tone.
Within each paragraph, ensure all translated sentences are separated by a standard English space (e.g. '. ', '! ', '? ') and never merge or squish sentences together without spaces. Preserve the paragraph architecture exactly.

${glossaryInstructions}

Input format:
You will receive a JSON array of strings, where each string represents a paragraph from the novel.

Output format:
You MUST return a JSON object with exactly two keys:
1. "translations": A JSON array of strings of the EXACT same length as the input array, containing the translations for each paragraph.
2. "extractedCharacters": A JSON array of character/people entities mentioned in these paragraphs. For each character, include:
   - "sourceName": The name of the character in the source language (e.g. in Chinese characters).
   - "targetName": The translated name of the character in the target language (e.g. in English).
   - "gender": The gender of the character based on the context of these paragraphs. MUST be exactly one of: "male", "female", or "unknown". If they are a person but their gender is not clear/mentioned yet, use "unknown".

Do not add any explanations, markdown code blocks, or extra text. Return only the raw JSON object. Example:
{
  "translations": ["translation 1", "translation 2"],
  "extractedCharacters": [
    {"sourceName": "张三", "targetName": "Zhang San", "gender": "male"}
  ]
}`;
  } else {
    systemPrompt = `You are a professional literary translator specializing in translating novels from ${sourceLang} to ${targetLang}.
Your goal is to provide a natural, engaging, and high-quality literary translation while preserving the original style, formatting, and tone.
Within each paragraph, ensure all translated sentences are separated by a standard English space (e.g. '. ', '! ', '? ') and never merge or squish sentences together without spaces. Preserve the paragraph architecture exactly.

${glossaryInstructions}

Input format:
You will receive a JSON array of strings, where each string represents a paragraph from the novel.

Output format:
You MUST return a JSON array of strings of the EXACT same length as the input array.
Each element in the output array must correspond to the translation of the matching element in the input array.
Do not add any explanations, markdown code blocks, or extra text. Return only the raw JSON array. Example: ["translation 1", "translation 2"]`;
  }

  // Send paragraphs as JSON string within the parts
  const body = {
    contents: [
      {
        parts: [
          {
            text: JSON.stringify(paragraphs)
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: systemPrompt
        }
      ]
    },
    generationConfig: {
      temperature: temperature,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error('Invalid response format from Gemini API.');

  try {
    const parsedData = JSON.parse(textResponse.trim());

    if (extractEntities) {
      if (typeof parsedData !== 'object' || !Array.isArray(parsedData.translations)) {
        throw new Error('Response is not a valid JSON object with translations array.');
      }
      const translations = parsedData.translations;
      const extractedCharacters = Array.isArray(parsedData.extractedCharacters) ? parsedData.extractedCharacters : [];
      
      // Align translations length
      let alignedTranslations = translations;
      if (translations.length !== paragraphs.length) {
        console.warn(`Gemini returned ${translations.length} translations but we sent ${paragraphs.length}. Aligning...`);
        if (translations.length < paragraphs.length) {
          alignedTranslations = [...translations, ...Array(paragraphs.length - translations.length).fill('')];
        } else {
          alignedTranslations = translations.slice(0, paragraphs.length);
        }
      }

      return {
        translations: alignedTranslations,
        extractedCharacters: extractedCharacters
      };
    } else {
      if (!Array.isArray(parsedData)) {
        throw new Error('Response is not a JSON array.');
      }
      if (parsedData.length !== paragraphs.length) {
        console.warn(`Gemini returned ${parsedData.length} items but we sent ${paragraphs.length}. Attempting alignment...`);
        if (parsedData.length < paragraphs.length) {
          return [...parsedData, ...Array(paragraphs.length - parsedData.length).fill('')];
        } else {
          return parsedData.slice(0, paragraphs.length);
        }
      }
      return parsedData;
    }
  } catch (parseErr) {
    console.error('Failed to parse Gemini JSON response:', textResponse, parseErr);
    throw new Error('Gemini API did not return a valid JSON format. Response: ' + textResponse.substring(0, 100));
  }
}

/**
 * Translates a batch of paragraphs using Google Cloud Translation API (v2)
 * @param {string[]} paragraphs - Array of paragraphs to translate
 * @param {string} apiKey - Google Cloud Translation API Key
 * @param {string} sourceLangCode - ISO 639-1 language code (e.g., 'zh', 'ja')
 * @param {string} targetLangCode - ISO 639-1 language code (e.g., 'en', 'es')
 * @param {Array} glossary - Array of glossary terms ({sourceTerm, targetTerm, caseSensitive})
 * @returns {Promise<string[]>} - Array of translated paragraphs
 */
export async function translateWithGoogle(paragraphs, apiKey, sourceLangCode, targetLangCode, glossary = []) {
  if (!apiKey) throw new Error('Google Cloud Translation API key is required.');
  if (paragraphs.length === 0) return [];

  // 1. Apply Glossary Pre-translation replacement to source paragraphs
  const processedParagraphs = paragraphs.map(p => applyGlossaryPre(p, glossary));

  // 2. Make Request
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  
  const body = {
    q: processedParagraphs,
    target: targetLangCode,
    format: 'text' // Plain text to avoid HTML escaping
  };
  
  if (sourceLangCode && sourceLangCode !== 'auto') {
    body.source = sourceLangCode;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Cloud Translation API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const translations = data.data?.translations;
  if (!translations || !Array.isArray(translations)) {
    throw new Error('Invalid response format from Google Cloud Translation API.');
  }

  return translations.map(t => t.translatedText);
}

/**
 * Scans original text paragraphs and extracts characters (names, genders) and key terms.
 * @param {string[]} paragraphs - Array of source text paragraphs
 * @param {string} apiKey - Gemini API Key
 * @param {string} model - e.g., 'gemini-2.5-flash'
 * @param {string} sourceLang - Source language name
 * @param {string} targetLang - Target language name
 * @returns {Promise<{extractedCharacters: Array}>} - Extracted glossary terms
 */
export async function extractGlossaryFromText(paragraphs, apiKey, model = 'gemini-2.5-flash', sourceLang, targetLang) {
  if (!apiKey) throw new Error('Gemini API key is required.');
  if (paragraphs.length === 0) return { extractedCharacters: [] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You are an expert glossary extraction AI. Your task is to scan the provided novel paragraphs in the original language (${sourceLang}) and extract glossary terms, focusing primarily on characters (people) and key terms.
Identify the character's name in the source language, translate it accurately to ${targetLang}, and determine their gender based on context.

Output format:
You MUST return a JSON object with exactly one key:
- "extractedCharacters": A JSON array of characters and terms. For each entry, include:
  - "sourceName": The name or term in the source language (e.g. Chinese characters).
  - "targetName": The translated name or term in ${targetLang} (e.g. English).
  - "gender": The gender of the character. MUST be exactly one of: "male", "female", or "unknown". If it is a key term, location, or organization (not a person), use "unknown".
  - "category": Either "character" (for people) or "general" (for locations, terms, objects).

Do not include any explanation or markdown formatting. Return only the raw JSON.`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: JSON.stringify(paragraphs)
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: systemPrompt
        }
      ]
    },
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error('Invalid response format from Gemini API.');

  try {
    const parsedData = JSON.parse(textResponse.trim());
    return {
      extractedCharacters: Array.isArray(parsedData.extractedCharacters) ? parsedData.extractedCharacters : []
    };
  } catch (parseErr) {
    console.error('Failed to parse Gemini glossary response:', textResponse, parseErr);
    throw new Error('Gemini API did not return a valid JSON format.');
  }
}

/**
 * Translates a batch of paragraphs using OpenRouter completions API
 */
export async function translateWithOpenRouter(paragraphs, apiKey, model = 'google/gemini-2.5-flash', sourceLang, targetLang, glossary = [], temperature = 0.3, extractEntities = false) {
  if (!apiKey) throw new Error('OpenRouter API key is required.');
  if (paragraphs.length === 0) return extractEntities ? { translations: [], extractedCharacters: [] } : [];

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  // Build glossary prompt instructions
  let glossaryInstructions = '';
  if (glossary.length > 0) {
    glossaryInstructions = 'You MUST strictly enforce the following term translations:\n';
    glossary.forEach(term => {
      glossaryInstructions += `- "${term.sourceTerm}" MUST be translated as "${term.targetTerm}"\n`;
    });
  }

  let systemPrompt = '';
  if (extractEntities) {
    systemPrompt = `You are a professional literary translator specializing in translating novels from ${sourceLang} to ${targetLang}.
Your goal is to provide a natural, engaging, and high-quality literary translation while preserving the original style, formatting, and tone.
Within each paragraph, ensure all translated sentences are separated by a standard English space (e.g. '. ', '! ', '? ') and never merge or squish sentences together without spaces. Preserve the paragraph architecture exactly.

${glossaryInstructions}

Input format:
You will receive a JSON array of strings, where each string represents a paragraph from the novel.

Output format:
You MUST return a JSON object with exactly two keys:
1. "translations": A JSON array of strings of the EXACT same length as the input array, containing the translations for each paragraph.
2. "extractedCharacters": A JSON array of character/people entities mentioned in these paragraphs. For each character, include:
   - "sourceName": The name of the character in the source language (e.g. in Chinese characters).
   - "targetName": The translated name of the character in the target language (e.g. in English).
   - "gender": The gender of the character based on the context of these paragraphs. MUST be exactly one of: "male", "female", or "unknown". If they are a person but their gender is not clear/mentioned yet, use "unknown".

Do not add any explanations, markdown code blocks, or extra text. Return only the raw JSON object. Example:
{
  "translations": ["translation 1", "translation 2"],
  "extractedCharacters": [
    {"sourceName": "张三", "targetName": "Zhang San", "gender": "male"}
  ]
}`;
  } else {
    systemPrompt = `You are a professional literary translator specializing in translating novels from ${sourceLang} to ${targetLang}.
Your goal is to provide a natural, engaging, and high-quality literary translation while preserving the original style, formatting, and tone.
Within each paragraph, ensure all translated sentences are separated by a standard English space (e.g. '. ', '! ', '? ') and never merge or squish sentences together without spaces. Preserve the paragraph architecture exactly.

${glossaryInstructions}

Input format:
You will receive a JSON array of strings, where each string represents a paragraph from the novel.

Output format:
You MUST return a JSON array of strings of the EXACT same length as the input array.
Each element in the output array must correspond to the translation of the matching element in the input array.
Do not add any explanations, markdown code blocks, or extra text. Return only the raw JSON array. Example: ["translation 1", "translation 2"]`;
  }

  const body = {
    model: model,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: JSON.stringify(paragraphs)
      }
    ],
    temperature: temperature,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/Crimson5775/novel-translator',
      'X-Title': 'Aura Novel Translator'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.choices?.[0]?.message?.content;
  if (!textResponse) throw new Error('Invalid response format from OpenRouter API.');

  try {
    const parsedData = JSON.parse(textResponse.trim());

    if (extractEntities) {
      if (typeof parsedData !== 'object' || !Array.isArray(parsedData.translations)) {
        throw new Error('Response is not a valid JSON object with translations array.');
      }
      const translations = parsedData.translations;
      const extractedCharacters = Array.isArray(parsedData.extractedCharacters) ? parsedData.extractedCharacters : [];
      
      // Align translations length
      let alignedTranslations = translations;
      if (translations.length !== paragraphs.length) {
        console.warn(`OpenRouter returned ${translations.length} translations but we sent ${paragraphs.length}. Aligning...`);
        if (translations.length < paragraphs.length) {
          alignedTranslations = [...translations, ...Array(paragraphs.length - translations.length).fill('')];
        } else {
          alignedTranslations = translations.slice(0, paragraphs.length);
        }
      }

      return {
        translations: alignedTranslations,
        extractedCharacters: extractedCharacters
      };
    } else {
      if (!Array.isArray(parsedData)) {
        throw new Error('Response is not a JSON array.');
      }
      if (parsedData.length !== paragraphs.length) {
        console.warn(`OpenRouter returned ${parsedData.length} items but we sent ${paragraphs.length}. Attempting alignment...`);
        if (parsedData.length < paragraphs.length) {
          return [...parsedData, ...Array(paragraphs.length - parsedData.length).fill('')];
        } else {
          return parsedData.slice(0, paragraphs.length);
        }
      }
      return parsedData;
    }
  } catch (parseErr) {
    console.error('Failed to parse OpenRouter JSON response:', textResponse, parseErr);
    throw new Error('OpenRouter API did not return a valid JSON format. Response: ' + textResponse.substring(0, 100));
  }
}

/**
 * Scans original text paragraphs and extracts characters and key terms using OpenRouter.
 */
export async function extractGlossaryFromTextWithOpenRouter(paragraphs, apiKey, model = 'google/gemini-2.5-flash', sourceLang, targetLang) {
  if (!apiKey) throw new Error('OpenRouter API key is required.');
  if (paragraphs.length === 0) return { extractedCharacters: [] };

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const systemPrompt = `You are an expert glossary extraction AI. Your task is to scan the provided novel paragraphs in the original language (${sourceLang}) and extract glossary terms, focusing primarily on characters (people) and key terms.
Identify the character's name in the source language, translate it accurately to ${targetLang}, and determine their gender based on context.

Output format:
You MUST return a JSON object with exactly one key:
- "extractedCharacters": A JSON array of characters and terms. For each entry, include:
  - "sourceName": The name or term in the source language (e.g. Chinese characters).
  - "targetName": The translated name or term in ${targetLang} (e.g. English).
  - "gender": The gender of the character. MUST be exactly one of: "male", "female", or "unknown". If it is a key term, location, or organization (not a person), use "unknown".
  - "category": Either "character" (for people) or "general" (for locations, terms, objects).

Do not include any explanation or markdown formatting. Return only the raw JSON.`;

  const body = {
    model: model,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: JSON.stringify(paragraphs)
      }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/Crimson5775/novel-translator',
      'X-Title': 'Aura Novel Translator'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.choices?.[0]?.message?.content;
  if (!textResponse) throw new Error('Invalid response format from OpenRouter API.');

  try {
    const parsedData = JSON.parse(textResponse.trim());
    return {
      extractedCharacters: Array.isArray(parsedData.extractedCharacters) ? parsedData.extractedCharacters : []
    };
  } catch (parseErr) {
    console.error('Failed to parse OpenRouter glossary response:', textResponse, parseErr);
    throw new Error('OpenRouter API did not return a valid JSON format.');
  }
}

