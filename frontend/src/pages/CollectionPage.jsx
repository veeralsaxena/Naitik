import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { postVerifyMedia } from '../api/client';

/* ── Step definitions ─────────────────────────────────────────────── */
const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'document', label: 'ID Document' },
  { id: 'selfie', label: 'Selfie' },
  { id: 'review', label: 'Review' },
  { id: 'processing', label: 'Processing' },
];

function createSessionId() {
  return `NAITIK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/* ── Pipeline Stage Tracker ───────────────────────────────────────── */
const PIPELINE_STAGES = [
  { key: 'intake', label: 'Intake Gate', icon: '📥' },
  { key: 'face', label: 'Face & Liveness', icon: '👤' },
  { key: 'forensics', label: 'Media Forensics', icon: '🔬' },
  { key: 'deepfake', label: 'GenD Deepfake', icon: '🧠' },
  { key: 'identity', label: 'Identity Match', icon: '🔐' },
  { key: 'scoring', label: 'Risk Scoring', icon: '📊' },
  { key: 'report', label: 'Report', icon: '📋' },
];

export default function CollectionPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('welcome');
  const [documentFile, setDocumentFile] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pipelineStage, setPipelineStage] = useState(0);

  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const sessionId = useMemo(createSessionId, []);

  // Auto-advance pipeline stages for visual feedback
  useEffect(() => {
    if (!isSubmitting) return;
    setPipelineStage(0);
    const interval = setInterval(() => {
      setPipelineStage((prev) => (prev < PIPELINE_STAGES.length - 1 ? prev + 1 : prev));
    }, 800);
    return () => clearInterval(interval);
  }, [isSubmitting]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  /* ── Camera controls ─────────────────────────────────────────────── */
  async function startCamera(facingMode = 'user') {
    stopCamera();
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (error) {
      setCameraError(`Camera access denied: ${error.message}`);
      setCameraActive(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  function captureFrame(target) {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = target === 'document' ? 'document-capture.jpg' : 'selfie-capture.jpg';
        const file = new File([blob], name, { type: 'image/jpeg' });
        const preview = URL.createObjectURL(blob);
        if (target === 'document') {
          setDocumentFile(file);
          setDocumentPreview(preview);
        } else {
          setSelfieFile(file);
          setSelfiePreview(preview);
        }
        stopCamera();
      },
      'image/jpeg',
      0.92,
    );
  }

  function handleFileUpload(target, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    if (target === 'document') {
      setDocumentFile(file);
      setDocumentPreview(preview);
    } else {
      setSelfieFile(file);
      setSelfiePreview(preview);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError('');
    setStep('processing');
    try {
      const result = await postVerifyMedia(selfieFile, documentFile, sessionId);
      navigate('/review', {
        state: {
          result: {
            ...result,
            session_id: result.session_id || sessionId,
            submission_source: 'guided',
          },
        },
      });
    } catch (error) {
      setSubmitError(error?.response?.data?.detail || error.message || 'Verification failed.');
      setStep('review');
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ── Step renderers ──────────────────────────────────────────────── */
  function renderWelcome() {
    return (
      <div className="kyc-step kyc-step--welcome">
        <div className="kyc-welcome-icon">🔬</div>
        <h2>ForenSight Verification</h2>
        <p className="kyc-step-subtitle">
          AI-powered forensic KYC that inspects selfies and videos for deepfakes, liveness spoofing,
          and document tampering using a 7-stage pipeline.
        </p>
        <div className="kyc-features">
          <div className="kyc-feature"><span className="kyc-feature-icon">🧠</span><span>GenD CLIP ViT-L/14 deepfake detection</span></div>
          <div className="kyc-feature"><span className="kyc-feature-icon">👤</span><span>RetinaFace + MiniFASNet liveness</span></div>
          <div className="kyc-feature"><span className="kyc-feature-icon">🔬</span><span>ELA, FFT, noise & EXIF forensics</span></div>
          <div className="kyc-feature"><span className="kyc-feature-icon">🔐</span><span>ArcFace identity matching</span></div>
        </div>
        <button className="kyc-primary-btn" onClick={() => setStep('document')} type="button">
          Begin Verification
          <span className="kyc-btn-arrow">→</span>
        </button>
        <p className="kyc-session-label">Session: <strong>{sessionId}</strong></p>
      </div>
    );
  }

  function renderDocumentStep() {
    return (
      <div className="kyc-step">
        <span className="kyc-step-badge">Optional</span>
        <h2>ID Document</h2>
        <p className="kyc-step-subtitle">
          Upload a passport, ID card, or driving licence for ArcFace identity matching.
          You can skip this step.
        </p>

        {documentPreview ? (
          <div className="kyc-media-preview">
            <img src={documentPreview} alt="ID Document" />
            <div className="kyc-media-meta">
              <strong>{documentFile?.name}</strong>
              <span>{documentFile ? `${(documentFile.size / 1024).toFixed(0)} KB` : ''}</span>
            </div>
            <button className="kyc-ghost-btn kyc-retake-btn" onClick={() => { setDocumentFile(null); setDocumentPreview(null); }} type="button">
              Remove
            </button>
          </div>
        ) : cameraActive ? (
          <div className="kyc-camera-shell">
            <video ref={videoRef} autoPlay muted playsInline className="kyc-camera-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="kyc-camera-controls">
              <button className="kyc-ghost-btn" onClick={stopCamera} type="button">Cancel</button>
              <button className="kyc-primary-btn" onClick={() => captureFrame('document')} type="button">📸 Capture</button>
            </div>
          </div>
        ) : (
          <div className="kyc-capture-zone">
            <div className="kyc-capture-zone-inner">
              <div className="kyc-capture-icon">📄</div>
              <p>Take a photo or upload your document</p>
              <div className="kyc-capture-actions">
                <button className="kyc-primary-btn" onClick={() => startCamera('environment')} type="button">📸 Open Camera</button>
                <label className="kyc-ghost-btn">
                  📁 Upload File
                  <input type="file" accept="image/*" onChange={(e) => handleFileUpload('document', e)} hidden />
                </label>
              </div>
            </div>
          </div>
        )}

        {cameraError && <div className="kyc-error">{cameraError}</div>}

        <div className="kyc-step-nav">
          <button className="kyc-ghost-btn" onClick={() => setStep('welcome')} type="button">← Back</button>
          <div className="kyc-step-nav-right">
            <button className="kyc-ghost-btn" onClick={() => { stopCamera(); setStep('selfie'); }} type="button">Skip →</button>
            {documentPreview && (
              <button className="kyc-primary-btn" onClick={() => { stopCamera(); setStep('selfie'); }} type="button">Continue →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderSelfieStep() {
    return (
      <div className="kyc-step">
        <span className="kyc-step-badge kyc-step-badge--required">Required</span>
        <h2>Selfie Capture</h2>
        <p className="kyc-step-subtitle">
          Take a clear selfie or upload an image/video. This is the primary media
          for deepfake analysis and liveness verification.
        </p>

        {selfiePreview ? (
          <div className="kyc-media-preview">
            {selfieFile?.type?.startsWith('video/') ? (
              <video controls src={selfiePreview} className="kyc-preview-media" />
            ) : (
              <img src={selfiePreview} alt="Selfie" className="kyc-preview-media" />
            )}
            <div className="kyc-media-meta">
              <strong>{selfieFile?.name}</strong>
              <span>{selfieFile ? `${(selfieFile.size / 1024).toFixed(0)} KB` : ''}</span>
            </div>
            <button className="kyc-ghost-btn kyc-retake-btn" onClick={() => { setSelfieFile(null); setSelfiePreview(null); }} type="button">
              Retake
            </button>
          </div>
        ) : cameraActive ? (
          <div className="kyc-camera-shell">
            <video ref={videoRef} autoPlay muted playsInline className="kyc-camera-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="kyc-face-guide" />
            <div className="kyc-camera-hint">Position your face within the guide</div>
            <div className="kyc-camera-controls">
              <button className="kyc-ghost-btn" onClick={stopCamera} type="button">Cancel</button>
              <button className="kyc-primary-btn" onClick={() => captureFrame('selfie')} type="button">📸 Capture</button>
            </div>
          </div>
        ) : (
          <div className="kyc-capture-zone">
            <div className="kyc-capture-zone-inner">
              <div className="kyc-capture-icon">🤳</div>
              <p>Take a selfie or upload an image/video</p>
              <div className="kyc-capture-actions">
                <button className="kyc-primary-btn" onClick={() => startCamera('user')} type="button">📸 Open Camera</button>
                <label className="kyc-ghost-btn">
                  📁 Upload File
                  <input type="file" accept="image/*,video/*" onChange={(e) => handleFileUpload('selfie', e)} hidden />
                </label>
              </div>
            </div>
          </div>
        )}

        {cameraError && <div className="kyc-error">{cameraError}</div>}

        <div className="kyc-step-nav">
          <button className="kyc-ghost-btn" onClick={() => { stopCamera(); setStep('document'); }} type="button">← Back</button>
          {selfiePreview && (
            <button className="kyc-primary-btn" onClick={() => { stopCamera(); setStep('review'); }} type="button">Continue →</button>
          )}
        </div>
      </div>
    );
  }

  function renderReviewStep() {
    return (
      <div className="kyc-step">
        <h2>Review Submission</h2>
        <p className="kyc-step-subtitle">
          Confirm the media below, then submit to the forensic pipeline.
        </p>

        <div className="kyc-review-grid">
          <div className="kyc-review-card">
            <span className="kyc-review-card-label">ID Document</span>
            {documentPreview ? (
              <img src={documentPreview} alt="Document" className="kyc-review-thumb" />
            ) : (
              <div className="kyc-review-empty">Skipped</div>
            )}
          </div>
          <div className="kyc-review-card">
            <span className="kyc-review-card-label">Selfie</span>
            {selfiePreview ? (
              selfieFile?.type?.startsWith('video/') ? (
                <video controls src={selfiePreview} className="kyc-review-thumb" />
              ) : (
                <img src={selfiePreview} alt="Selfie" className="kyc-review-thumb" />
              )
            ) : (
              <div className="kyc-review-empty">Not captured</div>
            )}
          </div>
        </div>

        {submitError && <div className="kyc-error">{submitError}</div>}

        <div className="kyc-step-nav">
          <button className="kyc-ghost-btn" onClick={() => setStep('selfie')} type="button">← Back</button>
          <button
            className="kyc-primary-btn kyc-submit-btn"
            disabled={!selfieFile || isSubmitting}
            onClick={handleSubmit}
            type="button"
          >
            {isSubmitting ? 'Running Pipeline…' : '🚀 Submit to Forensic Engine'}
          </button>
        </div>
      </div>
    );
  }

  function renderProcessingStep() {
    return (
      <div className="kyc-step kyc-step--processing">
        <div className="kyc-processing-header">
          <div className="kyc-spinner" />
          <h2>Analyzing Media</h2>
          <p className="kyc-step-subtitle">Running 7-stage forensic pipeline…</p>
        </div>
        <div className="kyc-pipeline-tracker">
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage.key} className={`kyc-pipeline-stage ${i < pipelineStage ? 'is-done' : i === pipelineStage ? 'is-active' : ''}`}>
              <div className="kyc-pipeline-stage-icon">
                {i < pipelineStage ? '✓' : stage.icon}
              </div>
              <div className="kyc-pipeline-stage-info">
                <strong>{stage.label}</strong>
                <span>{i < pipelineStage ? 'Complete' : i === pipelineStage ? 'Processing…' : 'Pending'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Main render ─────────────────────────────────────────────────── */
  const currentStepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="kyc-page">
      {/* Step indicator */}
      <div className="kyc-stepper">
        {STEPS.map((s, i) => (
          <div key={s.id} className={`kyc-stepper-item ${i === currentStepIndex ? 'is-current' : i < currentStepIndex ? 'is-done' : ''}`}>
            <div className="kyc-stepper-dot">{i < currentStepIndex ? '✓' : i + 1}</div>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="kyc-content">
        {step === 'welcome' && renderWelcome()}
        {step === 'document' && renderDocumentStep()}
        {step === 'selfie' && renderSelfieStep()}
        {step === 'review' && renderReviewStep()}
        {step === 'processing' && renderProcessingStep()}
      </div>

      {/* Branding footer */}
      <footer className="kyc-footer">
        <span>ForenSight</span>
        <span>•</span>
        <span>Powered by GenD, UniFace, ArcFace</span>
      </footer>
    </div>
  );
}
