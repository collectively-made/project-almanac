"""Hardware-aware LLM model recommender.

Uses the llmfit model database (hf_models.json) to recommend models
that will run well on the user's hardware. Scoring based on:
- Fit: does the model fit in available RAM?
- Quality: larger models score higher
- Speed: smaller models are faster on constrained hardware
- Practicality: must have GGUF sources available for download
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("almanac.recommender")

DB_PATH = Path(__file__).parent.parent / "data" / "hf_models.json"

# Categories we care about for a survival/homesteading assistant
RELEVANT_USE_CASES = {
    "text-generation", "conversational", "chat", "instruction",
}
RELEVANT_CATEGORIES = {
    "General", "Chat", "Reasoning", "Instruct",
}

# Prefer these providers for quality
QUALITY_PROVIDERS = {"meta-llama", "Qwen", "microsoft", "mistralai", "google", "deepseek-ai"}


def _load_database() -> list[dict]:
    """Load the model database."""
    if not DB_PATH.exists():
        logger.warning("Model database not found at %s", DB_PATH)
        return []
    with open(DB_PATH) as f:
        return json.load(f)


def recommend_models(
    available_ram_gb: float,
    has_gpu: bool = False,
    gpu_vram_gb: float = 0,
    unified_memory: bool = False,
    max_results: int = 5,
) -> list[dict]:
    """Recommend models for the given hardware.

    Returns a list of recommended models sorted by composite score.
    """
    models = _load_database()
    if not models:
        return []

    # For unified memory (Apple Silicon), total RAM is usable for models
    usable_memory = available_ram_gb if not unified_memory else max(available_ram_gb, gpu_vram_gb)
    # Reserve some RAM for the OS + app (~2.5GB)
    model_budget = usable_memory - 2.5

    scored = []
    for m in models:
        # Must have GGUF sources for local running
        gguf_sources = m.get("gguf_sources", [])
        if not gguf_sources:
            continue

        # Must be a GGUF quantized model
        quant = m.get("quantization", "")
        if not any(q in quant.upper() for q in ["Q4", "Q5", "Q6", "Q8", "GGUF"]):
            # Check if it's a base model with GGUF variants
            if not any("gguf" in s.get("repo", "").lower() for s in gguf_sources):
                continue

        # Get memory requirements
        min_ram = m.get("min_ram_gb", 999)
        rec_ram = m.get("recommended_ram_gb", min_ram * 1.5)
        params_raw = m.get("parameters_raw", 0)
        params_str = m.get("parameter_count", "")

        # Filter: must fit in available memory
        if min_ram > model_budget:
            continue

        # Skip very large models that would be painfully slow
        if params_raw > 30_000_000_000:  # 30B+
            continue

        # Skip non-instruct/chat models
        name_lower = m.get("name", "").lower()
        if any(skip in name_lower for skip in ["base", "awq", "gptq", "exl2", "coder", "code", "math", "vision"]):
            if "instruct" not in name_lower and "chat" not in name_lower:
                continue

        # Prefer instruct/chat variants
        is_instruct = any(t in name_lower for t in ["instruct", "chat", "it", "dpo"])

        # Score: Quality (0-40) + Fit (0-30) + Speed (0-20) + Source trust (0-10)
        score = 0.0

        # Quality: larger models are generally better
        if params_raw:
            if params_raw >= 7_000_000_000:
                score += 35
            elif params_raw >= 3_000_000_000:
                score += 28
            elif params_raw >= 1_500_000_000:
                score += 18
            else:
                score += 10

        # Bonus for instruct-tuned
        if is_instruct:
            score += 5

        # Fit: how well does it use available memory (sweet spot: 40-75%)
        utilization = min_ram / model_budget if model_budget > 0 else 1
        if 0.3 <= utilization <= 0.75:
            score += 30  # Sweet spot
        elif 0.2 <= utilization <= 0.85:
            score += 20  # Good
        elif utilization <= 0.95:
            score += 10  # Tight but works
        else:
            score += 5  # Very tight

        # Speed: smaller = faster on constrained hardware
        if params_raw:
            if params_raw <= 4_000_000_000:
                score += 20  # Fast
            elif params_raw <= 8_000_000_000:
                score += 15
            elif params_raw <= 14_000_000_000:
                score += 10
            else:
                score += 5

        # Source trust: prefer well-known providers
        provider = m.get("provider", "")
        if provider in QUALITY_PROVIDERS or any(p in m.get("name", "") for p in QUALITY_PROVIDERS):
            score += 10

        # Estimate tokens/sec (rough)
        estimated_tps = 0
        if params_raw:
            # Very rough: smaller models faster, GPU helps
            base_tps = 30_000_000_000 / max(params_raw, 1)  # Inverse of size
            if has_gpu or unified_memory:
                estimated_tps = min(base_tps * 3, 100)
            else:
                estimated_tps = min(base_tps, 30)

        # Get best GGUF download URL
        download_url = ""
        download_repo = ""
        for src in gguf_sources:
            repo = src.get("repo", "")
            if repo:
                download_repo = repo
                # Construct a likely GGUF download URL
                download_url = f"https://huggingface.co/{repo}"
                break

        scored.append({
            "name": m.get("name", ""),
            "provider": provider,
            "parameters": params_str,
            "parameters_raw": params_raw,
            "quantization": quant,
            "context_length": m.get("context_length", 0),
            "min_ram_gb": round(min_ram, 1),
            "recommended_ram_gb": round(rec_ram, 1),
            "score": round(score, 1),
            "estimated_tps": round(estimated_tps, 1),
            "fit_level": "Perfect" if utilization <= 0.6 else "Good" if utilization <= 0.8 else "Tight",
            "gguf_repo": download_repo,
            "gguf_url": download_url,
            "use_case": m.get("use_case", ""),
        })

    # Sort by score descending
    scored.sort(key=lambda x: x["score"], reverse=True)

    # Deduplicate by base model name (keep highest scored variant)
    seen_bases = set()
    deduped = []
    for m in scored:
        # Extract base name (remove provider prefix, quantization suffix)
        base = m["name"].split("/")[-1].lower()
        for suffix in ["-instruct", "-chat", "-dpo", "-it", "-gguf"]:
            base = base.replace(suffix, "")
        if base not in seen_bases:
            seen_bases.add(base)
            deduped.append(m)
        if len(deduped) >= max_results:
            break

    return deduped
