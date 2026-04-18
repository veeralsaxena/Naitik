from __future__ import annotations

from typing import Optional

import cv2
import numpy as np
import torch
from PIL import Image


def _prepare_tensor(face_crop_array: np.ndarray, gend_model: torch.nn.Module, device: str) -> torch.Tensor:
    pil_image = Image.fromarray(cv2.cvtColor(face_crop_array, cv2.COLOR_BGR2RGB))
    tensor = gend_model.feature_extractor.preprocess(pil_image)
    if isinstance(tensor, dict):
        tensor = tensor["pixel_values"][0]
    if tensor.dim() == 3:
        tensor = tensor.unsqueeze(0)
    return tensor.to(device)


def _extract_logits(model_output: torch.Tensor | tuple | object) -> torch.Tensor:
    if hasattr(model_output, "logits"):
        return model_output.logits
    if isinstance(model_output, tuple):
        return model_output[0]
    return model_output


def _build_overlay(face_crop_array: np.ndarray, activation_map: np.ndarray) -> bytes:
    normalized = activation_map - activation_map.min()
    normalized = normalized / (normalized.max() + 1e-6)
    normalized = np.uint8(normalized * 255)
    heatmap = cv2.applyColorMap(cv2.resize(normalized, (face_crop_array.shape[1], face_crop_array.shape[0])), cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(face_crop_array, 0.5, heatmap, 0.5, 0)
    return cv2.imencode(".png", overlay)[1].tobytes()


def _fallback_activation(face_crop_array: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(face_crop_array, cv2.COLOR_BGR2GRAY)
    enhanced = cv2.equalizeHist(gray)
    laplacian = cv2.Laplacian(enhanced, cv2.CV_32F)
    return np.abs(laplacian)


def _gradcam_overlay(
    face_crop_array: np.ndarray,
    gend_model: torch.nn.Module,
    tensor: torch.Tensor,
    logits: torch.Tensor,
) -> bytes:
    target_layer = None
    for _, module in gend_model.named_modules():
        if isinstance(module, torch.nn.LayerNorm):
            target_layer = module

    if target_layer is None:
        return _build_overlay(face_crop_array, _fallback_activation(face_crop_array))

    captured: dict[str, torch.Tensor] = {}

    def forward_hook(_: torch.nn.Module, __, output: torch.Tensor):
        activation = output[0] if isinstance(output, tuple) else output
        captured["activations"] = activation
        activation.retain_grad()

    hook = target_layer.register_forward_hook(forward_hook)
    try:
        gend_model.zero_grad(set_to_none=True)
        refreshed_logits = _extract_logits(gend_model(tensor))
        fake_score = refreshed_logits[:, 1].sum()
        fake_score.backward(retain_graph=True)

        activations = captured.get("activations")
        if activations is None or activations.grad is None:
            return _build_overlay(face_crop_array, _fallback_activation(face_crop_array))

        activation_tokens = activations[0]
        gradient_tokens = activations.grad[0]
        if activation_tokens.ndim != 2:
            return _build_overlay(face_crop_array, _fallback_activation(face_crop_array))

        activation_tokens = activation_tokens[1:]
        gradient_tokens = gradient_tokens[1:]
        token_weights = gradient_tokens.mean(dim=0)
        cam = torch.relu(activation_tokens @ token_weights).detach().cpu().numpy()
        grid_size = int(np.sqrt(cam.shape[0]))
        if grid_size * grid_size != cam.shape[0]:
            return _build_overlay(face_crop_array, _fallback_activation(face_crop_array))
        return _build_overlay(face_crop_array, cam.reshape(grid_size, grid_size))
    finally:
        hook.remove()


def _infer_single_frame(face_crop_array: np.ndarray, gend_model: torch.nn.Module, device: str) -> tuple[float, float, bytes]:
    tensor = _prepare_tensor(face_crop_array, gend_model, device)
    with torch.enable_grad():
        tensor.requires_grad_(True)
        logits = _extract_logits(gend_model(tensor))
        probabilities = logits.softmax(dim=-1)[0]
        real_prob = float(probabilities[0].detach().cpu())
        fake_prob = float(probabilities[1].detach().cpu())
        overlay = _gradcam_overlay(face_crop_array, gend_model, tensor, logits)
        return real_prob, fake_prob, overlay


def run_stage3(face_crop_array, gend_model: torch.nn.Module, device: str) -> dict:
    try:
        if isinstance(face_crop_array, list):
            frame_scores: list[float] = []
            frame_real_scores: list[float] = []
            overlays: list[bytes] = []

            for frame in face_crop_array:
                real_prob, fake_prob, overlay = _infer_single_frame(frame, gend_model, device)
                frame_real_scores.append(real_prob)
                frame_scores.append(fake_prob)
                overlays.append(overlay)

            max_index = int(np.argmax(frame_scores))
            mean_fake = float(np.mean(frame_scores))
            variance = float(np.var(frame_scores))
            passed = all(score <= 0.85 for score in frame_scores)

            response = {
                "passed": passed,
                "fake_prob": mean_fake,
                "real_prob": float(np.mean(frame_real_scores)),
                "gradcam_overlay_png_bytes": overlays[max_index],
                "frame_scores": frame_scores,
                "temporal_variance": variance,
            }
            if not passed:
                response["reason"] = "SYNTHETIC_FACE_DETECTED"
            return response

        real_prob, fake_prob, overlay = _infer_single_frame(face_crop_array, gend_model, device)
        response = {
            "passed": fake_prob <= 0.85,
            "fake_prob": fake_prob,
            "real_prob": real_prob,
            "gradcam_overlay_png_bytes": overlay,
        }
        if fake_prob > 0.85:
            response["reason"] = "SYNTHETIC_FACE_DETECTED"
        return response
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE3_ERROR: {exc}"}
