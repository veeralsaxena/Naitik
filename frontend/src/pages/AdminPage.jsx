import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { apiClient } from '../api/client';
import ExifSummary from '../components/ExifSummary';
import GradCAMPanel from '../components/GradCAMPanel';
import HeatmapViewer from '../components/HeatmapViewer';
import RiskGauge from '../components/RiskGauge';
import SignalBreakdown from '../components/SignalBreakdown';
import VerdictBanner from '../components/VerdictBanner';

const ADMIN_PIN = '1234';

function MetricRail({ label, value, suffix = '', tone = 'neutral', percentage = 0 }) {
  return (
    <div className="metric-rail">
      <div className="metric-rail__header">
        <span>{label}</span>
        <strong>{value}{suffix}</strong>
      </div>
      <div className="metric-rail__track">
        <div className={`metric-rail__fill is-${tone}`} style={{ width: `${Math.max(0, Math.min(percentage, 100))}%` }} />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submittedFileName, setSubmittedFileName] = useState('');
  const [documentFile, setDocumentFile] = useState(null);

  /* ── Camera state ──────────────────────────────────────────────── */
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function handlePinSubmit(e) {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      setAuthenticated(true);
      setPinError('');
    } else {
      setPinError('Invalid PIN. Try again.');
    }
  }

  /* ── Camera controls ─────────────────────────────────────────── */
  async function startCamera() {
    stopCamera();
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (err) {
      setCameraError(`Camera access denied: ${err.message}`);
    }
  }

  function stopCamera() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    setIsRecording(false);
    setRecordingTime(0);
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], 'admin-capture.jpg', { type: 'image/jpeg' });
        stopCamera();
        handleFileSubmit(file);
      },
      'image/jpeg',
      0.92,
    );
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const file = new File([blob], 'admin-video.webm', { type: 'video/webm' });
      stopCamera();
      handleFileSubmit(file);
    };
    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setRecordingTime(0);
    timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    clearInterval(timerRef.current);
    setIsRecording(false);
  }

  /* ── Submission ──────────────────────────────────────────────── */
  async function handleFileSubmit(file) {
    setIsLoading(true);
    setError('');
    setResult(null);
    setSubmittedFileName(file.name);
    try {
      const formData = new FormData();
      formData.append('media_file', file);
      if (documentFile) {
        formData.append('id_document', documentFile);
      }
      const response = await apiClient.post('/verify/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Pipeline failed');
    } finally {
      setIsLoading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSubmit(file);
  }

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (file) handleFileSubmit(file);
  }

  function handleDocumentUpload(e) {
    const file = e.target.files?.[0];
    if (file) setDocumentFile(file);
  }

  /* ── PIN Gate ──────────────────────────────────────────────────── */
  if (!authenticated) {
    return (
      <div className="result-page">
        <div className="result-card">
          <div className="result-icon">🔐</div>
          <h1 className="result-title">Analyst Login</h1>
          <p className="result-subtitle">
            Enter the admin PIN to access the forensic analyst console.
          </p>
          <form onSubmit={handlePinSubmit} style={{ display: 'grid', gap: '16px', marginTop: '8px' }}>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="admin-pin-input"
            />
            {pinError && <div className="kyc-error">{pinError}</div>}
            <button className="kyc-primary-btn" type="submit">Unlock Console</button>
          </form>
          <div style={{ marginTop: '24px' }}>
            <a href="/" className="kyc-admin-link">← Back to KYC Flow</a>
          </div>
        </div>
      </div>
    );
  }

  const scores = result?.scores ?? result?.forensics?.scores ?? {};
  const signalBreakdown = result?.signal_breakdown ?? [];
  const videoAnalysis = result?.video_analysis ?? {};

   return (
    <div className="review-page">
      <header className="review-header">
        <div>
          <span className="eyebrow">🔬 Naitik Admin Portal</span>
          <h1>Forensic Analyst Console</h1>
          <p>Capture or upload media to run the 7-stage forensic pipeline.</p>
        </div>
        <div className="review-header__status-card">
          <div className="status-card__row">
            <span className="status-card__label">Pipeline Status</span>
            <span className={`status-card__pill ${
              result?.status === 'APPROVED' ? 'is-approved' :
              result?.status === 'FLAGGED' ? 'is-flagged' :
              result?.status === 'REJECTED' ? 'is-rejected' : 'is-idle'
            }`}>{result ? result.status : 'AWAITING'}</span>
          </div>
          <div className="status-card__divider" />
          <div className="status-card__metrics">
            <div className="status-card__metric">
              <span className="status-card__metric-label">Risk Score</span>
              <strong className="status-card__metric-value">{result ? `${result.risk_score}/100` : '—'}</strong>
            </div>
            <div className="status-card__metric">
              <span className="status-card__metric-label">Level</span>
              <strong className="status-card__metric-value" style={{ textTransform: 'capitalize' }}>{result?.risk_level || '—'}</strong>
            </div>
            <div className="status-card__metric">
              <span className="status-card__metric-label">Latency</span>
              <strong className="status-card__metric-value">{result ? `${result.processing_time_ms?.toFixed(0)}ms` : '—'}</strong>
            </div>
          </div>
          <a href="/" className="kyc-ghost-btn" style={{ fontSize: '11px', padding: '6px 14px', alignSelf: 'center', marginTop: '4px' }}>← Back to KYC Flow</a>
        </div>
      </header>

      {/* ── Input Zone: Camera + Upload ───────────────────────────── */}
      {cameraActive ? (
        <div className="admin-camera-zone">
          <video ref={videoRef} autoPlay muted playsInline className="admin-camera-video" />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="kyc-face-guide"><div className="kyc-scan-line" /></div>
          {isRecording && (
            <div className="admin-rec-badge">● REC {recordingTime}s</div>
          )}
          <div className="admin-camera-bar">
            <button className="kyc-ghost-btn" onClick={stopCamera} type="button">Cancel</button>
            {isRecording ? (
              <button className="kyc-primary-btn kyc-stop-btn" onClick={stopRecording} type="button">⏹ Stop & Analyze</button>
            ) : (
              <>
                <button className="kyc-primary-btn" onClick={capturePhoto} type="button">📸 Capture Photo</button>
                <button className="kyc-primary-btn kyc-record-btn" onClick={startRecording} type="button">🎥 Record Video</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`admin-upload-zone ${dragOver ? 'is-dragover' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          {isLoading ? (
            <div className="admin-upload-loading">
              <div className="kyc-spinner" />
              <p>Running forensic pipeline on <strong>{submittedFileName}</strong>…</p>
            </div>
          ) : (
            <>
              <div className="admin-upload-icon">🔬</div>
              <p>Drag & drop media, open camera, or upload a file</p>
              <p style={{ fontSize: '12px', opacity: 0.4 }}>JPG · PNG · WebP · MP4 · MOV · WebM (max 50 MB)</p>
              <div className="admin-input-actions">
                <label className="kyc-ghost-btn" style={{ cursor: 'pointer', borderStyle: 'dashed' }} onClick={(e) => e.stopPropagation()}>
                  📄 Attach ID Document (Optional)
                  <input type="file" accept="image/*" onChange={handleDocumentUpload} hidden />
                </label>
                <button className="kyc-primary-btn" onClick={(e) => { e.stopPropagation(); startCamera(); }} type="button">📷 Open Camera</button>
                <label className="kyc-ghost-btn" style={{ cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
                  📁 Upload Selfie / Video
                  <input type="file" accept="image/*,video/*,.webm,.mp4,.mov" onChange={handleUpload} hidden />
                </label>
              </div>
              {documentFile && (
                <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--cyan)' }}>
                  ID Document attached: <strong>{documentFile.name}</strong>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setDocumentFile(null); }} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
                </div>
              )}
              {cameraError && <div className="kyc-error" style={{ marginTop: 8 }}>{cameraError}</div>}
            </>
          )}
        </div>
      )}

      {error && <div className="kyc-error" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <>
          {result.explanation && (
            <div className="admin-explanation">
              <span className="panel-kicker">Pipeline Summary</span>
              <p style={{ margin: '8px 0 0', lineHeight: '1.65', color: 'var(--muted)' }}>{result.explanation}</p>
            </div>
          )}

          <motion.div
            className="dashboard-grid"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.15 },
              },
            }}
          >
            <motion.section
              className="dashboard-column"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
              }}
            >
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">Subject Media</span>
                    <h2>Original with face boundary</h2>
                  </div>
                </div>
                {result.forensics?.face_bbox_b64 ? (
                  <img src={result.forensics.face_bbox_b64} alt="Subject" className="analysis-image" />
                ) : (
                  <div className="analysis-empty">No face overlay available.</div>
                )}
              </article>

              <article className="panel gauge-panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">Overall Risk</span>
                    <h2>Composite risk score</h2>
                  </div>
                </div>
                <RiskGauge score={result.risk_score ?? 0} riskLevel={result.risk_level} />
              </article>
            </motion.section>

            <motion.section
              className="dashboard-column"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
              }}
            >
              <HeatmapViewer
                title="Error Level Analysis"
                subtitle="Compression inconsistencies and resave anomalies."
                imageB64={result.forensics?.ela_heatmap_b64}
                legendTitle="Cool → Hot"
                legendDescription="Blue/green = low error. Yellow/red = suspicious recomposition."
              />
              <HeatmapViewer
                title="Frequency Spectrum"
                subtitle="Periodic spikes from synthetic generation artifacts."
                imageB64={result.forensics?.fft_spectrum_b64}
                legendTitle="Low → High Energy"
                legendDescription="Off-center hot grid points indicate unnatural periodicity."
              />
            </motion.section>

            <motion.section
              className="dashboard-column"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
              }}
            >
              <GradCAMPanel overlayB64={result.forensics?.gradcam_overlay_b64} />

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">Biometric Signals</span>
                    <h2>Liveness · identity · GenD</h2>
                  </div>
                </div>
                <MetricRail
                  label="Liveness"
                  value={scores.liveness != null ? (scores.liveness * 100).toFixed(1) : 'N/A'}
                  suffix={scores.liveness != null ? '%' : ''}
                  tone={(scores.liveness ?? 0) >= 0.8 ? 'good' : (scores.liveness ?? 0) >= 0.7 ? 'warn' : 'bad'}
                  percentage={(scores.liveness ?? 0) * 100}
                />
                <MetricRail
                  label="ArcFace Match"
                  value={scores.arcface_similarity != null ? (scores.arcface_similarity * 100).toFixed(1) : 'N/A'}
                  suffix={scores.arcface_similarity != null ? '%' : ''}
                  tone={(scores.arcface_similarity ?? 0) >= 0.5 ? 'good' : (scores.arcface_similarity ?? 0) >= 0.35 ? 'warn' : 'bad'}
                  percentage={(scores.arcface_similarity ?? 0) * 100}
                />
                <MetricRail
                  label="GenD Fake Prob"
                  value={scores.gend_fake_prob != null ? (scores.gend_fake_prob * 100).toFixed(1) : 'N/A'}
                  suffix={scores.gend_fake_prob != null ? '%' : ''}
                  tone={(scores.gend_fake_prob ?? 0) <= 0.4 ? 'good' : (scores.gend_fake_prob ?? 0) <= 0.65 ? 'warn' : 'bad'}
                  percentage={(scores.gend_fake_prob ?? 0) * 100}
                />
                <MetricRail
                  label="Blur Variance"
                  value={scores.blur_variance != null ? scores.blur_variance.toFixed(1) : 'N/A'}
                  tone={(scores.blur_variance ?? 0) >= 100 ? 'good' : (scores.blur_variance ?? 0) >= 35 ? 'warn' : 'bad'}
                  percentage={Math.min(((scores.blur_variance ?? 0) / 500) * 100, 100)}
                />
              </article>

              <ExifSummary flags={scores.exif_flags || []} />
            </motion.section>
          </motion.div>

          <motion.div
            className="lower-grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            <article className="panel panel--wide">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">Signal Breakdown</span>
                  <h2>Risk signals across the seven-stage workflow</h2>
                </div>
              </div>
              <SignalBreakdown signalBreakdown={signalBreakdown} />
              {videoAnalysis?.frame_scores?.length > 0 && (
                <div className="admin-video-analysis">
                  <div className="panel-kicker" style={{ marginBottom: 8 }}>Video Frame Analysis</div>
                  <span>Frame fake scores: {videoAnalysis.frame_scores.map((s) => s.toFixed(2)).join(', ')}</span>
                  <span>Temporal variance: {(videoAnalysis.temporal_variance ?? 0).toFixed(4)}</span>
                </div>
              )}
            </article>
          </motion.div>

          <VerdictBanner
            status={result.status}
            riskScore={result.risk_score}
            riskLevel={result.risk_level}
            explanation={result.explanation}
            processingTimeMs={result.processing_time_ms}
            rejectReason={result.reject_reason}
          />
        </>
      )}
    </div>
  );
}
