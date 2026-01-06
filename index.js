const Config = require('./src/config');
const TelegramClient = require('./src/telegramClient');
const Bridge = require('./src/bridge');
const { createTranslator } = require('./src/translators/factory');
const winston = require('winston');

// Set up logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'dingo-tele-bridge' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(meta).length > 0 && meta.service !== 'dingo-tele-bridge') {
            msg += ` ${JSON.stringify(meta)}`;
          }
          return msg;
        })
      ),
    }),
  ],
});

// Main function
async function main() {
  try {
    logger.info('Initializing Dingo Tele Bridge...');

    // Load configuration
    const config = new Config();
    logger.info('Configuration loaded successfully');

    // Update logger level from config
    logger.level = config.getLogLevel();

    // Create Telegram client
    const telegramClient = new TelegramClient(config, logger);

    // Create translator (primary + fallback)
    let translator = null;
    if (config.getTranslationEnabled()) {
      logger.info('Translation is enabled');
      translator = createTranslator(config, logger);
      logger.info(`Translation provider: ${config.getTranslationProvider()}, Fallback: ${config.getTranslationFallbackProvider()}`);
    } else {
      logger.info('Translation is DISABLED. Set TRANSLATION_ENABLED=true in your .env file to enable translation.');
    }

    // Create bridge
    const bridge = new Bridge(config, telegramClient, translator, logger);

    // Start the bridge
    await bridge.start();

    logger.info('Dingo Tele Bridge is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
main();

