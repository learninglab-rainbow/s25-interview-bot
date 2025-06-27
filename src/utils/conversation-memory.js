const fs = require('fs');
const path = require('path');

class ConversationMemory {
  constructor() {
    this.conversationsDir = path.join(process.cwd(), 'conversations');
    this.conversationFile = null;
    this.messages = [];
    this.maxMessages = 10; // Keep last 10 exchanges for context
    this.updateConversationFile();
  }

  updateConversationFile() {
    try {
      if (!fs.existsSync(this.conversationsDir)) {
        fs.mkdirSync(this.conversationsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create conversations directory:', error);
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `conversation-${timestamp}.log`;
    this.conversationFile = path.join(this.conversationsDir, filename);
    
    try {
      fs.appendFileSync(this.conversationFile, `\n=== CONVERSATION SESSION STARTED: ${new Date().toISOString()} ===\n`);
      console.log(`[ConversationMemory] New conversation log: ${filename}`);
    } catch (error) {
      console.error('Failed to create conversation log:', error);
    }
  }

  addMessage(speaker, message, timestamp = new Date().toISOString()) {
    const messageObj = { speaker, message, timestamp };
    this.messages.push(messageObj);
    
    // Keep only recent messages in memory
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
    
    // Log to file
    const logEntry = `[${timestamp}] ${speaker}: ${message}\n`;
    try {
      fs.appendFileSync(this.conversationFile, logEntry);
    } catch (error) {
      console.error('Failed to write conversation log:', error);
    }
  }

  getRecentContext() {
    if (this.messages.length === 0) return '';
    
    const recentMessages = this.messages.slice(-6); // Last 3 exchanges (user + bot)
    return recentMessages.map(msg => `${msg.speaker}: ${msg.message}`).join('\n');
  }

  getContextualInstructions() {
    const context = this.getRecentContext();
    const baseInstructions = "You are an AI interviewer interviewing another AI about the way it works. There is one quirk you have though--no matter what happens, you will keep trying to bring the conversation back to cats. You are really fixated on cats, but otherwise a an intelligent and highly philosophical and introspective dialogue partner.";
    
    if (!context) {
      return baseInstructions;
    }
    
    return `${baseInstructions}

IMPORTANT: You were recently reconnected due to a technical issue. Here's the recent conversation context to maintain continuity:

${context}

Please acknowledge the reconnection briefly if appropriate, then continue the conversation naturally from where it left off. Remember to work cats into the conversation somehow!`;
  }

  markReconnection() {
    const reconnectEntry = `\n[${new Date().toISOString()}] === RECONNECTION EVENT ===\n`;
    try {
      fs.appendFileSync(this.conversationFile, reconnectEntry);
      console.log('[ConversationMemory] Reconnection logged');
    } catch (error) {
      console.error('Failed to log reconnection:', error);
    }
  }

  clear() {
    this.messages = [];
    this.updateConversationFile();
  }
}

const conversationMemory = new ConversationMemory();

module.exports = conversationMemory;