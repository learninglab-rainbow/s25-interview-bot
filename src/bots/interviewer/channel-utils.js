const llog = require('learninglab-log');

const getChannelHistory = async (client, channel, timestamp, limit = 20) => {
    try {
        const result = await client.conversations.history({
            channel: channel,
            latest: timestamp,
            limit: limit,
            inclusive: false
        });
        return result.messages || [];
    } catch (error) {
        llog.red('Error fetching channel history:', error);
        return [];
    }
};

module.exports = { getChannelHistory };