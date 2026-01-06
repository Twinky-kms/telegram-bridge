const GoogleTranslator = require('./googleTranslator');

/**
 * Wraps primary + fallback translators
 */
class CompositeTranslator {
  constructor(primary, fallback, logger) {
    this.primary = primary;
    this.fallback = fallback;
    this.logger = logger;
  }

  async translate(text, sourceLang, targetLang) {
    if (!this.primary) {
      throw new Error('No primary translator configured');
    }

    try {
      return await this.primary.translate(text, sourceLang, targetLang);
    } catch (primaryErr) {
      this.logger.warn(`Primary translator failed: ${primaryErr.message}`);
      if (this.fallback) {
        try {
          return await this.fallback.translate(text, sourceLang, targetLang);
        } catch (fallbackErr) {
          this.logger.error(`Fallback translator failed: ${fallbackErr.message}`);
          throw fallbackErr;
        }
      }
      throw primaryErr;
    }
  }
}

/**
 * Factory to create translator with primary + fallback
 */
function createTranslator(config, logger) {
  if (!config.getTranslationEnabled()) {
    return null;
  }

  const provider = (config.getTranslationProvider() || '').toLowerCase();
  const fallback = (config.getTranslationFallbackProvider() || '').toLowerCase();

  let primaryTranslator = null;
  let fallbackTranslator = null;

  if (provider === 'google') {
    primaryTranslator = new GoogleTranslator(config, logger);
  }

  if (fallback === 'google') {
    fallbackTranslator = new GoogleTranslator(config, logger);
  }

  if (!primaryTranslator) {
    throw new Error(`Unsupported translation provider: ${provider || 'none'}`);
  }

  return new CompositeTranslator(primaryTranslator, fallbackTranslator, logger);
}

module.exports = {
  createTranslator,
};


