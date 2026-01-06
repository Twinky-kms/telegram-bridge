const fetch = require('node-fetch');
const Translator = require('../translator');

/**
 * Google Cloud Translation (v2 HTTP API)
 */
class GoogleTranslator extends Translator {
  constructor(config, logger) {
    super();
    this.apiKey = config.getGoogleTranslateApiKey();
    this.defaultSourceLang = config.getTranslationSourceLang();
    this.defaultTargetLang = config.getTranslationTargetLang();
    this.maxTextLength = config.getTranslationMaxLength();
    this.logger = logger;
  }

  /**
   * Check if text contains Chinese characters
   */
  containsChinese(text) {
    // Unicode ranges for Chinese characters
    const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    return chineseRegex.test(text);
  }

  /**
   * Split text into segments of Chinese and non-Chinese parts
   * Returns array of {text, isChinese} objects
   */
  splitIntoSegments(text) {
    const segments = [];
    const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    
    let currentSegment = '';
    let currentIsChinese = null;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isChinese = chineseRegex.test(char);
      
      // Start a new segment when language type changes
      if (currentIsChinese !== null && currentIsChinese !== isChinese) {
        segments.push({ text: currentSegment, isChinese: currentIsChinese });
        currentSegment = '';
      }
      
      currentSegment += char;
      currentIsChinese = isChinese;
    }
    
    // Add the last segment
    if (currentSegment) {
      segments.push({ text: currentSegment, isChinese: currentIsChinese });
    }
    
    return segments;
  }

  /**
   * Translate using Google Cloud Translation API (v2)
   */
  async translate(text, sourceLang, targetLang) {
    if (!this.apiKey) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY is not set');
    }

    const safeText = text || '';
    if (!safeText.trim()) {
      return safeText;
    }

    const finalSourceLang = sourceLang || this.defaultSourceLang;
    const finalTargetLang = targetLang || this.defaultTargetLang;
    
    // Check if message contains Chinese
    if (!this.containsChinese(safeText)) {
      // No Chinese text, return as-is
      return safeText;
    }
    
    // Split into segments (Chinese vs non-Chinese)
    const segments = this.splitIntoSegments(safeText);
    
    // Translate only Chinese segments, keep others as-is
    const translatedSegments = [];
    for (const segment of segments) {
      if (segment.isChinese) {
        // Translate Chinese segments
        const translated = await this.translateChunk(
          segment.text,
          finalSourceLang,
          finalTargetLang
        );
        translatedSegments.push(translated);
      } else {
        // Keep non-Chinese segments as-is
        translatedSegments.push(segment.text);
      }
    }
    
    const result = translatedSegments.join('');
    
    if (this.logger && this.logger.debug) {
      this.logger.debug('Translation complete', {
        originalLength: safeText.length,
        translatedLength: result.length,
        segmentsCount: segments.length,
        translatedPreview: result.substring(0, 100),
      });
    }

    return result;
  }

  async translateChunk(text, sourceLang, targetLang) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;
    const body = {
      q: text,
      target: targetLang,
      format: 'text',
    };

    if (sourceLang) {
      body.source = sourceLang;
    }

    if (this.logger && this.logger.debug) {
      this.logger.debug('Sending translation request', {
        url: url.replace(this.apiKey, '***'),
        targetLang,
        sourceLang: sourceLang || 'auto',
        textLength: text.length,
      });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        if (this.logger && this.logger.error) {
          this.logger.error('Google translate API error', {
            status: response.status,
            statusText: response.statusText,
            response: responseText,
          });
        }
        throw new Error(`Google translate failed: ${response.status} ${responseText}`);
      }

      let json;
      try {
        json = JSON.parse(responseText);
      } catch (parseError) {
        if (this.logger && this.logger.error) {
          this.logger.error('Failed to parse Google translate response', {
            responseText,
            error: parseError.message,
          });
        }
        throw new Error(`Invalid JSON response from Google translate: ${parseError.message}`);
      }

      const translatedText = json?.data?.translations?.[0]?.translatedText;
      if (!translatedText) {
        if (this.logger && this.logger.error) {
          this.logger.error('Google translate returned unexpected format', {
            response: json,
          });
        }
        throw new Error('Google translate returned no result');
      }

      return translatedText;
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error('Translation chunk failed', {
          error: error.message,
          stack: error.stack,
          textLength: text.length,
        });
      }
      throw error;
    }
  }

  /**
   * Split long text into chunks within API limits
   */
  splitIntoChunks(text, maxLength) {
    if (!maxLength || text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + maxLength, text.length);
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  }
}

module.exports = GoogleTranslator;


