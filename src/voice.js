export class VoiceCall {
  constructor({ base, token, onEvent, onState, onError, onMicrophoneState }) {
    Object.assign(this, { base, token, onEvent, onState, onError, onMicrophoneState });
    this.sources = new Set();
    this.muted = false;
    this.closed = false;
    this.ready = false;
  }
  reportMicrophone() {
    const active = Boolean(this.ready && !this.closed && !this.muted
      && this.socket?.readyState === WebSocket.OPEN && this.context?.state === 'running'
      && this.stream?.getAudioTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted));
    if (active !== this.microphoneActive) {
      this.microphoneActive = active;
      this.onMicrophoneState?.(active);
    }
  }
  send(event) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }
  approvalHeard() {
    if (this.approvalPlayback && !this.sources.size && !this.responseActive && !this.interrupting) {
      this.send({ type: 'app.approval_heard', id: this.approvalPlayback });
      this.approvalPlayback = null;
    }
  }
  async start() {
    this.onState('connecting');
    this.reportMicrophone();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要安全连接，请使用安卓安装包或本机 localhost 打开');
      this.context = new AudioContext({ sampleRate: 24000 });
      this.context.addEventListener('statechange', () => this.reportMicrophone());
      await this.context.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      if (this.closed) { this.stream.getTracks().forEach(track => track.stop()); return; }
      for (const track of this.stream.getAudioTracks()) {
        for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, () => this.reportMicrophone());
      }
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      this.input = this.context.createMediaStreamSource(this.stream);
      this.recorder = new AudioWorkletNode(this.context, 'pcm-recorder');
      this.silent = this.context.createGain();
      this.silent.gain.value = 0;
      this.input.connect(this.recorder);
      this.recorder.connect(this.silent);
      this.silent.connect(this.context.destination);
      const url = new URL('/voice', this.base || location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = new WebSocket(url);
      this.socket.onopen = () => this.send({ type: 'auth', token: this.token });
      this.socket.onmessage = ({ data }) => this.receive(JSON.parse(data));
      this.socket.onerror = () => {
        this.ready = false;
        this.reportMicrophone();
        this.onError('通话连接失败，请检查网络和服务地址');
      };
      this.socket.onclose = () => {
        if (!this.closed) { this.onError('通话连接已断开'); this.close(); }
      };
      this.recorder.port.onmessage = ({ data }) => {
        if (!this.ready || this.muted || this.closed) return;
        const pcm = new Int16Array(data);
        let energy = 0;
        for (const sample of pcm) energy += (sample / 32768) ** 2;
        const rms = Math.sqrt(energy / pcm.length);
        // Echo cancellation is enabled; require two voiced chunks before a local interruption.
        this.voiced = rms > 0.04 ? (this.voiced || 0) + 1 : 0;
        if (this.voiced >= 2 && this.sources.size && !this.interrupting) this.interrupt(true);
        const bytes = new Uint8Array(data);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        this.send({ type: 'input_audio_buffer.append', audio: btoa(binary) });
      };
      this.timeout = setTimeout(() => {
        if (!this.ready) { this.onError('连接超时，请稍后重试'); this.close(); }
      }, 25000);
    } catch (error) {
      this.onError(error.name === 'NotAllowedError' ? '需要允许麦克风权限才能通话' : error.message);
      this.close();
    }
  }
  receive(event) {
    if (this.closed) return;
    if (event.type === 'app.ready') {
      this.ready = true;
      this.reportMicrophone();
      clearTimeout(this.timeout);
      this.onState('listening');
    } else if (event.type === 'input_audio_buffer.speech_started') {
      this.interrupt(false);
      this.onState('listening');
    } else if (event.type === 'input_audio_buffer.speech_stopped') {
      this.onState('thinking');
    } else if (event.type === 'response.created') {
      this.interrupting = false;
      this.responseActive = true;
    } else if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) {
      if (!this.interrupting) this.play(event);
    } else if (event.type === 'response.done') {
      this.responseActive = false;
      this.approvalHeard();
      if (!this.sources.size) this.onState('listening');
    } else if (event.type === 'app.approval_playback') {
      this.approvalPlayback = event.id;
    } else if (event.type === 'app.error' || event.type === 'error') {
      if (['response_cancel_not_active', 'conversation_already_has_active_response'].includes(event.error?.code)) return;
      this.onError(event.message || event.error?.message || '语音服务异常');
      this.close();
    }
    this.onEvent(event);
  }
  play(event) {
    const raw = atob(event.delta);
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buffer = this.context.createBuffer(1, pcm.length, 24000);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) output[i] = pcm[i] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const at = Math.max(this.context.currentTime + 0.015, this.nextTime || 0);
    if (this.itemId !== event.item_id) {
      this.itemId = event.item_id;
      this.itemStart = at;
      this.itemDuration = 0;
      this.contentIndex = event.content_index || 0;
    }
    this.itemDuration += buffer.duration;
    this.nextTime = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.approvalHeard();
      if (!this.sources.size && !this.closed) this.onState('listening');
    };
    source.start(at);
    this.onState('speaking');
  }
  interrupt(cancel) {
    this.approvalPlayback = null;
    const hadAudio = this.sources.size > 0;
    if (cancel && this.responseActive) this.send({ type: 'response.cancel' });
    if (hadAudio && this.itemId) {
      const milliseconds = Math.max(0, Math.floor(Math.min(this.context.currentTime - this.itemStart, this.itemDuration) * 1000));
      this.send({ type: 'conversation.item.truncate', item_id: this.itemId, content_index: this.contentIndex, audio_end_ms: milliseconds });
    }
    this.interrupting = true;
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear();
    this.nextTime = 0;
    this.itemId = null;
  }
  toggleMute() {
    this.muted = !this.muted;
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !this.muted;
    if (this.muted) this.send({ type: 'input_audio_buffer.clear' });
    this.reportMicrophone();
    return this.muted;
  }
  sendText(text) {
    if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN) throw new Error('语音还在连接，请稍等');
    this.interrupt(false);
    this.send({ type: 'app.text', text });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.reportMicrophone();
    clearTimeout(this.timeout);
    this.interrupt(false);
    this.socket?.close();
    this.stream?.getTracks().forEach(track => track.stop());
    this.input?.disconnect();
    this.recorder?.disconnect();
    this.silent?.disconnect();
    this.context?.close().catch(() => {});
    this.onState('ended');
  }
}
