// 8-bit blips synthesized with WebAudio — no audio files to ship.

window.CB = window.CB || {}

;(function () {
  let ctx = null
  let enabled = true

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  function tone(freq, start, dur, { type = 'square', vol = 0.05, slide = 0 } = {}) {
    const a = ac()
    const t0 = a.currentTime + start
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur)
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(a.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  function noise(start, dur, vol = 0.04) {
    const a = ac()
    const len = Math.floor(a.sampleRate * dur)
    const buf = a.createBuffer(1, len, a.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = a.createBufferSource()
    const gain = a.createGain()
    gain.gain.value = vol
    src.buffer = buf
    src.connect(gain).connect(a.destination)
    src.start(a.currentTime + start)
  }

  const N = { C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047, E6: 1319, G6: 1568 }

  const SFX = {
    done() { tone(N.C6, 0, 0.09); tone(N.E6, 0.08, 0.09); tone(N.G6, 0.16, 0.16) },
    need() { tone(N.A5, 0, 0.1, { vol: 0.06 }); tone(N.A5, 0.13, 0.1, { vol: 0.06 }); tone(N.E6, 0.28, 0.22, { vol: 0.06 }) },
    pop() { tone(660, 0, 0.06, { slide: 400 }) },
    jump() { tone(330, 0, 0.12, { slide: 500, vol: 0.035 }) },
    land() { tone(140, 0, 0.06, { type: 'triangle', vol: 0.06 }) },
    eat() { noise(0, 0.05); noise(0.12, 0.05); noise(0.24, 0.05) },
    kick() { tone(220, 0, 0.05, { type: 'triangle', vol: 0.08 }); noise(0, 0.03, 0.03) },
    catch() { tone(N.E5, 0, 0.05); tone(N.A5, 0.05, 0.08) },
    bug() { tone(200, 0, 0.18, { type: 'sawtooth', slide: -120, vol: 0.04 }) },
    love() { tone(N.G5, 0, 0.08, { type: 'triangle', vol: 0.06 }); tone(N.C6, 0.09, 0.14, { type: 'triangle', vol: 0.06 }) },
    levelup() { [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.07, 0.1)) },
    end() { [N.G5, N.E5, N.C5].forEach((f, i) => tone(f, i * 0.1, 0.12)) },
  }

  CB.Sound = {
    setEnabled(v) { enabled = !!v },
    play(name) {
      if (!enabled || !SFX[name]) return
      try { SFX[name]() } catch { /* audio not available */ }
    },
  }
})()
