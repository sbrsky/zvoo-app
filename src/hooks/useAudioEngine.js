import { useState, useRef, useCallback } from 'react'

export const MAX_RECORDING_SECONDS = 30

export function useAudioEngine() {
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState(null)
  const [reversedBlob, setReversedBlob] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [analyserData, setAnalyserData] = useState(new Uint8Array(0))
  const [recordingElapsed, setRecordingElapsed] = useState(0)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const animFrameRef = useRef(null)
  const streamRef = useRef(null)
  const recordingTimerRef = useRef(null)
  const recordingStartRef = useRef(null)
  // Synchronous ref — always holds the latest recorded blob
  // (avoids stale closure bug when state hasn't updated yet)
  const audioBlobRef = useRef(null)
  // ref to stopRecording so timer callback can call it without stale closures
  const stopRecordingRef = useRef(null)

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return audioContextRef.current
  }, [])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 } })
      streamRef.current = stream

      const ctx = getAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateVisualizer = () => {
        analyser.getByteTimeDomainData(dataArray)
        setAnalyserData(new Uint8Array(dataArray))
        animFrameRef.current = requestAnimationFrame(updateVisualizer)
      }
      updateVisualizer()

      const options = {}
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options.mimeType = 'audio/webm;codecs=opus'
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options.mimeType = 'audio/mp4'
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          options.mimeType = 'audio/aac'
        }
      }
      const mediaRecorder = new MediaRecorder(stream, options)
      
      chunksRef.current = []
      mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }
      // Reset refs so previous blob doesn't leak
      audioBlobRef.current = null

      mediaRecorderRef.current = mediaRecorder
      
      // Safari struggles with timeslices, start without args
      mediaRecorder.start()
      setIsRecording(true)
      setAudioBlob(null)
      setRecordingElapsed(0)
      recordingStartRef.current = Date.now()

      // Timer: update elapsed each second, auto-stop at MAX_RECORDING_SECONDS
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000)
        setRecordingElapsed(elapsed)
        if (elapsed >= MAX_RECORDING_SECONDS && stopRecordingRef.current) {
          stopRecordingRef.current()
        }
      }, 500)
      setReversedBlob(null)
    } catch (err) {
      console.error('Failed to start recording:', err)
      throw err
    }
  }, [getAudioContext])

  const stopPromiseRef = useRef(null)

  /**
   * Stop recording. Returns a Promise<Blob> that resolves when the MediaRecorder
   * fires its onstop event and the blob is ready — eliminating the race condition
   * where code downstream tried to use audioBlob before React state updated.
   */
  const stopRecording = useCallback(() => {
    if (stopPromiseRef.current) return stopPromiseRef.current

    stopPromiseRef.current = new Promise((resolve, reject) => {
      const mr = mediaRecorderRef.current
      if (!mr || mr.state === 'inactive') {
        stopPromiseRef.current = null
        resolve(audioBlobRef.current) // already stopped
        return
      }

      mr.onstop = () => {
        const blobType = mr.mimeType || 'audio/webm' // fallback for older browsers
        const blob = new Blob(chunksRef.current, { type: blobType })
        audioBlobRef.current = blob
        setAudioBlob(blob)
        setIsRecording(false)
        cancelAnimationFrame(animFrameRef.current)
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
        streamRef.current?.getTracks().forEach(t => t.stop())
        stopPromiseRef.current = null
        resolve(blob)
      }
      mr.onerror = (e) => {
        stopPromiseRef.current = null
        reject(e.error || new Error('MediaRecorder error'))
      }

      try {
        mr.stop()
      } catch (err) {
        stopPromiseRef.current = null
        reject(err)
      }
    })
    return stopPromiseRef.current
  }, [])

  /**
   * Reverse the audio. Accepts an optional blob; falls back to audioBlobRef
   * (the synchronous ref) instead of the React state so it works immediately
   * after stopRecording() resolves.
   */
  const reverseAudio = useCallback(async (blob) => {
    const targetBlob = blob || audioBlobRef.current
    if (!targetBlob || targetBlob.size === 0) {
      console.warn('reverseAudio: no blob available or blob is empty')
      return null
    }

    try {
      const ctx = getAudioContext()
      const arrayBuffer = await targetBlob.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      const numChannels = audioBuffer.numberOfChannels
      const length = audioBuffer.length
      const sampleRate = audioBuffer.sampleRate
      const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate)
      const reversedBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate)

      for (let ch = 0; ch < numChannels; ch++) {
        const inputData = audioBuffer.getChannelData(ch)
        const outputData = reversedBuffer.getChannelData(ch)
        for (let i = 0; i < length; i++) {
          outputData[i] = inputData[length - 1 - i]
        }
      }

      setDuration(audioBuffer.duration)

      const wavBlob = audioBufferToWav(reversedBuffer)
      setReversedBlob(wavBlob)
      return wavBlob
    } catch (err) {
      console.error('Failed to reverse audio (decode error):', err)
      return null
    }
  }, [getAudioContext]) // no longer depends on audioBlob state

  const playAudio = useCallback(async (blob) => {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch (e) {}
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyserRef.current = analyser

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(analyser)
    analyser.connect(ctx.destination)
    sourceRef.current = source

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const updateVisualizer = () => {
      analyser.getByteTimeDomainData(dataArray)
      setAnalyserData(new Uint8Array(dataArray))
      animFrameRef.current = requestAnimationFrame(updateVisualizer)
    }
    updateVisualizer()

    setIsPlaying(true)
    source.onended = () => {
      setIsPlaying(false)
      cancelAnimationFrame(animFrameRef.current)
    }
    source.start(0)
  }, [getAudioContext])

  const stopPlaying = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch (e) {}
      setIsPlaying(false)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  // Keep stopRecordingRef in sync so timer auto-stop works correctly
  stopRecordingRef.current = stopRecording

  return {
    isRecording, audioBlob, reversedBlob, isPlaying, duration, analyserData,
    recordingElapsed, MAX_RECORDING_SECONDS,
    startRecording, stopRecording, reverseAudio, playAudio, stopPlaying,
    setAudioBlob, setReversedBlob,
    // expose ref for tests / immediate access
    audioBlobRef,
  }
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataLength = buffer.length * blockAlign
  const bufferOut = new ArrayBuffer(44 + dataLength)
  const view = new DataView(bufferOut)

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return new Blob([bufferOut], { type: 'audio/wav' })
}
