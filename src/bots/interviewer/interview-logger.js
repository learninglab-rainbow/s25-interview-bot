const llog = require('learninglab-log');
const OpenAI = require('openai');

const interviewLogger = async ({client, message}) => {
    // const openai = new OpenAI({
    //     apiKey: process.env.OPENAI_API_KEY,
    // });
    // const response = await openai.chat.completions.create({
    //     model: "gpt-4",
    //     messages: [
    //         { role: "system", content: "You are an interview assistant." },
    //         { role: "user", content: `please come up with a good question in response to this text:  ${message.text}` }
    //     ],
    //     max_tokens: 3000,
    // }); 

    // const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: process.env.SLACK_LOGGING_CHANNEL,
        text: `received message in ${message.channel}: ${message.text}`,
        // thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Interview Logger",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F0918DFFU4F/rainbow-bot.jpg?pub_secret=6645ba4875"
    });

    return(message.text)

};

module.exports = interviewLogger;