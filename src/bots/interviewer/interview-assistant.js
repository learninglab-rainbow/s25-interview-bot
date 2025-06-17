const llog = require('learninglab-log');
const OpenAI = require('openai');

const createInterviewPrompt = (context, currentMessage) => {
    return `You are an expert interview coach helping to conduct a thoughtful interview conversation. 

${context}

## Most Recent Message
**${currentMessage.user}**: ${currentMessage.text}

Based on the conversation context above and the most recent message, what would be a good follow-up question or response to keep the interview engaging and insightful? 

Consider:
- The flow of conversation and natural transitions
- Opportunities to dig deeper into interesting topics
- Ways to encourage more detailed responses
- Professional interview techniques

Provide a single, well-crafted question or response that an interviewer would ask:`;
};

const interviewAssistant = async (context, message) => {
    try {
        llog.cyan('Interview assistant processing:', {
            user: message.user,
            timestamp: message.ts,
            textPreview: message.text.substring(0, 50) + '...'
        });

        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        // Create formatted prompt with context
        const prompt = createInterviewPrompt(context, message);
        llog.magenta('Created interview prompt with context');

        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "You are an expert interview coach." },
                { role: "user", content: prompt }
            ],
            max_tokens: 500,
        }); 

        const responseText = response.choices[0].message.content.trim();
        llog.green('Generated interview question:', responseText);

        return {
            success: true,
            question: responseText,
            prompt: prompt
        };

    } catch (error) {
        llog.red('Error in interview assistant:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = interviewAssistant;