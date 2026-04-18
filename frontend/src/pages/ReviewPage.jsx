import { Navigate, useLocation, useNavigate } from 'react-router-dom';

export default function ReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const result = location.state?.result;

  if (!result) {
    return <Navigate to="/" replace />;
  }

  const isApproved = result.status === 'APPROVED';
  const isFlagged = result.status === 'FLAGGED';
  const isRejected = result.status === 'REJECTED';

  return (
    <div className="result-page">
      <div className="result-card">
        <div className={`result-icon ${isApproved ? 'is-approved' : isRejected ? 'is-rejected' : 'is-flagged'}`}>
          {isApproved ? '✅' : isRejected ? '❌' : '⚠️'}
        </div>

        <h1 className="result-title">
          {isApproved ? 'Identity Verified' : isRejected ? 'Verification Failed' : 'Additional Review Required'}
        </h1>

        <p className="result-subtitle">
          {isApproved
            ? 'Your identity has been successfully verified. You may proceed.'
            : isRejected
              ? 'We could not verify your identity. Please ensure good lighting and a clear face, then try again.'
              : 'Your submission requires additional review by our compliance team.'}
        </p>

        <div className="result-details">
          <div className="result-detail-row">
            <span>Session</span>
            <strong>{result.session_id || 'N/A'}</strong>
          </div>
          <div className="result-detail-row">
            <span>Processing Time</span>
            <strong>{(result.processing_time_ms / 1000).toFixed(1)}s</strong>
          </div>
          <div className="result-detail-row">
            <span>Status</span>
            <strong className={isApproved ? 'text-green' : isRejected ? 'text-red' : 'text-amber'}>{result.status}</strong>
          </div>
        </div>

        {isRejected && result.reject_reason && (
          <div className="result-reason">
            <span className="result-reason-label">Reason</span>
            <p>{result.reject_reason.replace(/_/g, ' ')}</p>
          </div>
        )}

        <div className="result-actions">
          <button className="kyc-primary-btn" onClick={() => navigate('/')} type="button">
            {isRejected ? '🔄 Try Again' : '← Back to Home'}
          </button>
        </div>
      </div>
    </div>
  );
}
