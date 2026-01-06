/**
 * Base translator interface
 */
class Translator {
  /**
   * Translate text
   * @param {string} text - text to translate
   * @param {string} sourceLang - source language code (e.g., 'zh')
   * @param {string} targetLang - target language code (e.g., 'en')
   * @returns {Promise<string>} translated text
   */
  // eslint-disable-next-line no-unused-vars
  async translate(text, sourceLang, targetLang) {
    throw new Error('translate() not implemented');
  }
}

module.exports = Translator;


