class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(2400);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.phase += 24000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples[this.index++] = sample * (sample < 0 ? 32768 : 32767);
        this.sum = 0;
        this.count = 0;
        if (this.index === this.samples.length) {
          this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
          this.samples = new Int16Array(2400);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-recorder', PCMRecorder);
