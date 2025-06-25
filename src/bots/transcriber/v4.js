const WebSocket = require('ws');
const record = require('node-record-lpcm16');
const Speaker = require('speaker');

// Suppress mpg123 buffer underflow warnings
const originalStderrWrite = process.stderr.write;
process.stderr.write = function(chunk, encoding, callback) {
  const str = chunk.toString();
  if (str.includes('buffer underflow') || 
      str.includes('mpg123') || 
      str.includes('coreaudio.c') ||
      str.includes('Didn\'t have any audio data')) {
    // Call callback if provided to maintain proper stream behavior
    if (typeof callback === 'function') {
      callback();
    }
    return true; // Suppress the output
  }
  return originalStderrWrite.call(this, chunk, encoding, callback);
};

function startTranscriber(slackClient) {
  const { OPENAI_API_KEY, SLACK_LOGGING_CHANNEL } = process.env;

  // Track if a response is currently active
  let responseActive = false;

  // Create or replace speaker instance
  let speaker = createSpeaker();

  function createSpeaker() {
    const sp = new Speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });
    sp.on('error', err => console.log('[RT] Speaker error:', err.message));
    return sp;
  }

  function stopSpeaker() {
    try {
      if (speaker) {
        console.log('[RT] 🛑 DESTROYING SPEAKER TO FULLY UNMOUNT');
        speaker.removeAllListeners();
        // Prefer destroy if available
        if (typeof speaker.destroy === 'function') {
          speaker.destroy();
        } else {
          speaker.close();
        }
        speaker = null;
      }
    } catch (err) {
      console.log('[RT] Error stopping speaker:', err.message);
    }
  }

  function replaceSpeaker() {
    stopSpeaker();
    // Add small delay to prevent rapid recreation
    setTimeout(() => {
      speaker = createSpeaker();
    }, 50);
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
    const evt = JSON.parse(raw);
    if (evt.type !== 'response.audio.delta') {
      console.log('[RT] received event:', evt.type, evt);
    } else {
      console.log('[RT] received event: response.audio.delta (audio suppressed)');
    }

    // Mark response active when audio starts
    if (evt.type === 'response.audio.delta') {
      responseActive = true;
    }

    // Transcript deltas
    if (evt.type === 'conversation.item.input_audio_transcription.delta') {
      process.stdout.write(evt.delta);
    }
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      console.log();
      console.log('[RT] >>', evt.transcript);
      slackClient.chat.postMessage({ channel: SLACK_LOGGING_CHANNEL, text: evt.transcript }).catch(console.error);
    }

    // Audio stream events
    if (evt.type === 'response.audio.delta') {
      const audioBuffer = Buffer.from(evt.delta, 'base64');
      if (speaker && speaker.writable && !speaker.destroyed) {
        try {
          speaker.write(audioBuffer);
        } catch (err) {
          console.log('[RT] Speaker write error:', err.message);
          replaceSpeaker();
        }
      }
    }

    // Handle interruption and cancellation only if active
    if (evt.type === 'input_audio_buffer.speech_started') {
      console.log('[RT] User started speaking - attempting interrupt');
      if (responseActive) {
        ws.send(JSON.stringify({ type: 'response.cancel' }));
      }
      replaceSpeaker();
    }
    if (evt.type === 'response.cancelled') {
      console.log('[RT] Response cancelled - stopping audio');
      responseActive = false;
      replaceSpeaker();
    }

    // Graceful end: allow buffer to drain then replace
    if (evt.type === 'response.audio.done') {
      console.log('[RT] Audio stream done - ending speaker after drain');
      speaker.end();
      speaker.once('finish', () => {
        console.log('[RT] Speaker finished playback - replacing speaker');
        responseActive = false;
        replaceSpeaker();
      });
    }

    // Final response event
    if (evt.type === 'response.done') {
      console.log('[RT] Response completed');
      responseActive = false;
    }
  });

  ws.on('close', (code, reason) => console.error(`socket closed ${code} – ${reason}`));
  ws.on('error', err => console.error(err));

  function startMic() {
    const mic = record.record({ sampleRate: 16000, channels: 1, audioType: 'raw', endOnSilence: false, highWaterMark: 1024 * 16 }).stream();
    mic.on('data', buf => {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: buf.toString('base64') }));
    });
    mic.on('error', err => console.error('mic error', err));
    console.log('[RT] mic started');
  }
}

module.exports = { startTranscriber };
