const WebSocket = require('ws');
const record = require('node-record-lpcm16');
const Speaker = require('speaker');
const errorLogger = require('../../utils/error-logger');
const conversationMemory = require('../../utils/conversation-memory');

const INITIAL_INSTRUCTIONS = "You are an AI interviewer interviewing another AI about the way it works. There is one quirk you have though--no matter what happens, you will keep trying to bring the conversation back to cats. You are really fixated on cats, but otherwise a an intelligent and highly philosophical and introspective dialogue partner.";

function startTranscriber(slackClient) {
  const { OPENAI_API_KEY, SLACK_LOGGING_CHANNEL } = process.env;

  // Add process-level error handlers - LOG BUT DON'T CRASH
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  
  process.on('uncaughtException', (err) => {
    console.error('[RT] 💥 UNCAUGHT EXCEPTION (CONTINUING):', err.message);
    console.error('[RT] 💥 UNCAUGHT EXCEPTION STACK:', err.stack);
    console.error('[RT] 💥 Speaker state at exception - exists:', !!speaker, 'writable:', speaker?.writable, 'destroyed:', speaker?.destroyed);
    errorLogger.logError(err, 'RT-UNCAUGHT-EXCEPTION', slackClient);
    // FORCE CONTINUE - DO NOT EXIT
    return; // Don't call process.exit()
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[RT] 💥 UNHANDLED REJECTION (CONTINUING) at:', promise, 'reason:', reason);
    console.error('[RT] 💥 Speaker state at rejection - exists:', !!speaker, 'writable:', speaker?.writable, 'destroyed:', speaker?.destroyed);
    errorLogger.logError(reason, 'RT-UNHANDLED-REJECTION', slackClient);
    // FORCE CONTINUE - DO NOT EXIT
    return; // Don't call process.exit()
  });

  // Create or replace speaker instance
  let speaker = createSpeaker();
  let activeResponse = false;
  let currentResponseId = null;
  let cancellationSent = false;

  function createSpeaker() {
    console.log('[RT] 🔊 Creating new speaker instance...');
    try {
      const sp = new Speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });
      sp.on('error', err => {
        console.log('[RT] ❌ Speaker error (non-fatal):', err.message);
        console.log('[RT] ❌ Speaker error stack:', err.stack);
        errorLogger.logError(err, 'RT-SPEAKER-ERROR', slackClient);
        // Don't crash on speaker errors
      });
      console.log('[RT] ✅ Speaker created successfully');
      return sp;
    } catch (err) {
      console.log('[RT] ❌ Failed to create speaker (returning null):', err.message);
      console.log('[RT] ❌ Speaker creation stack:', err.stack);
      errorLogger.logError(err, 'RT-SPEAKER-CREATION-FAILED', slackClient);
      return null; // Return null instead of throwing
    }
  }

  function stopSpeaker() {
    try {
      console.log('[RT] 🛑 stopSpeaker() called - Speaker exists:', !!speaker);
      if (speaker) {
        console.log('[RT] 🛑 Speaker state before close - writable:', speaker.writable, 'destroyed:', speaker.destroyed);
        console.log('[RT] 🛑 CLOSING SPEAKER IMMEDIATELY');
        speaker.close();
        console.log('[RT] ✅ Speaker closed successfully');
        speaker = null;
      } else {
        console.log('[RT] ⚠️  No speaker to stop');
      }
    } catch (err) {
      console.log('[RT] ❌ Error stopping speaker:', err.message);
      console.log('[RT] ❌ Speaker stop stack:', err.stack);
      errorLogger.logError(err, 'RT-SPEAKER-STOP-ERROR');
      speaker = null; // Clear reference even on error
      }
  }

  function replaceSpeaker() {
    console.log('[RT] 🔄 replaceSpeaker() called');
    console.log('[RT] 🔄 Current speaker state - exists:', !!speaker, 'writable:', speaker?.writable, 'destroyed:', speaker?.destroyed);
    try {
      stopSpeaker();
      console.log('[RT] 🔄 Creating replacement speaker...');
      speaker = createSpeaker();
      if (speaker) {
        console.log('[RT] ✅ Speaker replacement completed successfully');
      } else {
        console.log('[RT] ⚠️  Speaker replacement failed - continuing without speaker');
      }
    } catch (err) {
      console.log('[RT] ❌ Error during speaker replacement (continuing):', err.message);
      console.log('[RT] ❌ Speaker replacement stack:', err.stack);
      errorLogger.logError(err, 'RT-SPEAKER-REPLACEMENT-ERROR');
      speaker = null; // Ensure clean state
      // Don't throw - continue running
    }
  }

  let ws;
  try {
    ws = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
    );
  } catch (wsError) {
    console.error('[RT] ❌ Failed to create WebSocket:', wsError.message);
    errorLogger.logError(wsError, 'RT-WEBSOCKET-CREATION-ERROR', slackClient);
    return; // Exit function but don't crash app
  }

  ws.on('open', () => {
    try {
      console.log('[RT] socket open');
      const sessionConfig = {
        type: 'session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: {
            type: 'server_vad',
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true
          },
          input_audio_noise_reduction: { type: 'near_field' },
          instructions: INITIAL_INSTRUCTIONS
        }
      };
      console.log('[RT] sending session config:', JSON.stringify(sessionConfig, null, 2));
      ws.send(JSON.stringify(sessionConfig));
      startMic();
    } catch (openError) {
      console.error('[RT] ❌ Error in WebSocket open handler:', openError.message);
      errorLogger.logError(openError, 'RT-WEBSOCKET-OPEN-ERROR', slackClient);
    }
  });

  ws.on('message', raw => {
    try {
      const evt = JSON.parse(raw);
      if (evt.type !== 'response.audio.delta') {
        console.log('[RT] received event:', evt.type, evt);
      } else {
        console.log('[RT] received event: response.audio.delta (audio suppressed)');
      }
      handleEvent(evt);
    } catch (err) {
      console.error('[RT] ❌ Error processing message:', err.message);
      console.error('[RT] ❌ Message processing stack:', err.stack);
      console.error('[RT] ❌ Raw message that caused error:', raw?.toString()?.substring(0, 200));
      errorLogger.logError(err, 'RT-MESSAGE-PROCESSING-ERROR');
      // Don't crash on message processing errors
    }
  });

  function handleEvent(evt) {
    // Handle errors gracefully
    if (evt.type === 'error') {
      console.log('[RT] API Error:', evt.error.message);
      return; // Don't process further
    }

    // Transcript deltas
    if (evt.type === 'conversation.item.input_audio_transcription.delta') {
      process.stdout.write(evt.delta);
    }
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      console.log();
      console.log('[RT] >>', evt.transcript);
      conversationMemory.addMessage('User', evt.transcript);
      slackClient.chat.postMessage({ channel: SLACK_LOGGING_CHANNEL, text: evt.transcript }).catch(console.error);
    }

    // Audio playback
    if (evt.type === 'response.audio.delta') {
      // Only play audio from the current response
      if (evt.response_id === currentResponseId && activeResponse) {
        const audioBuffer = Buffer.from(evt.delta, 'base64');
        console.log('[RT] 🔊 Attempting to write audio - Speaker exists:', !!speaker, 'writable:', speaker?.writable, 'destroyed:', speaker?.destroyed);
        if (speaker && speaker.writable) {
          try {
            speaker.write(audioBuffer);
            console.log('[RT] 🔊 Audio chunk written successfully, size:', audioBuffer.length);
          } catch (err) {
            console.log('[RT] ❌ Speaker write error:', err.message);
            console.log('[RT] ❌ Speaker write stack:', err.stack);
            errorLogger.logError(err, 'RT-SPEAKER-WRITE-ERROR');
            console.log('[RT] 🔄 Attempting speaker replacement due to write error');
            try {
              replaceSpeaker();
            } catch (replaceErr) {
              console.log('[RT] ❌ Failed to replace speaker after write error:', replaceErr.message);
              errorLogger.logError(replaceErr, 'RT-SPEAKER-REPLACE-AFTER-WRITE-ERROR');
            }
          }
        } else {
          console.log('[RT] ⚠️  Skipping audio write - Speaker not available or not writable');
        }
      } else {
        console.log('[RT] ⚠️  Skipping audio - Response mismatch or inactive. Current:', currentResponseId, 'Event:', evt.response_id, 'Active:', activeResponse);
      }
    }

    // Handle interruption and cancellation
    if (evt.type === 'input_audio_buffer.speech_started') {
      console.log('[RT] 🗣️  SPEECH_STARTED EVENT RECEIVED');
      console.log('[RT] 🗣️  Event details:', JSON.stringify(evt, null, 2));
      console.log('[RT] 🗣️  Current state - activeResponse:', activeResponse, 'currentResponseId:', currentResponseId, 'cancellationSent:', cancellationSent);
      console.log('[RT] 🗣️  Speaker state - exists:', !!speaker, 'writable:', speaker?.writable, 'destroyed:', speaker?.destroyed);
      
      if (activeResponse && currentResponseId && !cancellationSent) {
        console.log('[RT] 🚫 Sending response.cancel for responseId:', currentResponseId);
        try {
          ws.send(JSON.stringify({ type: 'response.cancel' }));
          console.log('[RT] ✅ Response cancellation sent successfully');
        } catch (cancelErr) {
          console.log('[RT] ❌ Error sending response.cancel:', cancelErr.message);
          errorLogger.logError(cancelErr, 'RT-RESPONSE-CANCEL-ERROR');
        }
        cancellationSent = true;
        activeResponse = false;
        currentResponseId = null;
      } else {
        console.log('[RT] ⚠️  No active response to cancel');
      }
      
      console.log('[RT] 🔄 About to replace speaker due to speech_started...');
      try {
        replaceSpeaker();
        console.log('[RT] ✅ Speaker replacement completed for speech_started');
      } catch (err) {
        console.log('[RT] ❌ Speaker replacement failed during speech_started (continuing):', err.message);
        console.log('[RT] ❌ Stack trace:', err.stack);
        errorLogger.logError(err, 'RT-SPEAKER-REPLACEMENT-SPEECH-STARTED-ERROR');
        // Don't re-throw - log and continue
      }
    }
    if (evt.type === 'response.cancelled') {
      console.log('[RT] 🚫 Response cancelled - stopping audio');
      console.log('[RT] 🚫 Cancelled response ID:', evt.response_id);
      activeResponse = false;
      currentResponseId = null;
      cancellationSent = false;
      console.log('[RT] 🔄 Replacing speaker due to response cancellation...');
      try {
        replaceSpeaker();
        console.log('[RT] ✅ Speaker replacement completed for response.cancelled');
      } catch (err) {
        console.log('[RT] ❌ Error replacing speaker during cancellation:', err.message);
        console.log('[RT] ❌ Cancellation replacement stack:', err.stack);
        errorLogger.logError(err, 'RT-SPEAKER-REPLACEMENT-CANCELLATION-ERROR');
      }
    }

    // Audio stream finished - let buffer drain naturally
    if (evt.type === 'response.audio.done') {
      console.log('[RT] Audio stream done - letting speaker buffer drain');
    }

    // Track new responses
    if (evt.type === 'response.created') {
      console.log('[RT] 🎯 New response created:', evt.response.id);
      console.log('[RT] 🎯 Previous state - activeResponse:', activeResponse, 'currentResponseId:', currentResponseId);
      activeResponse = true;
      currentResponseId = evt.response.id;
      cancellationSent = false;
      console.log('[RT] 🎯 New response state updated - ID:', currentResponseId);
    }

    // Bot response transcript completed
    if (evt.type === 'response.audio_transcript.done') {
      console.log('[RT] Bot response:', evt.transcript);
      // Only post complete responses from the current response
      if (evt.response_id === currentResponseId && evt.transcript && evt.transcript.trim().length > 0) {
        conversationMemory.addMessage('Bot', evt.transcript);
        try {
          slackClient.chat.postMessage({
            channel: SLACK_LOGGING_CHANNEL,
            text: evt.transcript,
            username: 'Interview Bot',
            icon_url: 'https://files.slack.com/files-pri/T0HTW3H0V-F093R1ZR9SL/bot-interviewer-01.jpg?pub_secret=662af05676'
          }).then(() => {
            console.log('[RT] Bot message posted successfully');
          }).catch(err => {
            console.error('[RT] Slack API Error:', err);
            errorLogger.logError(err, 'RT-SLACK-API-ERROR');
            // Try fallback without custom username/icon
            return slackClient.chat.postMessage({
              channel: SLACK_LOGGING_CHANNEL,
              text: `🤖 ${evt.transcript}`
            });
          }).catch(err => {
            console.error('[RT] Fallback Slack API Error:', err);
            errorLogger.logError(err, 'RT-SLACK-API-FALLBACK-ERROR');
          });
        } catch (err) {
          console.error('[RT] Sync error in Slack posting:', err);
          errorLogger.logError(err, 'RT-SLACK-SYNC-ERROR');
        }
      } else {
        console.log('[RT] Skipping bot response - not current or empty');
      }
    }

    // Final response event (no audio control)
    if (evt.type === 'response.done') {
      console.log('[RT] Response completed');
      // Only clear state if this is the current response
      if (evt.response.id === currentResponseId) {
        activeResponse = false;
        currentResponseId = null;
        cancellationSent = false;
      }
    }
  }

  ws.on('close', (code, reason) => {
    console.error(`[RT] 🔌 WebSocket closed ${code} – ${reason}`);
    errorLogger.logError(new Error(`WebSocket closed: ${code} - ${reason}`), 'RT-WEBSOCKET-CLOSE', slackClient);
    
    // Attempt reconnection after a delay for unexpected closures
    if (code === 1006 || code === 1001 || code === 1011) {
      console.log('[RT] 🔄 Attempting to reconnect in 5 seconds...');
      conversationMemory.markReconnection();
      setTimeout(() => {
        try {
          console.log('[RT] 🔄 Reconnecting transcriber...');
          startTranscriber(slackClient);
        } catch (reconnectError) {
          console.error('[RT] ❌ Reconnection failed:', reconnectError.message);
          errorLogger.logError(reconnectError, 'RT-RECONNECTION-FAILED', slackClient);
        }
      }, 5000);
    }
  });
  ws.on('error', err => {
    console.error('[RT] ❌ WebSocket error:', err.message);
    errorLogger.logError(err, 'RT-WEBSOCKET-ERROR', slackClient);
  });

  function startMic() {
    try {
      console.log('[RT] Starting microphone...');
      const mic = record.record({ 
        sampleRate: 16000, 
        channels: 1, 
        audioType: 'raw', 
        endOnSilence: false,
        highWaterMark: 1024 * 16
      }).stream();
      
      mic.on('data', buf => {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: buf.toString('base64') }));
          }
        } catch (sendError) {
          console.error('[RT] ❌ Error sending audio data:', sendError.message);
          errorLogger.logError(sendError, 'RT-MIC-DATA-SEND-ERROR');
        }
      });
      
      mic.on('error', err => {
        console.error('[RT] ❌ Microphone error:', err.message);
        errorLogger.logError(err, 'RT-MIC-ERROR');
      });
      
      console.log('[RT] ✅ Microphone started successfully');
    } catch (micError) {
      console.error('[RT] ❌ Failed to start microphone:', micError.message);
      errorLogger.logError(micError, 'RT-MIC-START-ERROR');
    }
  }
}

module.exports = { startTranscriber };
