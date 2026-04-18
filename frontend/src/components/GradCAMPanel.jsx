import { useState } from 'react';

export default function GradCAMPanel({ overlayB64 }) {
  const [opacity, setOpacity] = useState(58);

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">GenD Attention Map</span>
          <h2>Grad-CAM overlay</h2>
          <p className="panel-description panel-description--tight">
            Regions with stronger hot activation contributed more heavily to the synthetic-face decision.
          </p>
        </div>
      </div>

      {overlayB64 ? (
        <div className="gradcam-shell">
          <img src={overlayB64} alt="GenD Grad-CAM overlay" className="analysis-image" style={{ opacity: opacity / 100 }} />
        </div>
      ) : (
        <div className="analysis-empty">No Grad-CAM overlay generated.</div>
      )}

      <div className="slider-row">
        <div>
          <span className="panel-kicker">Overlay Opacity</span>
          <strong>{opacity}%</strong>
        </div>
        <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
      </div>
    </article>
  );
}
