const llog = require('learninglab-log');
const { getChannelHistory } = require('./channel-utils');
const { formatMessagesForAI } = require('./message-formatter');
const interviewAssistant = require('./interview-assistant');
const { postInterviewQuestion } = require('./main-interviewer');

module.exports = async ({ client, message, say, event }) => {
    try {
        // Log the incoming message
        llog.cyan('Interview bot processing message:', message);
        const previousMessages = await getChannelHistory(client, message.channel, message.ts, 20);
        llog.yellow(`Retrieved ${previousMessages.length} previous messages`);
        const formattedContext = formatMessagesForAI(previousMessages);
        const suggestedQuestion = await interviewAssistant(formattedContext, message);
        const postResult = await postInterviewQuestion(client, suggestedQuestion, message)
        return { success: true, postResult};
    } catch (error) {
        llog.red('Error in interview bot:', error);
        return { success: false, error: error.message };
    }
};