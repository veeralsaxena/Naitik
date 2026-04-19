<div align="center">

# 🔬 NAITIK
### Next-Generation AI-Powered Identity & Knowledge Verification

<img src="https://img.shields.io/badge/Hackathon-Kode%20by%20Atlas-blueviolet?style=for-the-badge&logo=rocket&logoColor=white" />
<img src="https://img.shields.io/badge/Team-Orion-cyan?style=for-the-badge&logo=star&logoColor=white" />
<img src="https://img.shields.io/badge/Stack-FastAPI%20%2B%20React-orange?style=for-the-badge&logo=lightning&logoColor=white" />
<img src="https://img.shields.io/badge/AI-Deepfake%20Detection-red?style=for-the-badge&logo=eye&logoColor=white" />

<br/>

> **Naitik** is a forensic-grade, AI-powered KYC (Know Your Customer) verification platform that can distinguish real human faces from AI-generated images and deepfakes in real time — with zero cloud dependencies and full offline operation.

</div>

---

## 🏆 The Problem We're Solving

The world is flooded with synthetic media. AI image generators like Midjourney, Stable Diffusion, and DALL-E can produce photorealistic human faces indistinguishable to the naked eye. Deepfake technology allows anyone to swap faces onto existing videos. Traditional KYC systems — used by banks, fintech platforms, and government portals — are **completely blind** to these attacks.

The result? Identity fraud at scale. Synthetic identities being used to open bank accounts, commit financial fraud, and bypass security systems designed to protect real people.

**Naitik** was built to close this gap.

---

## ✨ What Makes Naitik Different

| Feature | Traditional KYC | **Naitik** |
|---------|----------------|------------|
| Detects face-swap deepfakes | ❌ | ✅ GenD ViT-L/14 |
| Detects pure AI-generated images | ❌ | ✅ Multi-signal texture analysis |
| Anti-spoofing (printed photo / screen replay) | ⚠️ Basic | ✅ MiniFASNet neural network |
| Biometric ID document matching | ⚠️ Optional | ✅ ArcFace cosine similarity |
| Visual heatmap explanations | ❌ | ✅ GradCAM + ELA + FFT |
| Works completely offline | ❌ | ✅ Local-first, no cloud |
| Explainable rejection reasons | ❌ | ✅ 7-stage audit trail |

---

## 🎯 Core Capabilities

### 🧠 7-Stage Forensic Pipeline

Every media submission passes through a sequential forensic pipeline. Each stage produces granular signals that feed into a final weighted risk score:

```
Stage 0 → Intake Gate        Quality validation (resolution, blur, file type, lighting)
Stage 1 → Face Gate          Detection, pose check, anti-spoofing liveness test
Stage 2 → Forensic Analysis  ELA, FFT, EXIF, noise analysis, GenAI texture detection
Stage 3 → Deepfake Detection GenD CLIP ViT-L/14 with Grad-CAM attention mapping
Stage 4 → Identity Match     ArcFace biometric matching against uploaded ID document
Stage 5 → Risk Scoring       Weighted multi-signal composite score (0-100)
Stage 6 → Report Generation  Structured JSON report with explanations and heatmaps
```

### 🔍 GenAI Texture Detector

Our most novel contribution: a **three-signal heuristic** that identifies pure AI-generated images (Midjourney, Stable Diffusion, DALL-E) even when deepfake face-swap models output low risk scores:

1. **JPEG Block Artifact Analysis** — Real webcam photos carry 8×8 pixel boundary discontinuities from JPEG encoding. AI images downloaded as PNG have none.
2. **Cross-Channel Noise Correlation** — Real camera sensors use a single Bayer filter, making R/G/B noise correlated. AI generators sample each channel independently.
3. **Gradient Smoothness** — AI images have unnaturally smooth color transitions. Real photos have micro-texture even in smooth areas from sensor imperfections.

This gives us a reliable **47% separation** between AI and real photos in synthetic benchmarks — without any neural network.

