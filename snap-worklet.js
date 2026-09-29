// Snap: audio worklet. Runs on the audio thread and only measures loudness:
// every 256 samples it sends back the level of the raw mic (channel 0) and of
// the high frequencies (channel 1). The snap logic stays in snapdetect.js.
class SnapMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0; this.sr = 0; this.sh = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const raw = input[0], hi = input[1] || input[0];
    for (let i = 0; i < raw.length; i++) { this.sr += raw[i] * raw[i]; this.sh += hi[i] * hi[i]; }
    this.n += raw.length;
    if (this.n >= 256) {
      this.port.postMessage([Math.sqrt(this.sr / this.n), Math.sqrt(this.sh / this.n), currentFrame]);
      this.n = 0; this.sr = 0; this.sh = 0;
    }
    return true;
  }
}
registerProcessor('snap-meter', SnapMeter);
