const result = require('dotenv').config();

/**
 * Configuration loader for the Telegram bridge
 */
class Config {
  constructor() {
    if (result.error) {
      console.warn('Warning: Error loading .env file:', result.error);
    } else if (result.parsed) {
      console.log('Loaded .env file successfully');
    }

    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.sourceChatId = process.env.TELEGRAM_SOURCE_CHAT_ID;
    this.destinationChatId = process.env.TELEGRAM_DESTINATION_CHAT_ID;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);
    this.httpProxy = process.env.HTTP_PROXY || null;
    this.messageDelayMs = parseInt(process.env.MESSAGE_DELAY_MS || '30000', 10);

    this.translationEnabled = this.toBool(process.env.TRANSLATION_ENABLED, false);
    this.translationProvider = process.env.TRANSLATION_PROVIDER || 'google';
    this.translationFallbackProvider = process.env.TRANSLATION_FALLBACK_PROVIDER || 'google';
    this.translationSourceLang = process.env.TRANSLATION_SOURCE_LANG || 'zh';
    this.translationTargetLang = process.env.TRANSLATION_TARGET_LANG || 'en';
    this.translationShowOriginal = this.toBool(process.env.TRANSLATION_SHOW_ORIGINAL, false);
    this.translationMaxLength = parseInt(process.env.TRANSLATION_MAX_LENGTH || '4000', 10);

    this.googleTranslateApiKey = process.env.GOOGLE_TRANSLATE_API_KEY || '';
    this.googleTranslateProjectId = process.env.GOOGLE_TRANSLATE_PROJECT_ID || '';

    console.log('Config loaded:', {
      hasBotToken: !!this.botToken,
      sourceChatId: this.sourceChatId,
      destinationChatId: this.destinationChatId,
      logLevel: this.logLevel,
      translationEnabled: this.translationEnabled,
      translationProvider: this.translationProvider,
      translationFallbackProvider: this.translationFallbackProvider,
    });

    this.validate();
  }

  validate() {
    const required = [
      { key: 'TELEGRAM_BOT_TOKEN', value: this.botToken },
      { key: 'TELEGRAM_SOURCE_CHAT_ID', value: this.sourceChatId },
      { key: 'TELEGRAM_DESTINATION_CHAT_ID', value: this.destinationChatId },
    ];

    const missing = required.filter(({ value }) => !value);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.map(({ key }) => key).join(', ')}`
      );
    }

    const isValidChatId = (chatId) => {
      if (chatId.startsWith('@')) {
        return true;
      }
      const num = Number(chatId);
      return !isNaN(num) && isFinite(num);
    };

    if (!isValidChatId(this.sourceChatId)) {
      throw new Error('TELEGRAM_SOURCE_CHAT_ID must be a numeric ID or channel username (starting with @)');
    }
    if (!isValidChatId(this.destinationChatId)) {
      throw new Error('TELEGRAM_DESTINATION_CHAT_ID must be a numeric ID or channel username (starting with @)');
    }

    if (this.translationEnabled) {
      if (!this.translationProvider) {
        throw new Error('TRANSLATION_PROVIDER must be set when translation is enabled');
      }

      if (this.translationProvider === 'google' && !this.googleTranslateApiKey) {
        console.warn('Warning: GOOGLE_TRANSLATE_API_KEY is not set; Google translation will fail.');
      }
    }
  }

  toBool(value, defaultValue = false) {
    if (value === undefined || value === null) return defaultValue;
    const lowered = String(value).toLowerCase().trim();
    return ['true', '1', 'yes', 'y', 'on'].includes(lowered);
  }

  getBotToken() {
    return this.botToken;
  }

  getSourceChatId() {
    return this.sourceChatId;
  }

  getDestinationChatId() {
    return this.destinationChatId;
  }

  getLogLevel() {
    return this.logLevel;
  }

  getPollIntervalMs() {
    return this.pollIntervalMs;
  }

  getHttpProxy() {
    return this.httpProxy;
  }

  getMessageDelayMs() {
    return this.messageDelayMs;
  }

  getTranslationEnabled() {
    return this.translationEnabled;
  }

  getTranslationProvider() {
    return this.translationProvider;
  }

  getTranslationFallbackProvider() {
    return this.translationFallbackProvider;
  }

  getTranslationSourceLang() {
    return this.translationSourceLang;
  }

  getTranslationTargetLang() {
    return this.translationTargetLang;
  }

  getTranslationShowOriginal() {
    return this.translationShowOriginal;
  }

  getTranslationMaxLength() {
    return this.translationMaxLength;
  }

  getGoogleTranslateApiKey() {
    return this.googleTranslateApiKey;
  }

  getGoogleTranslateProjectId() {
    return this.googleTranslateProjectId;
  }
}

module.exports = Config;