### 🎭 Deepfake Detection (GenD)

We load the **GenD CLIP ViT-L/14** model from HuggingFace (`yermandy/GenD_CLIP_L_14`), a transformer fine-tuned specifically on face-swap deepfake datasets. The model produces:
- A **fake probability** score (0.0–1.0)
- A **Grad-CAM attention heatmap** showing exactly which facial regions triggered the detection

### 🆔 Biometric Identity Matching

When a user uploads a PAN card, Aadhar, or any photo ID:
1. RetinaFace detects and crops the face printed on the document
2. ArcFace generates 512-dimensional biometric embeddings for both the selfie and the ID face
3. Cosine similarity determines whether the same person appears in both

Threshold: `< 0.35` = mismatch (hard reject) | `0.35–0.50` = uncertain | `> 0.50` = confirmed match

### 🕵️ Error Level Analysis (ELA)

Re-saves the image at a known JPEG quality and computes the difference. Manipulated regions — whether pasted faces, AI inpainting, or compositing — show elevated error levels compared to the authentic surrounding image. Rendered as a colour heatmap (blue = clean, red = suspicious).

### 📡 FFT Frequency Analysis

Computes the 2D Fast Fourier Transform of the image. AI generators and image processing tools leave characteristic **periodic frequency patterns** invisible to the human eye but unmistakable in the frequency domain as off-centre grid spikes.

---

## 🖥️ Interface

### User KYC Flow
A guided multi-step flow for end users:
- **Live Camera Capture** with face alignment guide and scan animation
- **Video Recording** for liveness verification
- **File Upload** as fallback
- **ID Document Attachment** for biometric matching

### Forensic Analyst Console (Admin)
A full-featured analyst dashboard showing:
- **Composite risk gauge** (0–100 with colour-coded risk levels)
- **Side-by-side heatmaps**: ELA heatmap, FFT frequency spectrum, GradCAM overlay
- **Biometric signal rail**: Liveness %, ArcFace match %, GenD fake probability, Blur variance
- **Signal breakdown bars** across all 7 pipeline stages
- **Animated verdict pill**: APPROVED (green glow) / FLAGGED (amber glow) / REJECTED (red pulse)
- **EXIF metadata flags**: Missing timestamps, blank device info
- **Pipeline explanation**: Natural-language summary of what triggered the outcome

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  CollectionPage  │  AdminPage (Analyst Dashboard)   │
│  Framer Motion   │  Glassmorphism UI                │
└─────────────┬───────────────────┬───────────────────┘
              │  HTTP/FormData    │
              ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI Backend (:8000)                 │
│  POST /verify/media → forensic_engine.run_pipeline  │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
stage0    stage1     stage2     stage3
Intake    Face+      Forensics  GenD CLIP
Gate      Liveness   ELA/FFT    ViT-L/14
          ArcFace    EXIF/Noise GradCAM
          MiniFASNet GenAI Tex
              │          │          │
              └──────────┴──────────┘
                         │
                    stage4 (Identity Match)
                    stage5 (Risk Scoring)
                    stage6 (Report + Heatmaps)
