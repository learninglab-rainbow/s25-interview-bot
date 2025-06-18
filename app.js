const { App } = require("@slack/bolt");
var path = require("path");
var fs = require("fs");
const llog = require("learninglab-log");
const handleMessages = require("./src/handlers/message-handler");
const { startTranscriber } = require("./src/bots/transcriber");
global.ROOT_DIR = path.resolve(__dirname);

require("dotenv").config({
  path: path.resolve(__dirname, `.env.${process.env.NODE_ENV}`),
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});


app.message("testing testing", handleMessages.testing);
app.message(/.*/, handleMessages.parseAll);

(async () => {

  if (!fs.existsSync("_temp")) {
    fs.mkdirSync("_temp");
  }
  if (!fs.existsSync("_output")) {
    fs.mkdirSync("_output");
  }
  await app.start(process.env.PORT || 3000);
  llog.yellow("⚡️ Bolt app is running!");
  let slackResult = await app.client.chat.postMessage({
    channel: process.env.SLACK_LOGGING_CHANNEL,
    text: "starting up the s25-interview-bot",
  });

  startTranscriber(app.client);
  llog.green("🎤 Transcriber started!");
})();
