"""Kodmoz Ofis köprüsü.

Hermes Agent'ın observer hook'larını dinler ve ofise (varsayılan olarak
http://127.0.0.1:4173) küçük, sınırlandırılmış olaylar gönderir.

Tasarım ilkeleri:
- Fail-open: Hermes akışını asla bloklamaz; tüm gönderimler arka plan
  thread'inde ve kısa timeout ile yapılır.
- Gizlilik: araç argümanları, dosya içerikleri ve tam konuşmalar gönderilmez.
  Yalnızca oturum kimliği, model/platform, araç adı ve kısaltılmış görev başlığı.
- Standart kütüphane dışında bağımlılık yoktur.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import urllib.request
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

DEFAULT_URL = "http://127.0.0.1:4173"
QUEUE: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(maxsize=512)
WORKER: Optional[threading.Thread] = None
WORKER_LOCK = threading.Lock()
SESSION_META: Dict[str, Dict[str, str]] = {}

ROLE_NAMES = {
    "researcher": "Araştırma",
    "research": "Araştırma",
    "coder": "Yazılım",
    "developer": "Yazılım",
    "engineer": "Yazılım",
    "reviewer": "İnceleme",
    "planner": "Planlama",
    "analyst": "Analiz",
    "designer": "Tasarım",
    "writer": "İçerik",
    "tester": "Test",
    "qa": "Kalite",
    "ops": "Operasyon",
    "devops": "DevOps",
    "orchestrator": "Orkestratör",
}


def _config() -> tuple[str, str]:
    url = (os.environ.get("OFFICE_URL") or "").strip() or DEFAULT_URL
    token = (os.environ.get("OFFICE_TOKEN") or "").strip()
    return url.rstrip("/"), token


def _text(value: Any, limit: int = 90) -> Optional[str]:
    if not isinstance(value, str):
        return None
    collapsed = " ".join(value.split())
    if not collapsed:
        return None
    return collapsed[:limit]


def _task_title(value: Any) -> Optional[str]:
    if os.environ.get("HERMES_OFFICE_SEND_TITLES", "1").strip() in {"0", "false", "no"}:
        return None
    return _text(value, 90)


def _agent_name() -> Optional[str]:
    return _text(os.environ.get("HERMES_OFFICE_AGENT_NAME"), 48)


def _agent_id() -> Optional[str]:
    return _text(os.environ.get("HERMES_OFFICE_AGENT_ID"), 48)


def _agent_role() -> Optional[str]:
    return _text(os.environ.get("HERMES_OFFICE_ROLE"), 48)


def _child_name(role: Any) -> Optional[str]:
    if not isinstance(role, str) or not role.strip():
        return None
    key = role.strip().lower()
    return ROLE_NAMES.get(key, role.strip()[:40])


def _ensure_worker() -> None:
    global WORKER
    with WORKER_LOCK:
        if WORKER is None or not WORKER.is_alive():
            WORKER = threading.Thread(
                target=_worker,
                name="hermes-office-bridge",
                daemon=True,
            )
            WORKER.start()


def _worker() -> None:
    while True:
        payload = QUEUE.get()
        try:
            if payload is None:
                return
            url, token = _config()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            request = urllib.request.Request(
                url + "/api/hermes/event",
                data=body,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=1.5) as response:
                response.read(128)
        except Exception as exc:  # fail-open
            logger.debug("Kodmoz Ofis köprüsü gönderemedi: %s", exc)
        finally:
            QUEUE.task_done()


def _emit(payload: Dict[str, Any]) -> None:
    clean = {key: value for key, value in payload.items() if value not in (None, "")}
    if not clean:
        return
    try:
        QUEUE.put_nowait(clean)
    except queue.Full:
        logger.debug("Kodmoz Ofis köprüsü kuyruğu dolu; olay atlandı.")
        return
    _ensure_worker()


def _session(sid: Any, **kwargs: Any) -> Dict[str, str]:
    key = str(sid)
    meta = SESSION_META.setdefault(key, {})
    for field in ("model", "platform"):
        value = kwargs.get(field)
        if isinstance(value, str) and value:
            meta[field] = value[:80]
    return meta


def _safe(fn: Callable[..., None]) -> Callable[..., None]:
    def wrapper(**kwargs: Any) -> None:
        try:
            fn(**kwargs)
        except Exception as exc:  # fail-open
            logger.debug("Kodmoz Ofis hook hatası (%s): %s", fn.__name__, exc)

    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


@_safe
def on_session_start(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    if not session_id:
        return
    meta = _session(session_id, **kwargs)
    _emit(
        {
            "type": "session_start",
            "agentId": _agent_id(),
            "sessionId": str(session_id),
            "agentName": _agent_name(),
            "role": _agent_role(),
            "model": meta.get("model"),
            "platform": meta.get("platform"),
        }
    )


@_safe
def on_session_end(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    if session_id:
        _emit({"type": "session_end", "sessionId": str(session_id)})


@_safe
def on_session_finalize(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    if session_id:
        _emit({"type": "session_finalize", "sessionId": str(session_id)})
        SESSION_META.pop(str(session_id), None)


@_safe
def pre_llm_call(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    if not session_id:
        return
    meta = _session(session_id, **kwargs)
    _emit(
        {
            "type": "llm_start",
            "agentId": _agent_id(),
            "sessionId": str(session_id),
            "taskTitle": _task_title(kwargs.get("user_message")),
            "model": meta.get("model"),
            "platform": meta.get("platform"),
        }
    )


@_safe
def post_llm_call(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    if session_id:
        _emit({"type": "llm_end", "sessionId": str(session_id)})


@_safe
def pre_tool_call(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    tool_name = kwargs.get("tool_name")
    if not session_id or not tool_name:
        return
    _emit(
        {
            "type": "tool_start",
            "agentId": _agent_id(),
            "sessionId": str(session_id),
            "toolName": _text(tool_name, 60),
        }
    )


@_safe
def post_tool_call(**kwargs: Any) -> None:
    session_id = kwargs.get("session_id")
    tool_name = kwargs.get("tool_name")
    if not session_id:
        return
    _emit(
        {
            "type": "tool_end",
            "sessionId": str(session_id),
            "toolName": _text(tool_name, 60),
            "status": _text(kwargs.get("status"), 24),
        }
    )


@_safe
def subagent_start(**kwargs: Any) -> None:
    parent_id = kwargs.get("parent_session_id") or kwargs.get("session_id")
    child_id = kwargs.get("child_session_id")
    if not child_id:
        return
    child_role = _text(kwargs.get("child_role"), 48)
    meta = SESSION_META.get(str(parent_id), {}) if parent_id else {}
    _emit(
        {
            "type": "subagent_start",
            "agentId": _agent_id(),
            "parentSessionId": str(parent_id) if parent_id else None,
            "childSessionId": str(child_id),
            "childRole": child_role,
            "agentName": _child_name(child_role),
            "taskTitle": _task_title(kwargs.get("goal") or kwargs.get("task")),
            "model": meta.get("model"),
            "platform": meta.get("platform"),
        }
    )


@_safe
def subagent_stop(**kwargs: Any) -> None:
    parent_id = kwargs.get("parent_session_id") or kwargs.get("session_id")
    child_id = kwargs.get("child_session_id")
    if not child_id:
        return
    _emit(
        {
            "type": "subagent_stop",
            "parentSessionId": str(parent_id) if parent_id else None,
            "childSessionId": str(child_id),
            "status": _text(kwargs.get("status"), 24),
        }
    )


HOOKS: Dict[str, Callable[..., None]] = {
    "on_session_start": on_session_start,
    "on_session_end": on_session_end,
    "on_session_finalize": on_session_finalize,
    "pre_llm_call": pre_llm_call,
    "post_llm_call": post_llm_call,
    "pre_tool_call": pre_tool_call,
    "post_tool_call": post_tool_call,
    "subagent_start": subagent_start,
    "subagent_stop": subagent_stop,
}


def register(ctx: Any) -> None:
    """Hermes plugin manager tarafından çağrılır."""
    for hook_name, callback in HOOKS.items():
        try:
            ctx.register_hook(hook_name, callback)
        except Exception as exc:  # eski Hermes sürümlerinde bilinmeyen hook olabilir
            logger.debug("Kodmoz Ofis hook kaydedilemedi (%s): %s", hook_name, exc)