```

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **FastAPI** | Async REST API, multipart media handling |
| **PyTorch + CUDA/MPS** | Neural network inference (GenD, GradCAM) |
| **GenD CLIP ViT-L/14** | Deepfake detection transformer model |
| **UniFace** | RetinaFace (detection) + MiniFASNet (liveness) + ArcFace (recognition) |
| **OpenCV** | ELA, FFT, noise analysis, frame extraction |
| **Transformers (HuggingFace)** | Model loading and preprocessing |
| **SciPy** | Statistical noise analysis |
| **python-magic** | MIME type validation |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 18 + Vite** | Fast SPA framework |
| **Framer Motion** | Staggered animations, spring physics |
| **Axios** | API communication |
| **CSS (Vanilla)** | Custom design system with glassmorphism |
| **Space Grotesk + JetBrains Mono** | Typography |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- 8GB+ RAM (for model loading)
- macOS (MPS acceleration) or Linux with CUDA GPU

### Backend Setup

```bash
# Clone the repository
git clone https://github.com/veeralsaxena/Naitik.git
cd Naitik/backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Start the forensic engine (auto-downloads models on first run)
uvicorn main:app --reload --port 8000
```

> **Note:** On first startup, Naitik automatically downloads the GenD CLIP ViT-L/14 model (~1.8GB) from HuggingFace. This requires a one-time internet connection. All subsequent runs are fully offline.

### Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Environment Check

```bash
# Verify all models loaded successfully
curl http://localhost:8000/health
```

---

## 📊 Pipeline Output Example

```json
{
  "status": "APPROVED",
  "risk_score": 14,
  "risk_level": "low",
  "processing_time_ms": 412,
  "explanation": "GenD estimated a synthetic-face probability of 3.2%. Forensic artifact analysis produced a composite anomaly score of 21.8%. No ID document was supplied, so identity matching was skipped.",
  "signal_breakdown": [
    { "name": "Intake Quality", "value": 82.1, "contributes_to_risk": false },
    { "name": "Liveness",       "value": 12.0, "contributes_to_risk": false },
    { "name": "ELA",            "value": 28.3, "contributes_to_risk": false },
    { "name": "FFT",            "value": 19.1, "contributes_to_risk": false },
    { "name": "GenD",           "value": 3.2,  "contributes_to_risk": false },
    { "name": "GenAI Texture",  "value": 18.4, "contributes_to_risk": false },
    { "name": "Identity",       "value": 0.0,  "contributes_to_risk": false }
  ]
}
```

---

## 🧪 Detection Results

| Input Type | GenAI Texture Score | Overall Risk | Verdict |
|------------|--------------------:|------------:|---------|
| Real webcam selfie | 15–25% | 10–25 | ✅ APPROVED |
| Midjourney portrait | 75–92% | 65–85 | 🚩 FLAGGED / REJECTED |
| Face-swap deepfake video | 2–15% GenAI, 60–90% GenD | 55–90 | 🚩 FLAGGED / REJECTED |
| Printed photo held to camera | Low GenD, Low liveness | 60–80 | ❌ REJECTED (liveness) |
| ID mismatch | Varies | 75+ | ❌ REJECTED (identity) |

---

## 🔒 Privacy & Security

- **100% local-first**: No media ever leaves your machine. All inference runs on-device.
- **No data retention**: Frames and face crops exist only in memory during pipeline execution.
- **No cloud API calls**: After the one-time model download, Naitik operates with zero network dependency.
- **MIME validation**: Only legitimate image/video files are accepted; magic byte verification prevents spoofed file types.

---

## 🗺️ Roadmap

- [ ] **WebRTC real-time streaming** — frame-by-frame analysis during live call
- [ ] **OCR-based ID text extraction** — automatically read name/DOB from Aadhar, PAN, passport
- [ ] **Multi-face crowd KYC** — verify multiple subjects from a single frame
- [ ] **Audit log export** — PDF/CSV report export for compliance teams
- [ ] **Mobile PWA** — optimised camera capture for field KYC agents
- [ ] **Webhook integration** — push verdicts to external KYC platforms (Ballerine, Sumsub)

---

## 👥 Team Orion

Built with ❤️, caffeine, and a lot of `git push --force` at **Kode Hackathon by Atlas**.

| Role | Contribution |
|------|-------------|
| 🧠 ML Engineer | GenD integration, GradCAM, GenAI texture detector |
| 🏗️ Backend Lead | FastAPI pipeline, forensic engine, scoring logic |
| 🎨 Frontend Lead | React dashboard, animations, design system |
| 🔬 Forensics | ELA, FFT, EXIF analysis, noise statistics |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Naitik** — _Because seeing is no longer believing._

Made for **Kode by Atlas** · Team **Orion** · 2026

</div>
