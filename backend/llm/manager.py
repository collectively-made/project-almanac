from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncGenerator, Optional

logger = logging.getLogger("almanac.llm")


def _detect_threads() -> int:
    """Auto-detect optimal thread count for LLM inference."""
    cpu_count = os.cpu_count() or 4
    return min(cpu_count - 1, 4) if cpu_count > 1 else 1


def _detect_context_window() -> int:
    """Auto-detect context window from available RAM."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    available_kb = int(line.split()[1])
                    available_gb = available_kb / (1024 * 1024)
                    if available_gb < 4:
                        return 512
                    elif available_gb < 8:
                        return 1024
                    elif available_gb < 16:
                        return 2048
                    else:
                        return 4096
    except FileNotFoundError:
        pass  # Not Linux (macOS, etc.)
    # Default for macOS / unknown
    return 2048


def _get_available_ram_gb() -> float:
    """Get available RAM in GB."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / (1024 * 1024)
    except FileNotFoundError:
        # macOS fallback
        try:
            import subprocess
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, check=True,
            )
            return int(result.stdout.strip()) / (1024**3)
        except Exception:
            pass
    return 8.0  # Safe default


class LLMManager:
    """Manages LLM model lifecycle with async bridge and concurrency control.

    - Single ThreadPoolExecutor(max_workers=1) — llama.cpp is not thread-safe
    - asyncio.Semaphore(1) — rejects concurrent requests with 503
    - Sync-to-async streaming via asyncio.Queue
    """

    def __init__(
        self,
        models_dir: Path,
        threads: Optional[int] = None,
        context_window: Optional[int] = None,
    ) -> None:
        self._models_dir = models_dir
        self._threads = threads or _detect_threads()
        self._context_window = context_window or _detect_context_window()
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._llm = None
        self._model_name: Optional[str] = None

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Lazy-init semaphore in the running event loop."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(1)
        return self._semaphore

    @property
    def is_loaded(self) -> bool:
        return self._llm is not None

    @property
    def is_busy(self) -> bool:
        return self._semaphore is not None and self._semaphore.locked()

    @property
    def model_name(self) -> Optional[str]:
        return self._model_name

    def list_models(self) -> list[dict]:
        """List available GGUF models in the models directory."""
        models = []
        if not self._models_dir.exists():
            return models
        for path in sorted(self._models_dir.glob("*.gguf")):
            size_mb = path.stat().st_size / (1024 * 1024)
            models.append({
                "name": path.name,
                "size_mb": round(size_mb, 1),
                "path": str(path),
            })
        return models

    async def load_model(self, model_name: str) -> None:
        """Load a GGUF model. Blocks if the semaphore is held."""
        # Sanitize model name — prevent path traversal
        safe_name = Path(model_name).name
        if not safe_name or not safe_name.endswith(".gguf"):
            raise FileNotFoundError(f"Invalid model name: {model_name}")
        model_path = (self._models_dir / safe_name).resolve()
        if not model_path.is_relative_to(self._models_dir.resolve()):
            raise FileNotFoundError(f"Invalid model path: {model_name}")
        if not model_path.exists():
            raise FileNotFoundError(f"Model not found: {safe_name}")

        # Check RAM before loading
        file_size_gb = model_path.stat().st_size / (1024**3)
        available_ram = _get_available_ram_gb()
        if available_ram < file_size_gb + 1.5:
            raise MemoryError(
                f"Insufficient RAM: {available_ram:.1f}GB available, "
                f"need {file_size_gb + 1.5:.1f}GB (model: {file_size_gb:.1f}GB + 1.5GB overhead). "
                f"Try a smaller model."
            )

        loop = asyncio.get_running_loop()

        def _load():
            try:
                from llama_cpp import Llama
            except ImportError:
                raise ImportError(
                    "llama-cpp-python is not installed. "
                    "Install with: pip install llama-cpp-python"
                )

            logger.info(
                "Loading model %s (threads=%d, n_ctx=%d)",
                model_name, self._threads, self._context_window,
            )
            return Llama(
                model_path=str(model_path),
                n_ctx=self._context_window,
                n_threads=self._threads,
                n_gpu_layers=-1,  # Offload all layers to GPU (Metal on macOS)
                use_mmap=True,
                use_mlock=False,
                verbose=False,
            )

        self._llm = await loop.run_in_executor(self._executor, _load)
        self._model_name = model_name
        logger.info("Model loaded: %s", model_name)

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.3,
        stop: Optional[list[str]] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from the LLM. Yields one token at a time.

        Raises RuntimeError if no model is loaded.
        Raises asyncio.QueueEmpty (effectively 503) if semaphore is held.
        """
        if not self._llm:
            raise RuntimeError("No model loaded")

        sem = self._get_semaphore()
        if not sem.locked():
            await asyncio.wait_for(sem.acquire(), timeout=0.1)
        else:
            raise RuntimeError("Model is busy processing another request")

        try:
            queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
            loop = asyncio.get_running_loop()
            llm = self._llm

            def _blocking_generate():
                try:
                    for chunk in llm(
                        prompt,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        stop=stop or [],
                        stream=True,
                    ):
                        text = chunk["choices"][0]["text"]
                        if text:
                            asyncio.run_coroutine_threadsafe(
                                queue.put(text), loop
                            )
                finally:
                    asyncio.run_coroutine_threadsafe(queue.put(None), loop)

            loop.run_in_executor(self._executor, _blocking_generate)

            while True:
                token = await queue.get()
                if token is None:
                    break
                yield token
        finally:
            sem.release()

    async def chat(
        self,
        messages: list[dict],
        max_tokens: int = 256,
        temperature: float = 0.3,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens using the chat completion API (proper chat template).

        This ensures the model uses its trained chat format and knows
        when to stop generating (no runaway Q&A loops).
        """
        if not self._llm:
            raise RuntimeError("No model loaded")

        sem = self._get_semaphore()
        if not sem.locked():
            await asyncio.wait_for(sem.acquire(), timeout=0.1)
        else:
            raise RuntimeError("Model is busy processing another request")

        try:
            queue: asyncio.Queue[Optional[str]] = asyncio.Queue(maxsize=256)
            loop = asyncio.get_running_loop()
            llm = self._llm
            cancelled = False

            def _blocking_chat():
                try:
                    for chunk in llm.create_chat_completion(
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        stream=True,
                    ):
                        if cancelled:
                            break
                        delta = chunk["choices"][0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            asyncio.run_coroutine_threadsafe(
                                queue.put(text), loop
                            )
                finally:
                    asyncio.run_coroutine_threadsafe(queue.put(None), loop)

            loop.run_in_executor(self._executor, _blocking_chat)

            # Hard timeout: 120 seconds max generation time
            deadline = asyncio.get_event_loop().time() + 120
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    cancelled = True
                    logger.warning("Generation timed out after 120s")
                    break
                try:
                    token = await asyncio.wait_for(queue.get(), timeout=min(remaining, 5.0))
                except asyncio.TimeoutError:
                    continue  # Check deadline again
                if token is None:
                    break
                yield token
        finally:
            cancelled = True
            sem.release()

    async def unload(self) -> None:
        """Unload the current model and free resources."""
        if self._llm is not None:
            # llama-cpp-python doesn't have an explicit close, but
            # dereferencing allows GC to free the memory
            self._llm = None
            self._model_name = None
            logger.info("Model unloaded")
