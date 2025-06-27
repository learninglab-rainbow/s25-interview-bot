const fs = require('fs');
const path = require('path');

class ErrorLogger {
  constructor() {
    this.logsDir = path.join(process.cwd(), 'logs');
    this.startTime = new Date();
    this.currentLogFile = null;
    this.lastHour = null;
    this.ensureLogsDir();
    this.updateLogFile();
    
    // Set up hourly rotation
    setInterval(() => {
      this.updateLogFile();
    }, 60 * 60 * 1000); // Check every hour
  }

  ensureLogsDir() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create logs directory:', error);
    }
  }

  updateLogFile() {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Create new log file if hour changed or first time
    if (this.lastHour !== currentHour || !this.currentLogFile) {
      const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];
      const filename = `errors-${timestamp}.log`;
      this.currentLogFile = path.join(this.logsDir, filename);
      this.lastHour = currentHour;
      
      // Log the start of a new session
      const startEntry = `\n=== ERROR LOG SESSION STARTED: ${now.toISOString()} ===\n`;
      try {
        fs.appendFileSync(this.currentLogFile, startEntry);
        console.log(`[ErrorLogger] New error log file: ${filename}`);
      } catch (error) {
        console.error('Failed to create new log file:', error);
      }
    }
  }

  logError(error, context = '', slackClient = null) {
    const timestamp = new Date().toISOString();
    
    // Handle different error types
    let errorMessage, errorStack, errorType;
    if (error instanceof Error) {
      errorMessage = error.message;
      errorStack = error.stack;
      errorType = error.name;
    } else if (typeof error === 'string') {
      errorMessage = error;
      errorStack = 'No stack trace available';
      errorType = 'String Error';
    } else {
      errorMessage = JSON.stringify(error);
      errorStack = 'No stack trace available';
      errorType = 'Unknown Error';
    }

    const logEntry = `[${timestamp}] ${context ? `[${context}] ` : ''}ERROR: ${errorMessage}\nType: ${errorType}\nStack: ${errorStack}\n${'='.repeat(80)}\n`;
    
    try {
      // Ensure we have a current log file
      if (!this.currentLogFile) {
        this.updateLogFile();
      }
      
      fs.appendFileSync(this.currentLogFile, logEntry);
      console.log(`[ErrorLogger] Error logged to: ${path.basename(this.currentLogFile)}`);
      
      // Send to Slack in debug mode
      if (process.env.DEBUG_MODE === 'true' && slackClient && process.env.SLACK_LOGGING_CHANNEL) {
        this.sendErrorToSlack(slackClient, errorMessage, context, errorType, timestamp);
      }
    } catch (writeError) {
      console.error('Failed to write to error log:', writeError);
      // Try to write to a fallback file
      try {
        const fallbackFile = path.join(this.logsDir, 'fallback-errors.log');
        fs.appendFileSync(fallbackFile, `FALLBACK LOG: ${logEntry}`);
      } catch (fallbackError) {
        console.error('Failed to write to fallback log:', fallbackError);
      }
    }
  }

  async sendErrorToSlack(slackClient, errorMessage, context, errorType, timestamp) {
    try {
      const slackMessage = `🚨 **DEBUG MODE ERROR** 🚨
**Time:** ${timestamp}
**Context:** ${context || 'Unknown'}
**Type:** ${errorType}
**Message:** ${errorMessage}
**Log File:** ${path.basename(this.currentLogFile)}`;

      await slackClient.chat.postMessage({
        channel: process.env.SLACK_LOGGING_CHANNEL,
        text: slackMessage,
        username: 'Error Logger',
        icon_emoji: ':warning:'
      });
      console.log('[ErrorLogger] Error sent to Slack');
    } catch (slackError) {
      console.error('[ErrorLogger] Failed to send error to Slack:', slackError.message);
    }
  }

  // Wrapper for console.error that also logs to file
  error(message, context = '') {
    console.error(message);
    this.logError(new Error(message), context);
  }
}

const errorLogger = new ErrorLogger();

module.exports = errorLogger;