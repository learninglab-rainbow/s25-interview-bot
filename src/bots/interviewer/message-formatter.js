const llog = require('learninglab-log');

const formatMessagesForAI = (messages) => {
    const formattedMessages = messages
        .filter(msg => msg.text && !msg.subtype) // Filter out bot messages and messages without text
        .reverse() // Reverse to get chronological order
        .map(msg => {
            const user = msg.user || 'Unknown User';
            const text = msg.text.replace(/<@[^>]+>/g, '@user'); // Replace user mentions
            return `**${user}**: ${text}`;
        });
    llog.magenta('Formatted context:', formattedMessages.join('\n\n'));
    return `## Channel Context\n\n${formattedMessages.join('\n\n')}`;
};

module.exports = { formatMessagesForAI };