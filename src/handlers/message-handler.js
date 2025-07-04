const llog = require('learninglab-log');
const interviewer = require('../bots/interviewer')

const isBotMessage = (message) => {
    return message.subtype === "bot_message";
};

const isInSubthread = (message) => {
    return message.thread_ts && message.thread_ts !== message.ts;


};

exports.testing = async ({ client, message, say, event }) => {
    llog.cyan("heard testing testing", message);
    let result = await client.chat.postMessage({
        channel: message.channel,
        text: `the s-25 interview bot heard "testing testing" <@${message.user}> at ${message.ts}`,
    });
    return result;
}

exports.parseAll = async ({ client, message, say, event }) => {
    llog.cyan("IN THE MESSAGE HANDLER")
    llog.gray(message);

    // Check if the message is a bot message
    if (isBotMessage(message)) {
        llog.yellow("Skipped: Bot message detected");
        return;
    }

    // Check if the message is in a subthread
    if (isInSubthread(message)) {
        llog.magenta("Message is in a subthread");
        // Add specific logic for subthread messages here if needed
        return;
    }

    if (message.text) {
        if (message.channel==process.env.SLACK_INTERVIEW_TEST_CHANNEL) {
            const result = await interviewer({ client, message, say, event })
        }
        // const result = await bkc({ client, message, say, event })
    } else {
        llog.blue("message has no text")
    }
}

