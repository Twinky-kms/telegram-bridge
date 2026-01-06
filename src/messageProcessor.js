/**
 * Message processor for formatting messages before forwarding
 * Supports optional translation.
 */
class MessageProcessor {
  constructor(options = {}) {
    this.translator = options.translator || null;
    this.config = options.config;
    this.logger = options.logger;
  }

  /**
   * Process a BridgeMessage into a formatted string ready to send
   * @param {Object} bridgeMessage - The normalized message object
   * @returns {Promise<string>} - Formatted message text
   */
  async process(bridgeMessage) {
    const { author, text, replyToId } = bridgeMessage;

    const authorDisplay = author || 'Unknown';

    let outputText = text;
    const translationEnabled = this.config?.getTranslationEnabled();
    if (translationEnabled && this.translator) {
      if (this.logger) {
        this.logger.info(`Attempting translation for message ${bridgeMessage.id}`, {
          textLength: text.length,
          sourceLang: this.config.getTranslationSourceLang(),
          targetLang: this.config.getTranslationTargetLang(),
          textPreview: text.substring(0, 50),
        });
      }
      try {
        outputText = await this.translator.translate(
          text,
          this.config.getTranslationSourceLang(),
          this.config.getTranslationTargetLang()
        );
        if (this.logger) {
          this.logger.info(`Translation successful for message ${bridgeMessage.id}`, {
            originalLength: text.length,
            translatedLength: outputText.length,
            translatedPreview: outputText.substring(0, 50),
          });
        }
      } catch (error) {
        if (this.logger) {
          this.logger.warn(`Translation failed for message ${bridgeMessage.id}: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            textPreview: text.substring(0, 50),
          });
        }
        outputText = text;
      }
    } else {
      if (this.logger) {
        const reason = !translationEnabled 
          ? 'translation is disabled in config' 
          : !this.translator 
            ? 'translator is null (translation may not be enabled at startup)' 
            : 'unknown reason';
        this.logger.info(`Translation skipped for message ${bridgeMessage.id}: ${reason} (translationEnabled=${translationEnabled}, hasTranslator=${!!this.translator})`);
      }
    }

    let formattedText = `[From CN] ${authorDisplay}: ${outputText}`;

    if (this.config?.getTranslationShowOriginal() && this.config?.getTranslationEnabled()) {
      formattedText = `${formattedText}\nOriginal: ${text}`;
    }

    if (replyToId) {
      formattedText = `Replying to message ${replyToId}\n${formattedText}`;
    }

    return formattedText;
  }

  /**
   * Check if a message should be processed
   * @param {Object} bridgeMessage - The message to check
   * @returns {boolean} - True if message should be processed
   */
  shouldProcess(bridgeMessage) {
    return bridgeMessage && bridgeMessage.text && bridgeMessage.text.trim().length > 0;
  }
}

module.exports = MessageProcessor;

