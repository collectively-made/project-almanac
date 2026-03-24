"""Cloud LLM providers — Anthropic and OpenAI.

Routes chat completions to cloud APIs as an alternative to local inference.
RAG retrieval stays local — only the generation step goes to the cloud.
"""
from __future__ import annotations

import json
import logging
from typing import AsyncGenerator, Optional

logger = logging.getLogger("almanac.llm.cloud")


class CloudLLM:
    """Unified interface for cloud LLM providers (Anthropic, OpenAI)."""

    def __init__(self, provider: str, api_key: str, model: Optional[str] = None):
        self.provider = provider  # "anthropic" or "openai"
        self.api_key = api_key
        self.model = model or self._default_model()

    def _default_model(self) -> str:
        if self.provider == "anthropic":
            return "claude-sonnet-4-20250514"
        return "gpt-4o-mini"

    async def chat(
        self,
        messages: list[dict],
        max_tokens: int = 2048,
        temperature: float = 0.3,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from the cloud API."""
        if self.provider == "anthropic":
            async for token in self._anthropic_stream(messages, max_tokens, temperature):
                yield token
        elif self.provider == "openai":
            async for token in self._openai_stream(messages, max_tokens, temperature):
                yield token
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    async def _anthropic_stream(
        self, messages: list[dict], max_tokens: int, temperature: float
    ) -> AsyncGenerator[str, None]:
        """Stream from Anthropic's Messages API."""
        import urllib.request
        import asyncio

        # Extract system message
        system = ""
        chat_messages = []
        for m in messages:
            if m["role"] == "system":
                system = m["content"]
            else:
                chat_messages.append({"role": m["role"], "content": m["content"]})

        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": chat_messages,
            "stream": True,
        }).encode()

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
        )

        loop = asyncio.get_running_loop()

        def _blocking_stream():
            tokens = []
            try:
                response = urllib.request.urlopen(req, timeout=60)
                for raw_line in response:
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "content_block_delta":
                            text = data.get("delta", {}).get("text", "")
                            if text:
                                tokens.append(text)
                    except json.JSONDecodeError:
                        continue
            except Exception as e:
                logger.exception("Anthropic API error")
                tokens.append(f"\n\n[Error: {type(e).__name__}]")
            return tokens

        # Run blocking HTTP in executor
        all_tokens = await loop.run_in_executor(None, _blocking_stream)
        for token in all_tokens:
            yield token

    async def _openai_stream(
        self, messages: list[dict], max_tokens: int, temperature: float
    ) -> AsyncGenerator[str, None]:
        """Stream from OpenAI's Chat Completions API."""
        import urllib.request
        import asyncio

        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
            "stream": True,
        }).encode()

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )

        loop = asyncio.get_running_loop()

        def _blocking_stream():
            tokens = []
            try:
                response = urllib.request.urlopen(req, timeout=60)
                for raw_line in response:
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            tokens.append(text)
                    except json.JSONDecodeError:
                        continue
            except Exception as e:
                logger.exception("OpenAI API error")
                tokens.append(f"\n\n[Error: {type(e).__name__}]")
            return tokens

        all_tokens = await loop.run_in_executor(None, _blocking_stream)
        for token in all_tokens:
            yield token
