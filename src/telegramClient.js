const { Telegraf } = require('telegraf');

/**
 * Telegram client wrapper for the bridge
 */
class TelegramClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.bot = null;
    this.isRunning = false;
  }

  /**
   * Initialize the Telegram bot
   */
  initialize() {
    const token = this.config.getBotToken();
    const options = {};

    if (this.config.getHttpProxy()) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        options.telegram = {
          agent: new HttpsProxyAgent(this.config.getHttpProxy()),
        };
        this.logger.info('Proxy configured:', this.config.getHttpProxy());
      } catch (error) {
        this.logger.warn('Proxy configured but https-proxy-agent not installed. Install it with: npm install https-proxy-agent');
      }
    }

    this.bot = new Telegraf(token, options);
    this.logger.info('Telegram bot initialized');
  }

  /**
   * Start listening for updates (long polling)
   * @param {Function} onUpdate - Callback function for handling updates
   */
  async start(onUpdate) {
    if (!this.bot) {
      throw new Error('Bot not initialized. Call initialize() first.');
    }

    if (this.isRunning) {
      this.logger.warn('Bot is already running');
      return;
    }

    // IMPORTANT: Telegram bots have "privacy mode" enabled by default.
    // This means they only receive commands (starting with "/") or direct mentions.
    // To receive ALL messages, you MUST disable privacy mode in BotFather:
    // 1. Message @BotFather
    // 2. Send /mybots
    // 3. Select your bot
    // 4. Go to "Bot Settings" -> "Group Privacy" -> Select "Disable"
    // 5. Remove and re-add the bot to your group/channel
    
    this.bot.use(async (ctx, next) => {
      if (ctx.message) {
        console.log('Message received from Telegram:', ctx.message);
        try {
          this.logger.info('Message received from Telegram:', {
            chatId: String(ctx.message?.chat?.id),
            chatType: ctx.message?.chat?.type,
            hasText: !!ctx.message?.text,
            isCommand: ctx.message?.text?.startsWith('/'),
            messageText: ctx.message?.text ? ctx.message.text.substring(0, 50) : 'non-text',
          });
          await onUpdate(ctx);
        } catch (error) {
          this.logger.error('Error handling update:', error);
          this.logger.error('Error stack:', error.stack);
        }
      }
      return next();
    });

    process.once('SIGINT', () => this.stop());
    process.once('SIGTERM', () => this.stop());

    this.logger.info('Verifying bot token...');
    try {
      const me = await this.bot.telegram.getMe();
      this.logger.info(`Bot authenticated as: @${me.username} (${me.first_name})`);
      this.logger.warn('');
      this.logger.warn('⚠️  IMPORTANT: If the bot only receives messages starting with "/",');
      this.logger.warn('   you need to disable Privacy Mode in BotFather:');
      this.logger.warn('   1. Message @BotFather on Telegram');
      this.logger.warn('   2. Send /mybots and select your bot');
      this.logger.warn('   3. Go to "Bot Settings" -> "Group Privacy"');
      this.logger.warn('   4. Select "Disable" to turn off privacy mode');
      this.logger.warn('   5. Remove and re-add the bot to your group/channel');
      this.logger.warn('');
    } catch (error) {
      this.logger.error('Bot authentication failed. Check your TELEGRAM_BOT_TOKEN:', error.message);
      throw new Error(`Invalid bot token: ${error.message}`);
    }

    this.logger.info('Starting bot polling...');
    
    const launchPromise = this.bot.launch({
      polling: {
        timeout: 10,
        limit: 100,
        allowedUpdates: ['message'],
      },
    });

    launchPromise.then(() => {
      this.isRunning = true;
      this.logger.info('Telegram bot started and listening for messages');
    }).catch((error) => {
      this.logger.error('Failed to start bot polling:', error);
      this.logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
      this.isRunning = false;
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      await this.bot.telegram.getMe();
      this.isRunning = true;
      this.logger.info('Telegram bot started and listening for messages');
    } catch (error) {
      this.logger.error('Bot failed to start properly:', error.message);
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Telegram bot...');
    await this.bot.stop();
    this.isRunning = false;
    this.logger.info('Telegram bot stopped');
  }

  /**
   * Send a message to the destination channel
   * @param {string} text - Message text to send
   * @param {Object} options - Additional options (parse_mode, reply_to_message_id, etc.)
   * @returns {Promise<Object>} - The sent message object
   */
  async sendMessage(text, options = {}) {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    const chatId = this.config.getDestinationChatId();
    const maxLength = 4096;

    if (text.length > maxLength) {
      const messages = [];
      let offset = 0;

      while (offset < text.length) {
        const chunk = text.substring(offset, offset + maxLength);
        const message = await this.bot.telegram.sendMessage(chatId, chunk, options);
        messages.push(message);
        offset += maxLength;

        if (offset < text.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return messages[0];
    }

    return await this.bot.telegram.sendMessage(chatId, text, options);
  }

  /**
   * Check if a message still exists in the source channel
   * This method attempts to verify by trying to forward the message.
   * If forwarding fails with "message not found", the message was deleted.
   * @param {string} chatId - Chat ID where the message should be
   * @param {number} messageId - Message ID to check
   * @returns {Promise<boolean>} - True if message exists, false if deleted or inaccessible
   */
  async checkMessageExists(chatId, messageId) {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    try {
      const destinationChatId = this.config.getDestinationChatId();
      
      try {
        const forwardedMessage = await this.bot.telegram.forwardMessage(
          destinationChatId,
          chatId,
          messageId
        );
        
        try {
          await this.bot.telegram.deleteMessage(destinationChatId, forwardedMessage.message_id);
          this.logger.debug(`Verified message ${messageId} exists (test forward deleted)`);
        } catch (deleteError) {
          this.logger.debug(`Could not delete test forward for message ${messageId} (may need delete permission): ${deleteError.message}`);
        }
        
        return true;
      } catch (forwardError) {
        const errorMessage = forwardError.message || '';
        const errorDescription = forwardError.description || '';
        const fullError = (errorMessage + ' ' + errorDescription).toLowerCase();
        
        if (fullError.includes('message to forward not found') ||
            fullError.includes('message not found') ||
            fullError.includes('bad request: message to forward not found') ||
            fullError.includes('message_id_invalid')) {
          this.logger.info(`Message ${messageId} was deleted (forward test failed)`);
          return false;
        }
        
        this.logger.warn(`Error checking message ${messageId} existence: ${errorMessage}`);
        return true;
      }
    } catch (error) {
      this.logger.warn(`Unexpected error checking message ${messageId} existence: ${error.message}`);
      return true; // Assume exists to avoid blocking legitimate messages
    }
  }

  /**
   * Get the bot instance (for advanced usage)
   * @returns {Telegraf} - The Telegraf bot instance
   */
  getBot() {
    return this.bot;
  }
}

module.exports = TelegramClient;

