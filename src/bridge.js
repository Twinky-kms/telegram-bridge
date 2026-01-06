const MessageProcessor = require('./messageProcessor');

/**
 * Bridge orchestrator that wires everything together
 */
class Bridge {
  constructor(config, telegramClient, translator, logger) {
    this.config = config;
    this.telegramClient = telegramClient;
    this.logger = logger;
    this.messageProcessor = new MessageProcessor({
      translator,
      config,
      logger,
    });
    this.processedMessageIds = new Set();
    this.pendingMessages = new Map();
    this.deletedMessageIds = new Set();
    this.messageDelayMs = config.getMessageDelayMs() || 30000;
  }

  /**
   * Normalize a Telegram message into a BridgeMessage
   * @param {Object} ctx - Telegraf context object
   * @returns {Object|null} - Normalized BridgeMessage or null if invalid
   */
  normalizeMessage(ctx) {
    const message = ctx.message;

    if (message) {
      this.logger.info('Received message update:', {
        chatId: String(message.chat?.id),
        chatType: message.chat?.type,
        chatTitle: message.chat?.title,
        chatUsername: message.chat?.username,
        hasText: !!message.text,
        messageId: message.message_id,
        textPreview: message.text ? message.text.substring(0, 30) : 'no text',
      });
    }

    if (!message || !message.text) {
      if (message && !message.text) {
        this.logger.debug('Skipping non-text message (media/service message)');
      }
      return null;
    }

    if (message.from && message.from.is_bot) {
      this.logger.debug('Skipping bot message', {
        botId: message.from.id,
        botUsername: message.from.username,
        messageId: message.message_id,
      });
      return null;
    }

    const sourceChatId = this.config.getSourceChatId();
    const messageChatId = String(message.chat.id);

    const chatIdMatches = messageChatId === sourceChatId;
    const usernameMatches = message.chat.username && message.chat.username === sourceChatId.replace('@', '');
    
    this.logger.info('Checking chat ID match:', {
      sourceChatId,
      messageChatId,
      messageChatUsername: message.chat.username || 'none',
      chatIdMatches,
      usernameMatches,
      willProcess: chatIdMatches || usernameMatches,
    });

    if (!chatIdMatches && !usernameMatches) {
      this.logger.info('Message filtered: not from source chat');
      return null;
    }

    let author = 'Unknown';
    if (message.from) {
      if (message.from.first_name || message.from.last_name) {
        author = [message.from.first_name, message.from.last_name]
          .filter(Boolean)
          .join(' ');
      } else if (message.from.username) {
        author = `@${message.from.username}`;
      }
    }

    let replyToId = null;
    if (message.reply_to_message) {
      replyToId = message.reply_to_message.message_id;
    }

    return {
      id: message.message_id,
      chatId: messageChatId,
      author: author,
      text: message.text,
      replyToId: replyToId,
      timestamp: message.date,
    };
  }

  /**
   * Handle an incoming Telegram update
   * @param {Object} ctx - Telegraf context object
   */
  async handleUpdate(ctx) {
    try {
      const bridgeMessage = this.normalizeMessage(ctx);
      if (!bridgeMessage) {
        this.logger.info('Message filtered out during normalization (not from source chat or no text)');
        return;
      }

      this.logger.info('Processing message:', {
        id: bridgeMessage.id,
        author: bridgeMessage.author,
        textPreview: bridgeMessage.text.substring(0, 50),
      });

      const messageKey = `${bridgeMessage.chatId}:${bridgeMessage.id}`;
      if (this.processedMessageIds.has(messageKey)) {
        this.logger.info(`Skipping duplicate message: ${messageKey}`);
        return;
      }

      if (!this.messageProcessor.shouldProcess(bridgeMessage)) {
        this.logger.info(`Skipping message ${bridgeMessage.id}: no processable content`);
        return;
      }

      const formattedText = await this.messageProcessor.process(bridgeMessage);

      this.queueMessage(messageKey, bridgeMessage, formattedText);
    } catch (error) {
      this.logger.error('Error handling update:', {
        error: error.message,
        stack: error.stack,
      });

      if (this.isRetryableError(error)) {
        this.logger.warn('Retryable error detected, will retry on next update');
      }
    }
  }

