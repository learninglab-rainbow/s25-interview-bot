const WebSocket = require('ws');
const record = require('node-record-lpcm16');
const Speaker = require('speaker');

function startTranscriber(slackClient) {
  const { OPENAI_API_KEY, SLACK_LOGGING_CHANNEL } = process.env;

  // Create or replace speaker instance
  let speaker = createSpeaker();
  let activeResponse = false;

  function createSpeaker() {
    const sp = new Speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });
    sp.on('error', err => console.log('[RT] Speaker error:', err.message));
    return sp;
  }

  function stopSpeaker() {
    try {
      if (speaker) {
        console.log('[RT] 🛑 CLOSING SPEAKER IMMEDIATELY');
        speaker.close();
      }
    } catch (err) {
      console.log('[RT] Error stopping speaker:', err.message);
    }
  }

  function replaceSpeaker() {
    stopSpeaker();
    speaker = createSpeaker();
  }

  const ws = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
  );

  ws.on('open', () => {
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
        input_audio_noise_reduction: { type: 'near_field' }
      }
    };
    console.log('[RT] sending session config:', JSON.stringify(sessionConfig, null, 2));
    ws.send(JSON.stringify(sessionConfig));
    startMic();
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
      console.error('[RT] Error processing message:', err);
    }
  });

  function handleEvent(evt) {

    // Transcript deltas
    if (evt.type === 'conversation.item.input_audio_transcription.delta') {
      process.stdout.write(evt.delta);
    }
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      console.log();
      console.log('[RT] >>', evt.transcript);
      slackClient.chat.postMessage({ channel: SLACK_LOGGING_CHANNEL, text: evt.transcript }).catch(console.error);
    }

    // Audio playback
    if (evt.type === 'response.audio.delta') {
      activeResponse = true;
      const audioBuffer = Buffer.from(evt.delta, 'base64');
      if (speaker && speaker.writable) {
        try {
          speaker.write(audioBuffer);
        } catch (err) {
          console.log('[RT] Speaker write error:', err.message);
          replaceSpeaker();
        }
      }
    }

    // Handle interruption and cancellation
    if (evt.type === 'input_audio_buffer.speech_started') {
      console.log('[RT] User started speaking - interrupting audio');
      if (activeResponse) {
        ws.send(JSON.stringify({ type: 'response.cancel' }));
      }
      replaceSpeaker();
    }
    if (evt.type === 'response.cancelled') {
      console.log('[RT] Response cancelled - stopping audio');
      activeResponse = false;
      replaceSpeaker();
    }

    // Audio stream finished - let buffer drain naturally
    if (evt.type === 'response.audio.done') {
      console.log('[RT] Audio stream done - letting speaker buffer drain');
    }

    // Bot response transcript completed
    if (evt.type === 'response.audio_transcript.done') {
      console.log('[RT] Bot response:', evt.transcript);
      slackClient.chat.postMessage({
        channel: SLACK_LOGGING_CHANNEL,
        text: evt.transcript,
        username: 'Interview Bot',
        icon_url: 'https://files.slack.com/files-pri/T0HTW3H0V-F093R1ZR9SL/bot-interviewer-01.jpg?pub_secret=662af05676'
      }).catch(err => {
        console.error('[RT] Slack API Error:', err);
        // Try fallback without custom username/icon
        slackClient.chat.postMessage({
          channel: SLACK_LOGGING_CHANNEL,
          text: `🤖 ${evt.transcript}`
        }).catch(console.error);
      });
    }

    // Final response event (no audio control)
    if (evt.type === 'response.done') {
      console.log('[RT] Response completed');
      activeResponse = false;
    }
  }

  ws.on('close', (code, reason) => console.error(`socket closed ${code} – ${reason}`));
  ws.on('error', err => console.error(err));

  function startMic() {
    const mic = record.record({ 
      sampleRate: 16000, 
      channels: 1, 
      audioType: 'raw', 
      endOnSilence: false,
      highWaterMark: 1024 * 16
    }).stream();
    mic.on('data', buf => {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: buf.toString('base64') }));
    });
    mic.on('error', err => console.error('mic error', err));
    console.log('[RT] mic started');
  }
}

module.exports = { startTranscriber };
