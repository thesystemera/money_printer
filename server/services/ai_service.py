import os
import json
import base64
import asyncio
import aiofiles
from typing import Any, Dict, List

import anthropic
from openai import AsyncOpenAI
from google import genai as google_genai

from services import log_service, time_service

class AIService:
    _instance = None
    _max_concurrent_calls = 50

    def __new__(cls, config_service=None, cache_service=None):
        if cls._instance is None:
            cls._instance = super(AIService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, config_service=None, cache_service=None):
        if self._initialized:
            return

        self.config = config_service
        self.cache_service = cache_service

        anthropic_api_key = self.config.get_key("anthropic") if self.config else None
        gemini_api_key = self.config.get_key("gemini") if self.config else None
        openai_api_key = self.config.get_key("openai") if self.config else None

        try:
            self.claude_client = anthropic.AsyncAnthropic(api_key=anthropic_api_key) if anthropic_api_key else None
        except Exception:
            self.claude_client = None

        try:
            self.gemini_client = google_genai.Client(api_key=gemini_api_key) if gemini_api_key else None
        except Exception:
            self.gemini_client = None

        try:
            self.openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None
        except Exception:
            self.openai_client = None

        self.api_semaphore = asyncio.Semaphore(self._max_concurrent_calls)
        self._initialized = True

    async def initialize(self):
        if self.claude_client:
            await log_service.system("AIService initialized - Claude client ready")
        else:
            await log_service.error("Claude API key not found")

        if self.gemini_client:
            await log_service.system("AIService initialized - Gemini client ready")
        else:
            await log_service.error("Gemini API key not found")

        if self.openai_client:
            await log_service.system("AIService initialized - OpenAI client ready")
        else:
            await log_service.error("OpenAI API key not found")

    def _infer_provider_from_model(self, model: str) -> str:
        m = (model or "").lower()
        if m.startswith(("gpt", "o1", "o3", "o4", "gpt-5")):
            return "openai"
        if m.startswith("claude"):
            return "claude"
        if m.startswith("gemini"):
            return "gemini"
        return "openai"

    def _get_cache_key(self, tag, symbol=None, ai_provider="claude"):
        if tag == "PORTFOLIO_ANALYTICS":
            return f"{ai_provider}_response:PORTFOLIO_ANALYTICS"
        if symbol and tag in ["IMAGE_ANALYTICS", "MASTER_ANALYTICS", "OPTIONS_ANALYTICS", "VIBE_ANALYSIS",
                              "HISTORICAL_ANALYTICS"]:
            return f"{ai_provider}_response:{tag}_{symbol}"
        return None

    def _ensure_debug_dir(self, ai_provider="claude"):
        debug_dir = os.path.join("debug", ai_provider)
        os.makedirs(debug_dir, exist_ok=True)
        return debug_dir

    def _serialize_response(self, response):
        content_data = []
        for content_block in getattr(response, "content", []) or []:
            if getattr(content_block, "type", "") == "text":
                content_data.append({"type": "text", "text": getattr(content_block, "text", "")})
            elif getattr(content_block, "type", "") == "thinking":
                content_data.append({"type": "thinking", "thinking": getattr(content_block, "thinking", "")})
        return content_data

    def _deserialize_response(self, content_data):
        class SimpleResponseContent:
            def __init__(self, type, text=None, thinking=None):
                self.type = type
                if text is not None:
                    self.text = text
                if thinking is not None:
                    self.thinking = thinking

        class SimpleResponse:
            def __init__(self):
                self.content = []

        response = SimpleResponse()
        for item in content_data or []:
            if item.get("type") == "text":
                response.content.append(SimpleResponseContent("text", text=item.get("text", "")))
            elif item.get("type") == "thinking":
                response.content.append(SimpleResponseContent("thinking", thinking=item.get("thinking", "")))
        return response

    async def _check_and_cache_response(self, response_obj, tag, symbol, ai_provider, use_cache=True,
                                        cache_max_age_minutes=60):
        has_text_content = any(
            getattr(c, 'text', '').strip()
            for c in getattr(response_obj, 'content', [])
            if getattr(c, 'type', '') == 'text'
        )

        if has_text_content and use_cache and tag in ["IMAGE_ANALYTICS", "MASTER_ANALYTICS", "OPTIONS_ANALYTICS",
                                                      "PORTFOLIO_ANALYTICS", "HISTORICAL_ANALYTICS", "VIBE_ANALYSIS"]:
            cache_key = self._get_cache_key(tag, symbol, ai_provider)
            if cache_key:
                serialized = self._serialize_response(response_obj)
                expiry_seconds = cache_max_age_minutes * 60 if cache_max_age_minutes else None
                await self.cache_service.cache_response(cache_key, serialized, expiry_seconds)
                await log_service.cache(f"[{ai_provider.upper()}] ✓ Cached valid response for {cache_key}")

    def estimate_tokens(self, payload):
        if isinstance(payload, str):
            return len(payload) // 4
        if isinstance(payload, list):
            total = 0
            for part in payload:
                if isinstance(part, dict) and part.get("type") == "text":
                    total += len(part.get("text", ""))
                elif isinstance(part, dict) and part.get("type") == "image":
                    total += 4000
            return total // 4
        return 0

    async def log_api_call(self, messages, model, symbol=None, image_count=0, tag=None, ai_provider="claude",
                           tools=None, use_responses_api=False):
        total_tokens = 0
        if isinstance(messages, list):
            for msg in messages:
                if msg.get("role") == "system":
                    total_tokens += self.estimate_tokens(msg.get("content"))
                elif msg.get("role") == "user":
                    total_tokens += self.estimate_tokens(msg.get("content"))
        elif isinstance(messages, str):
            total_tokens += self.estimate_tokens(messages)

        web_search_text = ""
        if tools:
            for tool in tools:
                if tool.get("type") in ["web_search", "web_search_preview", "web_search_20250305"]:
                    web_search_text = ", web search enabled"
                    break

        image_text = f", {image_count} images" if image_count else ""
        symbol_text = f" for {symbol}" if symbol else ""
        tag_text = f" ({tag})" if tag else ""
        provider_name = ai_provider.upper()
        api_type = " Responses API" if use_responses_api else ""

        await log_service.ai(
            f"Calling {provider_name}{api_type}{symbol_text}{tag_text}{image_text}{web_search_text} ~{total_tokens:,} tokens, model={model}")

    async def send_thinking_stream(self, chunk: str, tag: str, is_complete: bool = False):
        if hasattr(log_service, "send_thinking_stream"):
            try:
                await log_service.send_thinking_stream(chunk, tag, is_complete)
            except Exception:
                pass

    async def send_output_stream(self, chunk: str, tag: str):
        if hasattr(log_service, "send_output_stream"):
            try:
                await log_service.send_output_stream(chunk, tag)
            except Exception:
                pass

    async def save_debug_data(self, prompt, response, tag=None, additional_data=None, image_data=None,
                              ai_provider="claude", symbol=None, web_search_data=None):
        debug_dir = self._ensure_debug_dir(ai_provider)
        timestamp = time_service.now().strftime("%Y%m%d_%H%M%S")
        tag = tag or "unknown"

        prompt_filepath = os.path.join(debug_dir, f"{tag}_{timestamp}_prompt.txt")
        async with aiofiles.open(prompt_filepath, "w", encoding="utf-8") as f:
            await f.write(f"=== PROMPT FOR {tag} ({ai_provider.upper()}) ===\n\n")
            await f.write(prompt or "")

        response_text = ""
        thinking_text = ""
        if response and hasattr(response, "content"):
            for block in response.content:
                if getattr(block, "type", "") == "text":
                    response_text = getattr(block, "text", "") or response_text
                elif getattr(block, "type", "") == "thinking":
                    thinking_text = getattr(block, "thinking", "") or thinking_text

        response_filepath = os.path.join(debug_dir, f"{tag}_{timestamp}_response.txt")
        async with aiofiles.open(response_filepath, "w", encoding="utf-8") as f:
            await f.write(f"=== RESPONSE FOR {tag} ({ai_provider.upper()}) ===\n\n")
            await f.write(response_text or "")

        thinking_filepath = None
        if thinking_text:
            thinking_filepath = os.path.join(debug_dir, f"{tag}_{timestamp}_thinking.txt")
            async with aiofiles.open(thinking_filepath, "w", encoding="utf-8") as f:
                await f.write(f"=== THINKING FOR {tag} ({ai_provider.upper()}) ===\n\n")
                await f.write(thinking_text or "")

        websearch_filepath = None
        if web_search_data:
            websearch_filepath = os.path.join(debug_dir, f"{tag}_{timestamp}_websearch.txt")
            async with aiofiles.open(websearch_filepath, "w", encoding="utf-8") as f:
                await f.write(f"=== WEB SEARCH DATA FOR {tag} ({ai_provider.upper()}) ===\n\n")
                for i, search in enumerate(web_search_data, 1):
                    await f.write(f"SEARCH {i}: {search.get('query', 'Unknown query')}\n")
                    await f.write("=" * 50 + "\n")
                    for j, result in enumerate(search.get('results', []), 1):
                        await f.write(f"Result {j}:\n")
                        await f.write(f"Title: {result.get('title', 'No title')}\n")
                        await f.write(f"URL: {result.get('url', 'No URL')}\n")
                        await f.write(f"Snippet: {result.get('snippet', 'No snippet')}\n")
                        await f.write("\n")
                    await f.write("\n")

        json_filepath = None
        if additional_data:
            json_filepath = os.path.join(debug_dir, f"{tag}_{timestamp}_data.json")
            async with aiofiles.open(json_filepath, "w", encoding="utf-8") as f:
                await f.write(json.dumps(additional_data, indent=2, default=str))

        image_filepaths = []
        if image_data:
            try:
                if isinstance(image_data, str):
                    b64 = image_data.split(",")[1] if "," in image_data else image_data
                    img_path = os.path.join(debug_dir, f"{tag}_{timestamp}_image.png")
                    async with aiofiles.open(img_path, "wb") as f:
                        await f.write(base64.b64decode(b64))
                    image_filepaths.append(img_path)
                elif isinstance(image_data, list):
                    for i, img in enumerate(image_data):
                        if not img:
                            continue
                        b64 = img.split(",")[1] if "," in img else img
                        img_path = os.path.join(debug_dir, f"{tag}_{timestamp}_image_{i}.png")
                        async with aiofiles.open(img_path, "wb") as f:
                            await f.write(base64.b64decode(b64))
                        image_filepaths.append(img_path)
                elif isinstance(image_data, dict):
                    for key, img in image_data.items():
                        if not img:
                            continue
                        b64 = img.split(",")[1] if "," in img else img
                        img_path = os.path.join(debug_dir, f"{tag}_{timestamp}_image_{key}.png")
                        async with aiofiles.open(img_path, "wb") as f:
                            await f.write(base64.b64decode(b64))
                        image_filepaths.append(img_path)
            except Exception as e:
                await log_service.error(f"Error saving image debug data: {str(e)}")

        components = []
        if prompt_filepath and os.path.exists(prompt_filepath):
            components.append(f"prompt ({os.path.getsize(prompt_filepath):,}b)")
        if response_filepath and os.path.exists(response_filepath):
            components.append(f"response ({os.path.getsize(response_filepath):,}b)")
        if thinking_filepath and os.path.exists(thinking_filepath):
            components.append(f"thinking ({os.path.getsize(thinking_filepath):,}b)")
        if websearch_filepath and os.path.exists(websearch_filepath):
            components.append(f"websearch ({os.path.getsize(websearch_filepath):,}b)")
        if json_filepath and os.path.exists(json_filepath):
            components.append(f"data ({os.path.getsize(json_filepath):,}b)")
        if image_filepaths:
            sizes = [os.path.getsize(p) for p in image_filepaths if os.path.exists(p)]
            if sizes:
                components.append(f"{len(image_filepaths)} images ({sum(sizes):,}b)")

        if components:
            symbol_text = f" for {symbol}" if symbol else ""
            await log_service.system(
                f"Saved debug data for {tag}{symbol_text} ({ai_provider.upper()}): {', '.join(components)}")

        return {
            "prompt": prompt_filepath,
            "response": response_filepath,
            "thinking": thinking_filepath,
            "websearch": websearch_filepath,
            "data": json_filepath,
            "images": image_filepaths,
        }

    def _prepare_openai_tools(self, tools):
        if not tools:
            return None
        out = []
        for t in tools:
            if t.get("type") in ["web_search", "web_search_preview", "web_search_20250305"]:
                out.append({"type": "web_search_preview"})
        return out or None

    def _to_openai_instructions_and_input(self, messages):
        system_text = ""
        content_items = []
        for msg in messages or []:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                if isinstance(content, str):
                    system_text += content
                elif isinstance(content, list):
                    for b in content:
                        if b.get("type") == "text":
                            system_text += b.get("text", "")
                continue
            if role == "user":
                if isinstance(content, str):
                    content_items.append({"type": "input_text", "text": content})
                elif isinstance(content, list):
                    for b in content:
                        t = b.get("type")
                        if t == "text":
                            content_items.append({"type": "input_text", "text": b.get("text", "")})
                        elif t == "image":
                            src = b.get("source", {}) or {}
                            if src.get("type") == "base64":
                                mime = src.get("media_type", "image/png")
                                data = src.get("data", "")
                                data_url = f"data:{mime};base64,{data}"
                                content_items.append({"type": "input_image", "image_url": data_url})
        if not content_items and system_text:
            return system_text.strip(), ""
        return system_text.strip(), [{"role": "user", "content": content_items}] if content_items else ""

    def _to_anthropic_system_and_messages(self, messages):
        system_text = ""
        out_msgs = []
        for msg in messages or []:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                if isinstance(content, str):
                    system_text += content
                elif isinstance(content, list):
                    for b in content:
                        if b.get("type") == "text":
                            system_text += b.get("text", "")
                continue
        for msg in messages or []:
            role = msg.get("role")
            if role not in ("user", "assistant"):
                continue
            content = msg.get("content")
            blocks = []
            if isinstance(content, str):
                blocks.append({"type": "text", "text": content})
            elif isinstance(content, list):
                for b in content:
                    t = b.get("type")
                    if t == "text":
                        blocks.append({"type": "text", "text": b.get("text", "")})
                    elif t == "image":
                        src = b.get("source", {}) or {}
                        if src.get("type") == "base64":
                            blocks.append({"type": "image", "source": {"type": "base64",
                                                                       "media_type": src.get("media_type", "image/png"),
                                                                       "data": src.get("data", "")}})
            out_msgs.append({"role": role, "content": blocks})
        return system_text.strip(), out_msgs

    def _to_gemini_contents(self, messages):
        contents: List[Dict[str, Any]] = []
        sys_text = ""
        for msg in messages or []:
            role = msg.get("role", "user")
            content = msg.get("content")

            if role == "system":
                if isinstance(content, str):
                    sys_text += content
                elif isinstance(content, list):
                    for b in content:
                        if b.get("type") == "text":
                            sys_text += b.get("text", "")
                continue

            parts: List[Dict[str, Any]] = []
            if isinstance(content, str):
                parts.append({"text": content})
            elif isinstance(content, list):
                for b in content:
                    t = b.get("type")
                    if t == "text":
                        parts.append({"text": b.get("text", "")})
                    elif t == "image":
                        src = b.get("source", {}) or {}
                        if src.get("type") == "base64":
                            parts.append({"inline_data": {"mime_type": src.get("media_type", "image/png"),
                                                          "data": src.get("data", "")}})
            mapped_role = role if role in ("user", "model") else "user"
            contents.append({"role": mapped_role, "parts": parts})

        if sys_text:
            contents.insert(0, {"role": "user", "parts": [{"text": sys_text}]})
        return contents

    async def _openai_responses_stream_and_collect(self, request_params, tag=None, with_thinking=True,
                                                   debug_events=False):
        thinking_text = ""
        output_text = ""
        web_searches = []
        has_reasoning = False
        sent_complete = False

        async with self.openai_client.responses.stream(**request_params) as stream:
            async for event in stream:
                et = getattr(event, "type", None)

                if debug_events and et:
                    await log_service.system(f"[OpenAI Stream Event] {et}")

                if et in ("response.reasoning.delta", "response.reasoning_summary_text.delta"):
                    delta = getattr(event, "delta", "") or ""
                    if delta:
                        thinking_text += delta
                        has_reasoning = True
                        if tag and with_thinking:
                            await self.send_thinking_stream(delta, tag, False)

                elif et == "response.output_text.delta":
                    delta = getattr(event, "delta", "") or ""
                    if delta:
                        output_text += delta
                        if tag:
                            await self.send_output_stream(delta, tag)

                elif et == "response.tool_calls.web_search.result":
                    tool_call = getattr(event, "tool_call", None)
                    if tool_call:
                        search_info = {
                            "query": getattr(tool_call, "query", ""),
                            "results": [
                                {
                                    "url": getattr(res, "url", ""),
                                    "title": getattr(res, "title", ""),
                                    "snippet": getattr(res, "snippet", "")
                                } for res in getattr(tool_call, "results", [])
                            ]
                        }
                        web_searches.append(search_info)
                        if debug_events:
                            await log_service.system(f"[OpenAI] Logged web search for query: {search_info['query']}")

                elif et and ("tool_call" in et or "web_search" in et):
                    if debug_events:
                        await log_service.system(f"[OpenAI] Tool event: {et}")
                    pass

                elif et in ("response.reasoning.done", "response.reasoning_summary_text.done"):
                    if debug_events:
                        await log_service.system(f"[OpenAI] Reasoning phase done: {et}")
                    pass

                elif et == "response.done":
                    if tag and has_reasoning and with_thinking and not sent_complete:
                        await self.send_thinking_stream("", tag, True)
                        sent_complete = True
                        if debug_events:
                            await log_service.system(f"[OpenAI] Sent thinking complete on response.done")

                elif et == "response.error":
                    err = getattr(event, "error", None)
                    raise RuntimeError(f"OpenAI streaming error: {err}")

            final = await stream.get_final_response()
            final_text = getattr(final, "output_text", None)
            if final_text and not output_text:
                output_text = final_text

        if not output_text.strip():
            raise ValueError("Empty response from OpenAI Responses API")

        if tag and has_reasoning and with_thinking and not sent_complete:
            await self.send_thinking_stream("", tag, True)
            if debug_events:
                await log_service.system(f"[OpenAI] Sent thinking complete as fallback")

        return thinking_text, output_text, web_searches

    async def call_openai_responses_api(
            self,
            messages,
            model="gpt-5",
            tools=None,
            tag=None,
            save_debug=False,
            additional_data=None,
            image_data=None,
            symbol=None,
            use_cache=True,
            cache_max_age_minutes=60,
            reasoning_effort=None,
            verbosity=None,
            with_thinking=True
    ):
        if not self.openai_client:
            await log_service.error("OpenAI client not initialized")
            return None

        if use_cache and tag in ["VIBE_ANALYSIS"]:
            cache_key = self._get_cache_key(tag, symbol, "openai")
            if cache_key:
                expiry_seconds = cache_max_age_minutes * 60 if cache_max_age_minutes else None
                cached = await self.cache_service.get_cached_response(cache_key, expiry_seconds)
                if cached:
                    await log_service.cache(f"[OPENAI] ✓ Using cached response for {cache_key}")
                    return self._deserialize_response(cached)

        image_count = 0
        if image_data:
            image_count = len(image_data) if isinstance(image_data, list) else 1

        system_text, input_payload = self._to_openai_instructions_and_input(messages)
        await self.log_api_call(input_payload or system_text, model, symbol, image_count, tag, "openai", tools,
                                use_responses_api=True)

        async with self.api_semaphore:
            attempt = 0
            while True:
                attempt += 1
                try:
                    params = {"model": model}

                    if input_payload:
                        params["input"] = input_payload
                    else:
                        params["input"] = system_text or ""

                    if system_text:
                        params["instructions"] = system_text

                    if with_thinking:
                        mapped_tools = self._prepare_openai_tools(tools)
                        if mapped_tools:
                            params["tools"] = mapped_tools

                        reasoning_cfg = {}
                        if reasoning_effort:
                            reasoning_cfg["effort"] = reasoning_effort
                        reasoning_cfg["summary"] = "auto"
                        params["reasoning"] = reasoning_cfg

                    if verbosity:
                        params["text"] = {"verbosity": verbosity}

                    thinking_text, output_text, web_searches = await self._openai_responses_stream_and_collect(
                        params, tag, with_thinking, debug_events=False
                    )

                    class SimpleResponseContent:
                        def __init__(self, type, text=None, thinking=None):
                            self.type = type
                            if text is not None:
                                self.text = text
                            if thinking is not None:
                                self.thinking = thinking

                    class SimpleResponse:
                        def __init__(self):
                            self.content = []
                            if thinking_text:
                                self.content.append(SimpleResponseContent("thinking", thinking=thinking_text))
                            if output_text:
                                self.content.append(SimpleResponseContent("text", text=output_text))

                    response_obj = SimpleResponse()

                    await self._check_and_cache_response(response_obj, tag, symbol, "openai", use_cache,
                                                         cache_max_age_minutes)

                    if save_debug:
                        prompt_parts = []
                        if system_text:
                            prompt_parts.append(f"=== SYSTEM MESSAGE ===\n{system_text}")

                        if isinstance(input_payload, list):
                            user_content_parts = []
                            for msg in input_payload:
                                if msg.get("role") == "user":
                                    for part in msg.get("content", []):
                                        if part.get("type") == "input_text":
                                            user_content_parts.append(f"{part.get('text', '')}")
                                        elif part.get("type") == "input_image":
                                            user_content_parts.append("\n[IMAGE]\n")
                            prompt_parts.append(f"=== USER MESSAGE ===\n{''.join(user_content_parts)}")

                        prompt_text = "\n\n".join(prompt_parts)
                        await self.save_debug_data(
                            prompt_text,
                            response_obj,
                            tag,
                            additional_data,
                            image_data,
                            "openai",
                            symbol,
                            web_search_data=web_searches if web_searches else None
                        )

                    await log_service.api(f"API call successful after {attempt} attempt(s) using OpenAI Responses API")
                    return response_obj

                except Exception as e:
                    await log_service.error(f"API attempt {attempt} (OpenAI Responses): {str(e)}")
                    backoff = min(2 ** attempt, 60)
                    await log_service.api(f"Retrying in {backoff} seconds...")
                    await asyncio.sleep(backoff)

    async def _anthropic_call(
            self,
            messages,
            model="claude-3-7-sonnet-20250219",
            temperature=1.0,
            with_thinking=False,
            tag=None,
            save_debug=False,
            additional_data=None,
            image_data=None,
            symbol=None,
            use_cache=True,
            cache_max_age_minutes=60,
            max_tokens=4096,
            thinking_budget=16000,
    ):
        if not self.claude_client:
            await log_service.error("Anthropic client not initialized")
            return None

        if use_cache and tag in ["IMAGE_ANALYTICS", "MASTER_ANALYTICS", "OPTIONS_ANALYTICS", "PORTFOLIO_ANALYTICS",
                                 "HISTORICAL_ANALYTICS", "VIBE_ANALYSIS"]:
            cache_key = self._get_cache_key(tag, symbol, "claude")
            if cache_key:
                expiry_seconds = cache_max_age_minutes * 60 if cache_max_age_minutes else None
                cached = await self.cache_service.get_cached_response(cache_key, expiry_seconds)
                if cached:
                    await log_service.cache(f"[CLAUDE] ✔ Using cached response for {cache_key}")
                    return self._deserialize_response(cached)

        image_count = 0
        for m in messages or []:
            if m.get("role") == "user" and isinstance(m.get("content"), list):
                image_count += sum(1 for p in m["content"] if p.get("type") == "image")

        await self.log_api_call(messages, model, symbol, image_count, tag, "claude")

        system_text, anthropic_messages = self._to_anthropic_system_and_messages(messages)
        kwargs = {"model": model, "messages": anthropic_messages, "max_tokens": max_tokens, "temperature": temperature}
        if system_text:
            kwargs["system"] = system_text
        if with_thinking:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": int(thinking_budget)}

        async with self.api_semaphore:
            attempt = 0
            while True:
                attempt += 1
                try:
                    text_accum = []
                    thinking_accum = []
                    block_types: Dict[int, str] = {}
                    async with self.claude_client.messages.stream(**kwargs) as stream:
                        async for event in stream:
                            et = getattr(event, "type", None)
                            if et == "content_block_start":
                                idx = getattr(event, "index", None)
                                block = getattr(event, "content_block", None)
                                btype = getattr(block, "type", None)
                                if isinstance(idx, int) and btype:
                                    block_types[idx] = btype
                            elif et == "content_block_delta":
                                idx = getattr(event, "index", None)
                                delta = getattr(event, "delta", None)
                                btype = block_types.get(idx, "")
                                if btype == "thinking":
                                    piece = getattr(delta, "thinking", "") if delta else ""
                                    if piece:
                                        thinking_accum.append(piece)
                                        if tag:
                                            await self.send_thinking_stream(piece, tag, False)
                                else:
                                    piece = getattr(delta, "text", "") if delta else ""
                                    if piece:
                                        text_accum.append(piece)
                                        if tag:
                                            await self.send_output_stream(piece, tag)
                            elif et == "message_stop":
                                break
                        final_msg = await stream.get_final_message()
                        final_text = ""
                        for block in getattr(final_msg, "content", []) or []:
                            if getattr(block, "type", "") == "text":
                                final_text = getattr(block, "text", "") or final_text
                            elif getattr(block, "type", "") == "thinking":
                                thinking_accum.append(getattr(block, "thinking", "") or "")
                        if not final_text:
                            final_text = "".join(text_accum)
                        thinking_text = "".join(thinking_accum)

                    if not final_text.strip():
                        raise ValueError("Empty response from Anthropic API")

                    class SimpleResponseContent:
                        def __init__(self, type, text=None, thinking=None):
                            self.type = type
                            if text is not None:
                                self.text = text
                            if thinking is not None:
                                self.thinking = thinking

                    class SimpleResponse:
                        def __init__(self):
                            self.content = []
                            if thinking_text:
                                self.content.append(SimpleResponseContent("thinking", thinking=thinking_text))
                            self.content.append(SimpleResponseContent("text", text=final_text or ""))

                    response_obj = SimpleResponse()

                    if tag and thinking_accum:
                        await self.send_thinking_stream("", tag, True)

                    await self._check_and_cache_response(response_obj, tag, symbol, "claude", use_cache,
                                                         cache_max_age_minutes)

                    if save_debug:
                        prompt_text = ""
                        for m in messages or []:
                            if m.get("role") == "system":
                                prompt_text += f"{m.get('content')}\n\n"
                            elif m.get("role") == "user":
                                if isinstance(m.get("content"), list):
                                    for p in m["content"]:
                                        if p.get("type") == "text":
                                            prompt_text += f"{p.get('text', '')}\n"
                                        elif p.get("type") == "image":
                                            prompt_text += "[IMAGE]\n"
                                elif isinstance(m.get("content"), str):
                                    prompt_text += f"{m.get('content')}\n"
                        await self.save_debug_data(prompt_text, response_obj, tag, additional_data, image_data,
                                                   "claude", symbol)

                    await log_service.api(
                        f"API call successful after {attempt} attempt(s) using Anthropic Messages API")
                    return response_obj
                except Exception as e:
                    await log_service.error(f"API attempt {attempt} (Anthropic): {str(e)}")
                    backoff = min(2 ** attempt, 60)
                    await log_service.api(f"Retrying in {backoff} seconds...")
                    await asyncio.sleep(backoff)

    async def _gemini_call(
            self,
            messages,
            model="gemini-2.5-pro",
            temperature=1.0,
            tag=None,
            save_debug=False,
            additional_data=None,
            image_data=None,
            symbol=None,
            use_cache=True,
            cache_max_age_minutes=60,
            with_thinking=True,
            thinking_budget=-1,
    ):
        if not self.gemini_client:
            await log_service.error("Gemini client not initialized")
            return None

        if use_cache and tag in ["IMAGE_ANALYTICS", "MASTER_ANALYTICS", "OPTIONS_ANALYTICS", "PORTFOLIO_ANALYTICS",
                                 "HISTORICAL_ANALYTICS", "VIBE_ANALYSIS"]:
            cache_key = self._get_cache_key(tag, symbol, "gemini")
            if cache_key:
                expiry_seconds = cache_max_age_minutes * 60 if cache_max_age_minutes else None
                cached = await self.cache_service.get_cached_response(cache_key, expiry_seconds)
                if cached:
                    await log_service.cache(f"[GEMINI] ✔ Using cached response for {cache_key}")
                    return self._deserialize_response(cached)

        image_count = 0
        for m in messages or []:
            if m.get("role") == "user" and isinstance(m.get("content"), list):
                image_count += sum(1 for p in m["content"] if p.get("type") == "image")

        await self.log_api_call(messages, model, symbol, image_count, tag, "gemini")

        contents = self._to_gemini_contents(messages)

        genai_types = getattr(google_genai, "types", None)
        if genai_types:
            cfg_kwargs = {}
            if temperature is not None:
                cfg_kwargs["temperature"] = float(temperature)
            if with_thinking:
                try:
                    cfg_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                        thinking_budget=int(thinking_budget) if thinking_budget is not None else -1,
                        include_thoughts=True,
                    )
                except Exception:
                    pass
            try:
                config = genai_types.GenerateContentConfig(**cfg_kwargs) if cfg_kwargs else None
            except Exception:
                config = {"temperature": float(temperature)} if temperature is not None else None
        else:
            config = {"temperature": float(temperature)} if temperature is not None else None

        async with self.api_semaphore:
            attempt = 0
            MAX_RETRIES = 5
            while attempt < MAX_RETRIES:
                attempt += 1
                try:
                    thinking_chunks = []
                    text_chunks = []

                    stream = await self.gemini_client.aio.models.generate_content_stream(
                        model=model,
                        contents=contents,
                        config=config,
                    )

                    async for chunk in stream:
                        try:
                            emitted = False
                            candidates = getattr(chunk, "candidates", None)
                            if candidates:
                                for c in candidates or []:
                                    content_obj = getattr(c, "content", None)
                                    parts = getattr(content_obj, "parts", None) or []
                                    for p in parts:
                                        p_text = getattr(p, "text", None)
                                        is_thought = getattr(p, "thought", False)
                                        if p_text:
                                            if is_thought:
                                                thinking_chunks.append(p_text)
                                                if tag:
                                                    await self.send_thinking_stream(p_text, tag, False)
                                            else:
                                                text_chunks.append(p_text)
                                                if tag:
                                                    await self.send_output_stream(p_text, tag)
                                            emitted = True
                            if not emitted:
                                delta = getattr(chunk, "text", None)
                                if delta:
                                    text_chunks.append(delta)
                                    if tag:
                                        await self.send_output_stream(delta, tag)
                        except Exception:
                            pass

                    if tag and thinking_chunks:
                        await self.send_thinking_stream("", tag, True)

                    final_text = "".join(text_chunks)
                    if not final_text.strip():
                        raise ValueError("Empty response from Gemini API")

                    thinking_text = "".join(thinking_chunks) if thinking_chunks else ""

                    class SimpleResponseContent:
                        def __init__(self, type, text=None, thinking=None):
                            self.type = type
                            if text is not None:
                                self.text = text
                            if thinking is not None:
                                self.thinking = thinking

                    class SimpleResponse:
                        def __init__(self):
                            self.content = []
                            if thinking_text:
                                self.content.append(SimpleResponseContent("thinking", thinking=thinking_text))
                            self.content.append(SimpleResponseContent("text", text=final_text or ""))

                    response_obj = SimpleResponse()

                    await self._check_and_cache_response(response_obj, tag, symbol, "gemini", use_cache,
                                                         cache_max_age_minutes)

                    if save_debug:
                        prompt_text = ""
                        for m in messages or []:
                            if m.get("role") == "system":
                                prompt_text += f"{m.get('content')}\n\n"
                            elif m.get("role") == "user":
                                if isinstance(m.get("content"), list):
                                    for p in m["content"]:
                                        if p.get("type") == "text":
                                            prompt_text += f"{p.get('text', '')}\n"
                                        elif p.get("type") == "image":
                                            prompt_text += "[IMAGE]\n"
                                elif isinstance(m.get("content"), str):
                                    prompt_text += f"{m.get('content')}\n"
                        await self.save_debug_data(prompt_text, response_obj, tag, additional_data, image_data,
                                                   "gemini", symbol)

                    await log_service.api(f"API call successful after {attempt} attempt(s) using Gemini Streaming API")
                    return response_obj
                except json.JSONDecodeError as e:
                    await log_service.error(
                        f"[AI Stream Error] JSONDecodeError on attempt {attempt}/{MAX_RETRIES} for {tag}: {str(e)}")
                    await log_service.error(f"[AI Stream Error] Raw malformed response from API: {e.doc}")
                    if attempt >= MAX_RETRIES:
                        raise e
                    await asyncio.sleep(min(2 ** attempt, 60))
                except Exception as e:
                    await log_service.error(f"API attempt {attempt}/{MAX_RETRIES} (Gemini): {str(e)}")
                    if attempt >= MAX_RETRIES:
                        await log_service.error(
                            f"Gemini API call failed after {MAX_RETRIES} attempts for {tag}. Giving up.")
                        raise e
                    backoff = min(2 ** attempt, 60)
                    await log_service.api(f"Retrying in {backoff} seconds...")
                    await asyncio.sleep(backoff)

    async def call_api(
            self,
            messages,
            model="claude-3-7-sonnet-20250219",
            temperature=1.0,
            with_thinking=True,
            max_tokens=None,
            thinking_budget=16000,
            tag=None,
            save_debug=False,
            additional_data=None,
            image_data=None,
            symbol=None,
            use_cache=True,
            cache_max_age_minutes=60,
            ai_provider=None,
            tools=None,
            reasoning_effort="medium",
            verbosity=None,
    ):
        provider = (ai_provider or self._infer_provider_from_model(model)).lower()

        if provider == "openai":
            return await self.call_openai_responses_api(
                messages=messages,
                model=model,
                tools=tools,
                tag=tag,
                save_debug=save_debug,
                additional_data=additional_data,
                image_data=image_data,
                symbol=symbol,
                use_cache=use_cache,
                cache_max_age_minutes=cache_max_age_minutes,
                reasoning_effort=reasoning_effort,
                verbosity=verbosity,
                with_thinking=with_thinking,
            )

        if provider == "claude":
            if max_tokens is None:
                max_tokens = 32000
            if with_thinking and max_tokens <= thinking_budget:
                max_tokens = thinking_budget + 8000
            return await self._anthropic_call(
                messages=messages,
                model=model,
                temperature=1.0 if with_thinking else temperature,
                with_thinking=with_thinking,
                tag=tag,
                save_debug=save_debug,
                additional_data=additional_data,
                image_data=image_data,
                symbol=symbol,
                use_cache=use_cache,
                cache_max_age_minutes=cache_max_age_minutes,
                max_tokens=max_tokens,
                thinking_budget=thinking_budget,
            )

        if provider == "gemini":
            return await self._gemini_call(
                messages=messages,
                model=model,
                temperature=temperature,
                tag=tag,
                save_debug=save_debug,
                additional_data=additional_data,
                image_data=image_data,
                symbol=symbol,
                use_cache=use_cache,
                cache_max_age_minutes=cache_max_age_minutes,
                with_thinking=with_thinking,
                thinking_budget=thinking_budget,
            )

        await log_service.error(f"Unsupported provider for model '{model}'")
        return None