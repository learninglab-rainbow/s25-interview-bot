const WebSocket = require('ws');
const record = require('node-record-lpcm16');
const Speaker = require('speaker');

function startTranscriber(slackClient) {
  const {
    OPENAI_API_KEY,
    SLACK_LOGGING_CHANNEL
  } = process.env;

  // Create speaker for audio playback
  const speaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000
  });

  const ws = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
    { 
      headers: { 
        Authorization: `Bearer ${OPENAI_API_KEY}`, 
        'OpenAI-Beta': 'realtime=v1' 
      } 
    }
  );

  ws.on('open', () => {
    console.log('[RT] socket open');

    const sessionConfig = {
      type: 'session.update',
      session: {
        input_audio_format: 'pcm16',
        input_audio_transcription: { 
          model: 'gpt-4o-mini-transcribe'
        },
        turn_detection: { type: 'server_vad' },
        input_audio_noise_reduction: { type: 'near_field' }
      }
    };
    
    console.log('[RT] sending session config:', JSON.stringify(sessionConfig, null, 2));
    ws.send(JSON.stringify(sessionConfig));

    startMic();
  });

  ws.on('message', async raw => {
    const evt = JSON.parse(raw);
    console.log('[RT] received event:', evt.type, evt);

    if (evt.type === 'conversation.item.input_audio_transcription.delta') {
      process.stdout.write(evt.delta);
    }
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      console.log();
      console.log('[RT] >>', evt.transcript);

      slackClient.chat.postMessage({
        channel: SLACK_LOGGING_CHANNEL,
        text: evt.transcript
      }).catch(console.error);
    }
    if (evt.type === 'response.audio.delta') {
      // Decode base64 audio and stream to speaker
      const audioBuffer = Buffer.from(evt.delta, 'base64');
      speaker.write(audioBuffer);
    }
  });

  ws.on('close', (c, r) => console.error(`socket closed ${c} – ${r}`));
  ws.on('error', err => console.error(err));

  function startMic() {
    const mic = record
      .record({
        sampleRate: 16000, 
        channels: 1, 
        audioType: 'raw',
        endOnSilence: false,
      })
      .stream();

    mic.on('data', buf => {
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: buf.toString('base64')
      }));
    });

    mic.on('error', err => console.error('mic error', err));
    console.log('[RT] mic started');
  }
}

module.exports = { startTranscriber };