  /**
   * Mark a message as deleted and cancel any pending send
   * @param {string} messageKey - The message key to mark as deleted
   */
  markMessageAsDeleted(messageKey) {
    this.deletedMessageIds.add(messageKey);
    
    if (this.pendingMessages.has(messageKey)) {
      const pending = this.pendingMessages.get(messageKey);
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(messageKey);
      this.logger.info(`Cancelled pending message ${messageKey} due to deletion`);
    }
  }

  /**
   * Queue a message to be sent after delay
   * @param {string} messageKey - Unique message key
   * @param {Object} bridgeMessage - The normalized message
   * @param {string} formattedText - The formatted text to send
   */
  queueMessage(messageKey, bridgeMessage, formattedText) {
    this.logger.info(`Queueing message ${bridgeMessage.id} with ${this.messageDelayMs}ms delay`);

    const timeout = setTimeout(async () => {
      try {
        if (this.deletedMessageIds.has(messageKey)) {
          this.logger.info(`Skipping message ${bridgeMessage.id} - it was deleted`);
          this.pendingMessages.delete(messageKey);
          return;
        }

        const chatId = bridgeMessage.chatId;
        try {
          const messageExists = await this.telegramClient.checkMessageExists(chatId, bridgeMessage.id);
          if (!messageExists) {
            this.logger.info(`Skipping message ${bridgeMessage.id} - message was deleted`);
            this.markMessageAsDeleted(messageKey);
            return;
          }
        } catch (error) {
          this.logger.error(`Unexpected error verifying message ${bridgeMessage.id} exists: ${error.message}`);
        }

        this.logger.info(`Forwarding message ${bridgeMessage.id} from ${bridgeMessage.author} (after delay)`);
        
        let sentMessage;
        try {
          sentMessage = await this.telegramClient.sendMessage(formattedText, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          if (error.message && error.message.includes('parse')) {
            this.logger.warn(`Markdown parsing failed for message ${bridgeMessage.id}, sending as plain text`);
            sentMessage = await this.telegramClient.sendMessage(formattedText);
          } else {
            throw error;
          }
        }

        this.processedMessageIds.add(messageKey);
        this.pendingMessages.delete(messageKey);

        this.logger.info(`Successfully forwarded message ${bridgeMessage.id} -> ${sentMessage.message_id}`, {
          sourceMessageId: bridgeMessage.id,
          destinationMessageId: sentMessage.message_id,
          author: bridgeMessage.author,
        });

        if (this.processedMessageIds.size > 1000) {
          const idsArray = Array.from(this.processedMessageIds);
          this.processedMessageIds = new Set(idsArray.slice(-1000));
        }

        // Clean up old deleted message IDs (keep last 1000)
        if (this.deletedMessageIds.size > 1000) {
          const idsArray = Array.from(this.deletedMessageIds);
          this.deletedMessageIds = new Set(idsArray.slice(-1000));
        }
      } catch (error) {
        this.logger.error('Error sending queued message:', {
          messageId: bridgeMessage.id,
          error: error.message,
          stack: error.stack,
        });
        this.pendingMessages.delete(messageKey);
      }
    }, this.messageDelayMs);

    // Store pending message
    this.pendingMessages.set(messageKey, {
      timeout,
      bridgeMessage,
      formattedText,
    });
  }

  /**
   * Check if an error is retryable (transient network/API errors)
   * @param {Error} error - The error to check
   * @returns {boolean} - True if error is retryable
   */
  isRetryableError(error) {
    const retryablePatterns = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'rate limit',
      'Too Many Requests',
      'timeout',
    ];

    const errorMessage = error.message || '';
    return retryablePatterns.some(pattern =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Start the bridge
   */
  async start() {
    this.logger.info('Starting Telegram bridge...');
    const sourceChatId = this.config.getSourceChatId();
    const destinationChatId = this.config.getDestinationChatId();
    this.logger.info(`Source Chat ID: ${sourceChatId}`);
    this.logger.info(`Destination Chat ID: ${destinationChatId}`);
    this.telegramClient.initialize();
    await this.telegramClient.start((ctx) => this.handleUpdate(ctx));
  }

  /**
   * Stop the bridge
   */
  async stop() {
    this.logger.info('Stopping Telegram bridge...');
    
    for (const [messageKey, pending] of this.pendingMessages.entries()) {
      clearTimeout(pending.timeout);
      this.logger.info(`Cleared pending message: ${messageKey}`);
    }
    this.pendingMessages.clear();
    
    await this.telegramClient.stop();
  }
}

module.exports = Bridge;

