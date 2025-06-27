const { App } = require("@slack/bolt");
var path = require("path");
var fs = require("fs");
const llog = require("learninglab-log");
const handleMessages = require("./src/handlers/message-handler");
const { startTranscriber } = require("./src/bots/transcriber");
const errorLogger = require("./src/utils/error-logger");
global.ROOT_DIR = path.resolve(__dirname);

require("dotenv").config({
  path: path.resolve(__dirname, `.env.${process.env.NODE_ENV}`),
});

// Set up global error handlers at the very start
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');

process.on('uncaughtException', (err) => {
  console.error('[APP] 💥 UNCAUGHT EXCEPTION:', err.message);
  console.error('[APP] 💥 STACK:', err.stack);
  errorLogger.logError(err, 'APP-UNCAUGHT-EXCEPTION');
  process.exit(1); // For startup errors, we should exit
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[APP] 💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  errorLogger.logError(reason, 'APP-UNHANDLED-REJECTION');
  process.exit(1); // For startup errors, we should exit
});

let app;
try {
  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    port: process.env.PORT || 3000,
  });
  console.log('[APP] ✅ Slack app initialized successfully');
} catch (initError) {
  console.error('[APP] ❌ Failed to initialize Slack app:', initError.message);
  errorLogger.logError(initError, 'APP-SLACK-INIT-ERROR');
  process.exit(1);
}


app.message("testing testing", handleMessages.testing);
app.message(/.*/, handleMessages.parseAll);

(async () => {
  try {
    if (!fs.existsSync("_temp")) {
      fs.mkdirSync("_temp");
    }
    if (!fs.existsSync("_output")) {
      fs.mkdirSync("_output");
    }
    
    console.log('[APP] 🚀 Starting Slack app...');
    await app.start(process.env.PORT || 3000);
    llog.yellow("⚡️ Bolt app is running!");
    
    console.log('[APP] 📤 Sending startup message to Slack...');
    let slackResult = await app.client.chat.postMessage({
      channel: process.env.SLACK_LOGGING_CHANNEL,
      text: "starting up the s25-interview-bot",
    });

    console.log('[APP] 🎤 Starting transcriber...');
    startTranscriber(app.client);
    llog.green("🎤 Transcriber started!");
  } catch (startupError) {
    console.error('[APP] ❌ Startup error:', startupError.message);
    console.error('[APP] ❌ Stack:', startupError.stack);
    errorLogger.logError(startupError, 'APP-STARTUP-ERROR');
    process.exit(1);
  }
})();
