const llog = require('learninglab-log');

const postInterviewQuestion = async (client, suggestedQuestion, message) => {
    try {
        if (suggestedQuestion.success) {
            // Post the AI-generated question back to the channel using client
            const result = await client.chat.postMessage({
                channel: message.channel,
                text: suggestedQuestion.question
            });
            
            llog.green('Posted interview question to channel:', suggestedQuestion.question);
            return { success: true, messageTs: result.ts };
        } else {
            llog.red('Failed to generate interview question:', suggestedQuestion.error);
            return { success: false, error: suggestedQuestion.error };
        }
    } catch (error) {
        llog.red('Error posting interview question:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { postInterviewQuestion };