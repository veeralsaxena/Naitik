export default function HeatmapViewer({ title, subtitle, imageB64, legendTitle, legendDescription }) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">Forensic Surface</span>
          <h2>{title}</h2>
          <p className="panel-description panel-description--tight">{subtitle}</p>
        </div>
      </div>
      {imageB64 ? <img src={imageB64} alt={title} className="analysis-image" /> : <div className="analysis-empty">No heatmap generated.</div>}
      <div className="heatmap-legend">
        <div className="heatmap-legend__bar" />
        <div className="heatmap-legend__copy">
          <strong>{legendTitle}</strong>
          <p>{legendDescription}</p>
        </div>
      </div>
    </article>
  );
}
