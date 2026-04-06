import argparse
import base64
import datetime
import getpass
import uuid
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

CURRENT_USAGE_ROWS: List[Dict[str, Any]] = []
APP_VERSION = "0.1.0-beta.3"


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def now_tag() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


def openvshot_home() -> Path:
    override = os.getenv("OPENVSHOT_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    appdata = os.getenv("APPDATA", "").strip()
    if appdata:
        return Path(appdata) / "OpenVShot"
    return Path.home() / ".openvshot"


def default_config_path() -> Path:
    return openvshot_home() / "config.json"


def load_config(path: Path) -> Dict[str, Any]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            backups = sorted(path.parent.glob("config.json.bak.*"), reverse=True)
            for backup in backups:
                try:
                    return json.loads(backup.read_text(encoding="utf-8"))
                except Exception:
                    continue
    return {"version": "scu-cli-config-v1", "created_at": now_str()}


def save_config(path: Path, data: Dict[str, Any]) -> None:
    data["updated_at"] = now_str()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup_path = path.parent / f"config.json.bak.{datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        try:
            shutil.copy2(str(path), str(backup_path))
        except Exception:
            pass
        backups = sorted(path.parent.glob("config.json.bak.*"), reverse=True)
        for old in backups[20:]:
            old.unlink(missing_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def upsert_project_index(config_path: Path, project_name: str, project_root: str, state_file: str) -> None:
    cfg = load_config(config_path)
    projects = cfg.get("projects", [])
    if not isinstance(projects, list):
        projects = []
    row = {
        "name": project_name,
        "project_root": project_root,
        "state_file": state_file,
        "last_used_at": now_str(),
    }
    projects = [p for p in projects if not (isinstance(p, dict) and str(p.get("state_file", "")) == state_file)]
    projects.insert(0, row)
    cfg["projects"] = projects[:100]
    cfg["current_state_file"] = state_file
    save_config(config_path, cfg)


def resolve_state_file(preferred: str, config_path: Path) -> str:
    if preferred and str(preferred).strip():
        return str(preferred).strip()
    cfg = load_config(config_path)
    cur = str(cfg.get("current_state_file", "")).strip()
    return cur


def get_setting(name: str, config: Dict[str, Any], default: str = "") -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    value = str(config.get(name, "")).strip()
    if value:
        return value
    return default


def mask_secret(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return "***"
    return f"{text[:4]}***{text[-4:]}"


def ensure_setup(config_path: Path, interactive: bool = False) -> Dict[str, Any]:
    config = load_config(config_path)
    if "VIDEO_PROVIDER" not in config:
        config["VIDEO_PROVIDER"] = "ark"
    if "FAL_BASE_URL" not in config:
        config["FAL_BASE_URL"] = "https://queue.fal.run"
    required = {
        "ARK_API_KEY": "",
        "ARK_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3",
        "VOLC_TEXT_MODEL": "",
        "VOLC_VIDEO_MODEL": "",
    }
    missing = [k for k in required if not get_setting(k, config, required[k]).strip()]
    if missing and interactive:
        print("首次使用需要设置火山参数：")
        for key in required:
            current = get_setting(key, config, required[key])
            if key in missing:
                if key == "ARK_API_KEY":
                    val = getpass.getpass("ARK_API_KEY: ").strip()
                    if val:
                        config[key] = val
                else:
                    hint = f" [{current}]" if current else ""
                    val = input(f"{key}{hint}: ").strip()
                    config[key] = val if val else current
            elif key not in config:
                config[key] = current
        save_config(config_path, config)
    for key in required:
        val = get_setting(key, config, required[key])
        if val:
            os.environ[key] = val
    return config


def to_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "model_dump_json"):
        return json.loads(value.model_dump_json())
    return {}


def extract_video_url_from_payload(payload: Any) -> str:
    best = ""
    if isinstance(payload, str):
        payload = payload.strip()
        if payload.startswith("http://") or payload.startswith("https://"):
            return payload
        return ""
    if isinstance(payload, list):
        for item in payload:
            hit = extract_video_url_from_payload(item)
            if hit and any(ext in hit.lower() for ext in [".mp4", ".mov", ".webm", ".m3u8"]):
                return hit
            if hit and not best:
                best = hit
        return best
    if isinstance(payload, dict):
        priority_keys = ["video_url", "videoUrl", "download_url", "downloadUrl", "url", "file_url", "fileUrl"]
        for key in priority_keys:
            value = payload.get(key)
            if isinstance(value, str):
                text = value.strip()
                if text.startswith("http://") or text.startswith("https://"):
                    if any(ext in text.lower() for ext in [".mp4", ".mov", ".webm", ".m3u8"]):
                        return text
                    if not best:
                        best = text
        for _, value in payload.items():
            hit = extract_video_url_from_payload(value)
            if hit and any(ext in hit.lower() for ext in [".mp4", ".mov", ".webm", ".m3u8"]):
                return hit
            if hit and not best:
                best = hit
        return best
    return ""


def as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def load_pricing_config(config_path: Path) -> Dict[str, Any]:
    cfg = load_config(config_path)
    default_input = as_float(get_setting("COST_DEFAULT_INPUT_PER_MTOK", cfg, "2"), 2.0)
    default_output = as_float(get_setting("COST_DEFAULT_OUTPUT_PER_MTOK", cfg, "8"), 8.0)
    currency = get_setting("COST_CURRENCY", cfg, "CNY").strip() or "CNY"
    model_rates: Dict[str, Any] = {}
    raw_model_rates = get_setting("COST_MODEL_RATES", cfg, "").strip()
    if raw_model_rates:
        try:
            obj = json.loads(raw_model_rates)
            if isinstance(obj, dict):
                model_rates = obj
        except Exception:
            model_rates = {}
    return {
        "default_input_per_mtok": default_input,
        "default_output_per_mtok": default_output,
        "currency": currency,
        "model_rates": model_rates,
    }


def parse_usage(result: Any) -> Dict[str, int]:
    usage = getattr(result, "usage", None)
    payload = to_dict(usage) if usage is not None else {}
    prompt_tokens = int(payload.get("prompt_tokens") or payload.get("input_tokens") or 0)
    completion_tokens = int(payload.get("completion_tokens") or payload.get("output_tokens") or 0)
    total_tokens = int(payload.get("total_tokens") or (prompt_tokens + completion_tokens))
    return {
        "prompt_tokens": max(0, prompt_tokens),
        "completion_tokens": max(0, completion_tokens),
        "total_tokens": max(0, total_tokens),
    }


def estimate_usage_cost(model: str, usage: Dict[str, int], pricing: Dict[str, Any]) -> Dict[str, Any]:
    model_rates = pricing.get("model_rates", {}).get(model, {})
    input_rate = as_float(model_rates.get("input_per_mtok"), pricing.get("default_input_per_mtok", 2.0))
    output_rate = as_float(model_rates.get("output_per_mtok"), pricing.get("default_output_per_mtok", 8.0))
    prompt_tokens = int(usage.get("prompt_tokens", 0))
    completion_tokens = int(usage.get("completion_tokens", 0))
    cost = (prompt_tokens / 1_000_000.0) * input_rate + (completion_tokens / 1_000_000.0) * output_rate
    return {
        "currency": str(pricing.get("currency", "CNY") or "CNY"),
        "input_per_mtok": input_rate,
        "output_per_mtok": output_rate,
        "estimated_cost": round(cost, 8),
    }


def persist_usage_summary(state_path: str, usage_rows: List[Dict[str, Any]], usage_summary: Dict[str, Any]) -> None:
    if not str(state_path or "").strip():
        return
    path = Path(state_path)
    state = normalize_state(load_state(path))
    ledger = state.get("usage_cost_ledger", [])
    if not isinstance(ledger, list):
        ledger = []
    ledger.extend(usage_rows)
    state["usage_cost_ledger"] = ledger[-500:]
    summary = state.get("usage_cost_summary", {})
    if not isinstance(summary, dict):
        summary = {}
    summary["currency"] = usage_summary.get("currency", summary.get("currency", "CNY"))
    summary["total_prompt_tokens"] = int(summary.get("total_prompt_tokens", 0)) + int(usage_summary.get("prompt_tokens", 0))
    summary["total_completion_tokens"] = int(summary.get("total_completion_tokens", 0)) + int(usage_summary.get("completion_tokens", 0))
    summary["total_tokens"] = int(summary.get("total_tokens", 0)) + int(usage_summary.get("total_tokens", 0))
    summary["total_calls"] = int(summary.get("total_calls", 0)) + int(usage_summary.get("calls", 0))
    summary["total_estimated_cost"] = round(float(summary.get("total_estimated_cost", 0.0)) + float(usage_summary.get("estimated_cost", 0.0)), 8)
    summary["last_updated_at"] = now_str()
    state["usage_cost_summary"] = summary
    save_state(path, state)


def extract_json(text: str):
    def decode_first_json(candidate: str):
        decoder = json.JSONDecoder()
        idx = 0
        length = len(candidate)
        while idx < length and candidate[idx].isspace():
            idx += 1
        if idx >= length:
            raise ValueError("empty json candidate")
        obj, _ = decoder.raw_decode(candidate, idx)
        return obj

    fenced = re.search(r"```json\s*([\s\S]*?)```", text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return decode_first_json(text)
    except Exception:
        pass
    first_arr = text.find("[")
    last_arr = text.rfind("]")
    if first_arr != -1 and last_arr != -1 and last_arr > first_arr:
        try:
            return decode_first_json(text[first_arr : last_arr + 1])
        except Exception:
            pass
    first_obj = text.find("{")
    last_obj = text.rfind("}")
    if first_obj != -1 and last_obj != -1 and last_obj > first_obj:
        try:
            return decode_first_json(text[first_obj : last_obj + 1])
        except Exception:
            pass
    return decode_first_json(text)


def ensure_client():
    config = ensure_setup(default_config_path(), interactive=False)
    api_key = get_setting("ARK_API_KEY", config, "").strip()
    base_url = get_setting("ARK_BASE_URL", config, "https://ark.cn-beijing.volces.com/api/v3").strip()
    text_model = get_setting("VOLC_TEXT_MODEL", config, "").strip()
    video_model = get_setting("VOLC_VIDEO_MODEL", config, "").strip()
    image_model = get_setting("VOLC_IMAGE_MODEL", config, "").strip()
    if not api_key:
        raise RuntimeError("缺少 ARK_API_KEY")
    if not text_model:
        raise RuntimeError("缺少 VOLC_TEXT_MODEL")
    from volcenginesdkarkruntime import Ark

    client = Ark(base_url=base_url, api_key=api_key, region="cn-beijing")
    return client, text_model, image_model, video_model


def normalize_video_provider(value: str) -> str:
    text = str(value or "").strip().lower()
    if text in {"fal", "falai", "fal.ai"}:
        return "fal"
    return "ark"


def resolve_video_backend(config_path: Optional[Path] = None) -> Dict[str, Any]:
    cfg_path = config_path or default_config_path()
    cfg = ensure_setup(cfg_path, interactive=False)
    provider = normalize_video_provider(get_setting("VIDEO_PROVIDER", cfg, "ark"))
    if provider == "fal":
        fal_api_key = get_setting("FAL_API_KEY", cfg, "").strip()
        fal_video_model = get_setting("FAL_VIDEO_MODEL", cfg, "").strip()
        fal_base_url = get_setting("FAL_BASE_URL", cfg, "https://queue.fal.run").strip() or "https://queue.fal.run"
        if not fal_api_key:
            raise RuntimeError("缺少 FAL_API_KEY")
        if not fal_video_model:
            raise RuntimeError("缺少 FAL_VIDEO_MODEL")
        return {
            "provider": "fal",
            "api_key": fal_api_key,
            "video_model": fal_video_model,
            "base_url": fal_base_url.rstrip("/"),
        }
    client, _, _, video_model = ensure_client()
    if not video_model:
        raise RuntimeError("缺少 VOLC_VIDEO_MODEL")
    return {"provider": "ark", "client": client, "video_model": video_model}


def chat(client: Any, model: str, prompt: str, temperature: float = 0.4, max_tokens: int = 4096) -> str:
    token_cap = max(256, min(4096, int(max_tokens or 4096)))
    result = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=token_cap,
    )
    choices = getattr(result, "choices", None)
    if not choices:
        raise RuntimeError("模型返回为空")
    usage = parse_usage(result)
    if usage["total_tokens"] > 0:
        pricing = load_pricing_config(default_config_path())
        cost_info = estimate_usage_cost(model, usage, pricing)
        CURRENT_USAGE_ROWS.append(
            {
                "time": now_str(),
                "model": model,
                "prompt_tokens": usage["prompt_tokens"],
                "completion_tokens": usage["completion_tokens"],
                "total_tokens": usage["total_tokens"],
                "estimated_cost": cost_info["estimated_cost"],
                "currency": cost_info["currency"],
                "input_per_mtok": cost_info["input_per_mtok"],
                "output_per_mtok": cost_info["output_per_mtok"],
            }
        )
    return choices[0].message.content or ""


def read_text_input(file_path: str) -> str:
    if file_path:
        return Path(file_path).read_text(encoding="utf-8")
    print("请输入文本，输入单独一行 END 结束：")
    lines = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def default_state_path() -> Path:
    return openvshot_home() / "state.json"


def default_checkpoint_dir() -> Path:
    return openvshot_home() / "checkpoints"


def load_state(path: Path) -> Dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"version": "scu-cli-v1", "updated_at": now_str()}


def save_state(path: Path, state: Dict[str, Any]) -> None:
    state["updated_at"] = now_str()
    payload = json.dumps(state, ensure_ascii=False, indent=2)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(payload, encoding="utf-8")
    os.replace(str(temp_path), str(path))
    ckpt_dir = default_checkpoint_dir()
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    ckpt_file = ckpt_dir / f"{path.stem}_{stamp}.json"
    ckpt_file.write_text(payload, encoding="utf-8")
    history = sorted(ckpt_dir.glob(f"{path.stem}_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in history[20:]:
        old.unlink(missing_ok=True)


def acquire_state_lock(path: Path, timeout_sec: float = 20.0) -> Path:
    lock_path = path.with_suffix(path.suffix + ".lock")
    deadline = time.time() + max(1.0, timeout_sec)
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return lock_path
        except FileExistsError:
            if time.time() >= deadline:
                raise RuntimeError(f"状态文件正忙，请稍后重试: {path}")
            time.sleep(0.05)


def release_state_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink(missing_ok=True)
    except Exception:
        pass


def append_event(event_type: str, details: Dict[str, Any]) -> None:
    line = {"time": now_str(), "event": event_type, "details": details}
    journal = openvshot_home() / "journal.jsonl"
    journal.parent.mkdir(parents=True, exist_ok=True)
    with journal.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def normalize_state(state: Dict[str, Any]) -> Dict[str, Any]:
    if "assets" not in state or not isinstance(state.get("assets"), dict):
        state["assets"] = {"faces": [], "scenes": []}
    if "shots" not in state or not isinstance(state.get("shots"), list):
        state["shots"] = []
    if "render_tasks" not in state or not isinstance(state.get("render_tasks"), list):
        state["render_tasks"] = []
    if "render_results" not in state or not isinstance(state.get("render_results"), list):
        state["render_results"] = []
    if "approved_shots" not in state or not isinstance(state.get("approved_shots"), list):
        state["approved_shots"] = []
    if "workflow" not in state or not isinstance(state.get("workflow"), dict):
        state["workflow"] = {"stage": "idle", "next_action": "session-start"}
    if "project_root" not in state:
        state["project_root"] = ""
    if "asset_registry" not in state or not isinstance(state.get("asset_registry"), dict):
        state["asset_registry"] = {"face": {}, "scene": {}}
    if "asset_active" not in state or not isinstance(state.get("asset_active"), dict):
        state["asset_active"] = {"face": {}, "scene": {}}
    if "asset_lock" not in state or not isinstance(state.get("asset_lock"), dict):
        state["asset_lock"] = {"face": {}, "scene": {}}
    state["asset_lock"].setdefault("face", {})
    state["asset_lock"].setdefault("scene", {})
    if "voiceover" not in state or not isinstance(state.get("voiceover"), dict):
        state["voiceover"] = {}
    ensure_asset_structures(state)
    if not state["asset_registry"].get("face") and isinstance(state.get("assets", {}).get("faces"), list):
        for item in state.get("assets", {}).get("faces", []):
            if isinstance(item, dict) and item.get("name") and item.get("file"):
                register_asset_version(
                    state,
                    "face",
                    str(item.get("name")),
                    str(item.get("file")),
                    prompt=str(item.get("prompt", "")),
                    source="legacy",
                    remote_url=str(item.get("remote_url", "")),
                )
    if not state["asset_registry"].get("scene") and isinstance(state.get("assets", {}).get("scenes"), list):
        for item in state.get("assets", {}).get("scenes", []):
            if isinstance(item, dict) and item.get("name") and item.get("file"):
                register_asset_version(
                    state,
                    "scene",
                    str(item.get("name")),
                    str(item.get("file")),
                    prompt=str(item.get("prompt", "")),
                    source="legacy",
                    remote_url=str(item.get("remote_url", "")),
                )
    sync_active_assets_lists(state)
    return state


def get_project_root(state: Dict[str, Any]) -> Path:
    root = str(state.get("project_root", "")).strip()
    if not root:
        raise RuntimeError("未设置项目目录，请先执行 project-init")
    return Path(root)


def project_path(state: Dict[str, Any], relative: str) -> Path:
    return get_project_root(state) / relative


def ensure_asset_structures(state: Dict[str, Any]) -> None:
    if "asset_registry" not in state or not isinstance(state.get("asset_registry"), dict):
        state["asset_registry"] = {"face": {}, "scene": {}}
    state["asset_registry"].setdefault("face", {})
    state["asset_registry"].setdefault("scene", {})
    if "asset_active" not in state or not isinstance(state.get("asset_active"), dict):
        state["asset_active"] = {"face": {}, "scene": {}}
    state["asset_active"].setdefault("face", {})
    state["asset_active"].setdefault("scene", {})


def sync_active_assets_lists(state: Dict[str, Any]) -> None:
    ensure_asset_structures(state)
    faces = []
    scenes = []
    for kind, dest in [("face", faces), ("scene", scenes)]:
        reg = state["asset_registry"].get(kind, {})
        active = state["asset_active"].get(kind, {})
        for name, version in active.items():
            entry = reg.get(name, {})
            versions = entry.get("versions", [])
            match = next((v for v in versions if int(v.get("version", 0)) == int(version)), None)
            if not match:
                continue
            dest.append(
                {
                    "name": name,
                    "file": match.get("file", ""),
                    "remote_url": match.get("remote_url", ""),
                    "version": int(match.get("version", 0)),
                    "tag": match.get("tag", ""),
                    "prompt": match.get("prompt", ""),
                    "created_at": match.get("created_at", ""),
                    "previous_version": 0,
                    "previous_file": "",
                    "previous_remote_url": "",
                    "previous_created_at": "",
                }
            )
            if dest:
                prev_versions = [v for v in versions if int(v.get("version", 0)) < int(match.get("version", 0))]
                if prev_versions:
                    prev = sorted(prev_versions, key=lambda x: int(x.get("version", 0)))[-1]
                    dest[-1]["previous_version"] = int(prev.get("version", 0))
                    dest[-1]["previous_file"] = prev.get("file", "")
                    dest[-1]["previous_remote_url"] = prev.get("remote_url", "")
                    dest[-1]["previous_created_at"] = prev.get("created_at", "")
    state["assets"]["faces"] = faces
    state["assets"]["scenes"] = scenes


def get_character_scene_anchors(state: Dict[str, Any]) -> List[str]:
    plan = normalize_stage2_plan(state.get("stage2_plan", {}))
    characters = plan.get("characters", [])
    active_faces = state.get("assets", {}).get("faces", []) if isinstance(state.get("assets"), dict) else []
    face_map = {}
    for item in active_faces:
        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
            if name:
                face_map[name] = item
    anchors: List[str] = []
    for item in characters:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        desc = str(item.get("description", "")).strip()
        active = face_map.get(name, {})
        version = int(active.get("version", 0) or 0)
        file_name = Path(str(active.get("file", "")).strip()).name if active.get("file") else ""
        anchor = f"{name}（设定：{desc or '按角色设定'}）"
        if version > 0:
            anchor += f"，人物素材版本v{version}"
            if file_name:
                anchor += f"，文件{file_name}"
        anchors.append(anchor)
    return anchors


def append_scene_character_constraints(base_prompt: str, state: Dict[str, Any], scene_mode: str) -> str:
    prompt = str(base_prompt or "")
    if scene_mode == "empty_plate":
        return prompt + "空镜模式约束：画面中不得出现任何人物。"
    anchors = get_character_scene_anchors(state)
    if not anchors:
        return prompt + "人物连续性约束：若有人物出镜，仅允许单角色短暂入镜，保持外观与服装稳定。"
    anchor_text = "；".join(anchors[:8])
    return (
        prompt
        + "人物连续性约束：若有人物出镜，只允许使用以下角色锚点，不得新增未知人物："
        + anchor_text
        + "。同一角色必须保持脸部特征、发型、服装主色、关键配饰一致。"
    )


def register_asset_version(
    state: Dict[str, Any],
    kind: str,
    name: str,
    file_path: str,
    prompt: str = "",
    source: str = "generated",
    remote_url: str = "",
) -> Dict[str, Any]:
    ensure_asset_structures(state)
    bucket = state["asset_registry"][kind]
    entry = bucket.setdefault(name, {"name": name, "versions": []})
    versions = entry.get("versions", [])
    next_version = len(versions) + 1
    rec = {
        "version": next_version,
        "tag": f"v{next_version:03d}",
        "file": file_path,
        "prompt": prompt,
        "source": source,
        "remote_url": remote_url,
        "created_at": now_str(),
    }
    versions.append(rec)
    entry["versions"] = versions
    state["asset_active"][kind][name] = next_version
    sync_active_assets_lists(state)
    return rec


def latest_valid_version(versions: List[Dict[str, Any]]) -> int:
    valid = [int(v.get("version", 0)) for v in versions if isinstance(v, dict) and not v.get("deleted")]
    return max(valid) if valid else 0


def set_workflow(state: Dict[str, Any], stage: str, next_action: str) -> None:
    state["workflow"] = {"stage": stage, "next_action": next_action, "updated_at": now_str()}


def compute_status(state: Dict[str, Any]) -> Dict[str, Any]:
    shots = state.get("shots", []) if isinstance(state.get("shots"), list) else []
    approved = set(state.get("approved_shots", []))
    render_results = state.get("render_results", []) if isinstance(state.get("render_results"), list) else []
    rendered = {str(x.get("shot_id", "")) for x in render_results if isinstance(x, dict) and x.get("video_url")}
    pending = [str(s.get("shot_id", "")) for s in shots if isinstance(s, dict) and str(s.get("shot_id", "")) and str(s.get("shot_id", "")) not in rendered]
    unapproved = [str(s.get("shot_id", "")) for s in shots if isinstance(s, dict) and str(s.get("shot_id", "")) and str(s.get("shot_id", "")) not in approved]
    return {
        "title": state.get("title", ""),
        "stage": state.get("workflow", {}).get("stage", "idle"),
        "next_action": state.get("workflow", {}).get("next_action", ""),
        "shots_total": len(shots),
        "shots_rendered": len(rendered),
        "shots_approved": len(approved),
        "pending_shots": pending,
        "unapproved_shots": unapproved,
    }


def compose_prompt_with_assets(state: Dict[str, Any], base_prompt: str) -> str:
    prompt = base_prompt.strip()
    faces = state.get("assets", {}).get("faces", []) if isinstance(state.get("assets"), dict) else []
    scenes = state.get("assets", {}).get("scenes", []) if isinstance(state.get("assets"), dict) else []
    ref_lines = []
    if faces:
        ref_lines.append("character image references: " + "; ".join([f"{x.get('name','')}={x.get('file','')}" for x in faces if isinstance(x, dict)]))
    if scenes:
        ref_lines.append("scene image references: " + "; ".join([f"{x.get('name','')}={x.get('file','')}" for x in scenes if isinstance(x, dict)]))
    if ref_lines:
        return prompt + "\nUse strict visual consistency with references:\n" + "\n".join(ref_lines)
    return prompt


def resolve_image_ref_url(item: Dict[str, Any]) -> str:
    remote_url = str(item.get("remote_url", "")).strip()
    if remote_url.startswith("http://") or remote_url.startswith("https://"):
        return remote_url
    file_value = str(item.get("file", "")).strip()
    if file_value.startswith("http://") or file_value.startswith("https://"):
        return file_value
    try:
        local_path = Path(file_value)
        if local_path.exists() and local_path.is_file():
            mime, _ = mimetypes.guess_type(str(local_path))
            if not mime:
                mime = "image/png"
            data = base64.b64encode(local_path.read_bytes()).decode("ascii")
            return f"data:{mime};base64,{data}"
    except Exception:
        return ""
    return ""


def build_multimodal_content(state: Dict[str, Any], base_prompt: str):
    prompt = compose_prompt_with_assets(state, base_prompt)
    content = [{"type": "text", "text": prompt}]
    faces = (state.get("assets", {}).get("faces", []) or []) if isinstance(state.get("assets"), dict) else []
    scenes = (state.get("assets", {}).get("scenes", []) or []) if isinstance(state.get("assets"), dict) else []
    first_face = ""
    for item in faces:
        if not isinstance(item, dict):
            continue
        first_face = resolve_image_ref_url(item)
        if first_face:
            break
    first_scene = ""
    for item in scenes:
        if not isinstance(item, dict):
            continue
        first_scene = resolve_image_ref_url(item)
        if first_scene:
            break
    if first_face:
        content.append({"type": "image_url", "image_url": {"url": first_face}, "role": "first_frame"})
    if first_scene:
        if first_face:
            content.append({"type": "image_url", "image_url": {"url": first_scene}, "role": "last_frame"})
        else:
            content.append({"type": "image_url", "image_url": {"url": first_scene}, "role": "first_frame"})
    return content


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def get_active_video_model_name(config_path: Optional[Path] = None) -> str:
    cfg_path = config_path or default_config_path()
    cfg = load_config(cfg_path)
    provider = normalize_video_provider(get_setting("VIDEO_PROVIDER", cfg, "ark"))
    if provider == "fal":
        return get_setting("FAL_VIDEO_MODEL", cfg, "").strip()
    return get_setting("VOLC_VIDEO_MODEL", cfg, "").strip()


def is_seedance_model(model_name: str) -> bool:
    return "seedance" in str(model_name or "").strip().lower()


def has_reference_assets(state: Dict[str, Any]) -> bool:
    assets = state.get("assets", {}) if isinstance(state.get("assets"), dict) else {}
    faces = assets.get("faces", []) if isinstance(assets.get("faces"), list) else []
    scenes = assets.get("scenes", []) if isinstance(assets.get("scenes"), list) else []
    return any(isinstance(item, dict) for item in faces) or any(isinstance(item, dict) for item in scenes)


def limit_words(text: str, max_words: int) -> str:
    words = normalize_whitespace(text).split()
    if max_words <= 0 or len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).strip(" ,.;:-")


def sanitize_seedance_prompt_fragment(text: str) -> str:
    cleaned = normalize_whitespace(text)
    if not cleaned:
        return ""
    banned_tokens = [
        "negative prompt",
        "negative prompts",
        "no waxy skin",
        "no uncanny face",
        "no twisted joints",
        "no foot sliding",
        "no limb duplication",
        "no text/logo/watermark",
        "no watermark",
        "no extra subtitles",
        "no random lens jumps",
        "no abrupt style shift",
        "no morphing faces",
        "no sliding feet",
        "no floating limbs",
        "no impossible joint angles",
    ]
    kept_parts: List[str] = []
    for part in re.split(r"(?<=[\.;])\s+|\n+", cleaned):
        normalized = normalize_whitespace(part)
        if not normalized:
            continue
        lower = normalized.lower()
        if any(token in lower for token in banned_tokens):
            continue
        kept_parts.append(normalized.strip(" ,"))
    return normalize_whitespace(" ".join(kept_parts))


def build_shot_generation_guidance(seedance_mode: bool, use_image_refs: bool) -> str:
    if not seedance_mode:
        return (
            "严格要求：每条visual_prompt必须完整包含角色外观与服装、场景空间与时间、镜头景别与机位、主体动作、光线氛围、前后景层次、关键道具。"
            "每条visual_prompt至少45个英文单词，避免泛化词，禁止使用\"beautiful\"、\"nice\"、\"cinematic\"这类空泛描述。"
            "每条visual_prompt必须写出动作分解：起始姿态、主动作推进、动作收势、结束姿态；并注明肢体与道具接触关系。"
            "每条visual_prompt必须明确禁止假人感与畸形动作：no waxy skin, no uncanny face, no twisted joints, no foot sliding, no limb duplication."
            "不同镜头之间要有连续性，角色与场景命名保持一致。"
        )
    min_words, max_words = (50, 80) if use_image_refs else (120, 280)
    return (
        "目标视频模型包含Seedance，请按五模块生成每条visual_prompt：Subject、Action、Camera、Style、Quality。"
        "Action只保留一个清晰主动作动词，不要同时塞入多个并行动作。"
        "Style必须使用组合描述并给出稳定风格锚点，可优先使用胶片或摄影体系表达，如Kodak Vision3 500T。"
        "Quality模块结尾固定补上“4K, Ultra HD, Sharp clarity”。"
        f"每条visual_prompt控制在{min_words}-{max_words}个英文单词。"
        "禁止写否定提示词，禁止写Negative prompt字段。"
        "若存在参考图，优先保持第一张参考图中的角色身份、服装和脸部特征一致。"
        "不同镜头之间保持角色命名、服装、场景空间和视线方向连续。"
    )


def clamp_video_duration_for_model(model_name: str, duration: int) -> int:
    normalized = max(1, int(duration or 1))
    model_lower = str(model_name or "").strip().lower()
    if "seedance-1-5-pro" in model_lower:
        return normalized if normalized in {5, 10} else 5
    if "seedance" in model_lower:
        return min(15, normalized)
    return normalized


def build_seedance_shot_prompt(state: Dict[str, Any], shot: Dict[str, Any], base_prompt: str) -> str:
    prompt_core = sanitize_seedance_prompt_fragment(base_prompt)
    subtitle = normalize_whitespace(str(shot.get("subtitle", "")))
    shots = state.get("shots", []) if isinstance(state.get("shots"), list) else []
    shot_id = str(shot.get("shot_id", "")).strip()
    current_index = -1
    for idx, item in enumerate(shots):
        if isinstance(item, dict) and str(item.get("shot_id", "")).strip() == shot_id:
            current_index = idx
            break
    prev_shot = shots[current_index - 1] if current_index > 0 and isinstance(shots[current_index - 1], dict) else {}
    next_shot = shots[current_index + 1] if 0 <= current_index < len(shots) - 1 and isinstance(shots[current_index + 1], dict) else {}
    prev_hint = normalize_whitespace(str(prev_shot.get("subtitle", "")))
    next_hint = normalize_whitespace(str(next_shot.get("subtitle", "")))
    assets = state.get("assets", {}) if isinstance(state.get("assets"), dict) else {}
    faces = assets.get("faces", []) if isinstance(assets.get("faces"), list) else []
    scenes = assets.get("scenes", []) if isinstance(assets.get("scenes"), list) else []
    has_face_ref = any(isinstance(item, dict) for item in faces)
    has_scene_ref = any(isinstance(item, dict) for item in scenes)
    use_image_refs = has_face_ref or has_scene_ref
    subject_limit = 26 if use_image_refs else 155
    action_limit = 12 if use_image_refs else 16
    camera_limit = 18 if use_image_refs else 24
    style_limit = 12 if use_image_refs else 18
    subject_text = limit_words(prompt_core or subtitle or "single grounded subject in a coherent story world", subject_limit)
    action_text = limit_words(subtitle or "perform one clear continuous action", action_limit)
    camera_segments = ["one shot, one dominant action, smooth start and finish"]
    if prev_hint:
        camera_segments.append(f"carry over from previous beat: {prev_hint}")
    if next_hint:
        camera_segments.append(f"land naturally into next beat: {next_hint}")
    if has_face_ref:
        camera_segments.append("prioritize the first reference image for identity, hair, outfit, and face shape consistency")
    if has_scene_ref:
        camera_segments.append("keep the same spatial layout and perspective from the scene reference")
    camera_text = limit_words("; ".join(camera_segments), camera_limit)
    style_source = normalize_whitespace(str(state.get("art_style", "")))
    style_anchor = style_source or "Kodak Vision3 500T, realistic film texture"
    if "kodak" not in style_anchor.lower() and "vision3" not in style_anchor.lower():
        style_anchor = f"{style_anchor}, Kodak Vision3 500T"
    style_text = limit_words(style_anchor, style_limit)
    return " ".join(
        [
            f"Subject: {subject_text}.",
            f"Action: {action_text}.",
            f"Camera: {camera_text}.",
            f"Style: {style_text}.",
            "Quality: 4K, Ultra HD, Sharp clarity.",
        ]
    ).strip()


def build_render_prompt(state: Dict[str, Any], shot: Dict[str, Any], base_prompt: str, video_model: str) -> str:
    if is_seedance_model(video_model):
        return build_seedance_shot_prompt(state, shot, base_prompt)
    return build_detailed_shot_prompt(state, shot, base_prompt)


def build_detailed_shot_prompt(state: Dict[str, Any], shot: Dict[str, Any], base_prompt: str) -> str:
    prompt = str(base_prompt or "").strip()
    shot_id = str(shot.get("shot_id", "")).strip()
    subtitle = str(shot.get("subtitle", "")).strip()
    duration = int(float(shot.get("duration_sec", 5) or 5))
    shots = state.get("shots", []) if isinstance(state.get("shots"), list) else []
    current_index = -1
    for idx, item in enumerate(shots):
        if not isinstance(item, dict):
            continue
        if str(item.get("shot_id", "")).strip() == shot_id:
            current_index = idx
            break
    prev_shot = shots[current_index - 1] if current_index > 0 and isinstance(shots[current_index - 1], dict) else {}
    next_shot = shots[current_index + 1] if 0 <= current_index < len(shots) - 1 and isinstance(shots[current_index + 1], dict) else {}
    prev_hint = str(prev_shot.get("subtitle", "")).strip()
    next_hint = str(next_shot.get("subtitle", "")).strip()
    action_seed = subtitle or "subject performs one clear, physically plausible action without teleporting."
    beat_plan = (
        f"Shot action plan for {shot_id or 'current shot'} ({duration}s):\n"
        f"- Core action: {action_seed}\n"
        "- Beat A (0%-20%): establish start pose with natural breathing, tiny head/eye adjustment, and clear prop contact.\n"
        "- Beat B (20%-55%): execute main action with smooth joint arcs (neck-shoulder-elbow-wrist, hip-knee-ankle) and stable center of gravity.\n"
        "- Beat C (55%-85%): complete follow-through plus one subtle secondary motion (blink, shoulder relaxation, cloth settle).\n"
        "- Beat D (85%-100%): settle into end pose that can naturally connect to next shot without freezing like a mannequin.\n"
    )
    transition_plan = (
        f"Continuity constraints:\n"
        f"- Previous shot context: {prev_hint or 'none'}\n"
        f"- Next shot context: {next_hint or 'none'}\n"
        "- Preserve screen direction, eye-line, and body orientation unless explicitly motivated.\n"
        "- Keep camera movement physically smooth (no random jump zoom, no abrupt orbit, no whip without motivation).\n"
        "- Keep one dominant action thread and allow one subtle secondary motion for realism; avoid chaotic unrelated gestures.\n"
        "- Motion rhythm should be ease-in/ease-out, not constant-speed robotic movement.\n"
    )
    anatomy_plan = (
        "Anatomy and motion realism constraints:\n"
        "- No twisted wrists, broken elbows, dislocated shoulders, inverted knees, or foot sliding.\n"
        "- Hands and fingers must keep coherent count and structure; no duplicated or melted limbs.\n"
        "- Cloth, hair, and props follow motion inertia; avoid frame-to-frame popping.\n"
        "- Keep micro-expression continuity (blink rate, lip tension, jaw movement) to avoid uncanny stiffness.\n"
    )
    return f"{prompt}\n{beat_plan}{transition_plan}{anatomy_plan}"


def apply_video_generation_constraints(base_prompt: str) -> str:
    return (
        base_prompt.strip()
        + "\nHard video constraints: keep the same character identity, same outfit palette, same key props, and same scene geometry across frames."
        + "\nCamera and motion constraints: stable camera language, no random lens jumps, no abrupt style shift, no morphing faces."
        + "\nNatural motion style: avoid over-constrained rigid acting; keep subtle breathing, eye saccades, cloth inertia, and ease-in/ease-out timing."
        + "\nHuman realism constraints: natural face proportions, natural skin texture, natural blinking and lip motion, no waxy doll-like skin, no uncanny facial deformation."
        + "\nBody mechanics constraints: physically plausible weight transfer, grounded footsteps, coherent hand-object contact, no sliding feet, no floating limbs, no impossible joint angles."
        + "\nTransition constraints: one dominant action plus optional subtle secondary motion per shot, smooth start-to-end pose continuity, no abrupt pose teleportation during scene transitions."
        + "\nQuality constraints: cinematic realistic lighting, coherent shadows, clean edges, no text/logo/watermark, no extra limbs or deformed anatomy."
    )


def submit_video_task(
    client,
    video_model: str,
    state: Dict[str, Any],
    prompt: str,
    duration: int,
    ratio: str,
    strict_multimodal: bool = False,
    submission_meta: Any = None,
):
    constrained_prompt = apply_video_generation_constraints(prompt)
    content_items = build_multimodal_content(state, constrained_prompt)
    image_ref_count = sum(1 for x in content_items if isinstance(x, dict) and str(x.get("type", "")) == "image_url")
    has_face_ref = any(isinstance(x, dict) and str(x.get("type", "")) == "image_url" and str(x.get("role", "")) == "first_frame" for x in content_items)
    has_scene_ref = any(isinstance(x, dict) and str(x.get("type", "")) == "image_url" and str(x.get("role", "")) == "last_frame" for x in content_items)
    if submission_meta is not None and isinstance(submission_meta, dict):
        submission_meta["request_mode"] = "multimodal"
        submission_meta["image_ref_count"] = image_ref_count
        submission_meta["has_face_ref"] = bool(has_face_ref)
        submission_meta["has_scene_ref"] = bool(has_scene_ref)
        submission_meta["constraints_applied"] = True
    def run_create(duration_value: int, text_only: bool = False):
        if text_only:
            if submission_meta is not None and isinstance(submission_meta, dict):
                submission_meta["request_mode"] = "text_fallback"
            return client.content_generation.tasks.create(
                model=video_model,
                content=[{"type": "text", "text": compose_prompt_with_assets(state, constrained_prompt)}],
                duration=duration_value,
                ratio=ratio,
            )
        return client.content_generation.tasks.create(
            model=video_model,
            content=content_items,
            duration=duration_value,
            ratio=ratio,
        )
    def is_duration_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        return "duration" in msg and ("not valid" in msg or "invalidparameter" in msg or "badrequest" in msg)
    def duration_candidates(req: int) -> List[int]:
        requested = clamp_video_duration_for_model(video_model, int(req or 1))
        model_name = str(video_model or "").lower()
        if "seedance-1-5-pro" in model_name:
            ordered = [requested, 5, 10]
        elif "seedance" in model_name:
            ordered = [requested, 5, 10, 15, 8, 6, 4]
        else:
            ordered = [requested, 5, 4, 6, 8, 10]
        seen: set = set()
        out: List[int] = []
        for x in ordered:
            v = max(1, int(x))
            if v in seen:
                continue
            seen.add(v)
            out.append(v)
        return out
    candidates = duration_candidates(duration)
    first_error: Exception = RuntimeError("未知视频提交错误")
    try:
        return run_create(candidates[0], text_only=False)
    except Exception as exc:
        first_error = exc
        if strict_multimodal:
            raise RuntimeError(f"多模态提交失败: {exc}")
    for cand in candidates[1:]:
        try:
            return run_create(cand, text_only=False)
        except Exception as exc:
            if not is_duration_error(exc):
                first_error = exc
                break
            first_error = exc
    for cand in candidates:
        try:
            return run_create(cand, text_only=True)
        except Exception as exc:
            if not is_duration_error(exc):
                first_error = exc
                break
            first_error = exc
    raise RuntimeError(f"视频任务提交失败: {first_error}")


def fal_submit_video_task(
    api_key: str,
    base_url: str,
    video_model: str,
    state: Dict[str, Any],
    prompt: str,
    duration: int,
    ratio: str,
    submission_meta: Any = None,
    retry_count: int = 2,
    retry_wait: float = 1.5,
) -> Dict[str, Any]:
    constrained_prompt = apply_video_generation_constraints(prompt) if not is_seedance_model(video_model) else prompt
    final_prompt = compose_prompt_with_assets(state, constrained_prompt)
    max_prompt_len = 2400
    if len(final_prompt) > max_prompt_len:
        final_prompt = final_prompt[:max_prompt_len]
    payload = {
        "prompt": final_prompt,
        "duration": clamp_video_duration_for_model(video_model, int(max(1, duration))),
        "aspect_ratio": str(ratio or "9:16"),
        "ratio": str(ratio or "9:16"),
    }
    headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}
    endpoint = f"{base_url.rstrip('/')}/{str(video_model).lstrip('/')}"
    response = None
    error_text = ""
    max_attempts = max(1, int(retry_count or 0) + 1)
    for attempt in range(max_attempts):
        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=60)
            if response.status_code < 500 and response.status_code != 429:
                break
            error_text = f"HTTP {response.status_code} {response.text[:300]}"
        except requests.RequestException as exc:
            error_text = str(exc)
        if attempt < max_attempts - 1:
            time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
    if response is None:
        raise RuntimeError(f"fal 提交失败: {error_text or '无响应'}")
    if response.status_code >= 400:
        fallback = None
        fallback_error = ""
        for attempt in range(max_attempts):
            try:
                fallback = requests.post(endpoint, headers=headers, json={"input": payload}, timeout=60)
                if fallback.status_code < 500 and fallback.status_code != 429:
                    break
                fallback_error = f"HTTP {fallback.status_code} {fallback.text[:300]}"
            except requests.RequestException as exc:
                fallback_error = str(exc)
            if attempt < max_attempts - 1:
                time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
        if fallback is None:
            raise RuntimeError(f"fal 提交失败: {fallback_error or '无响应'}")
        if fallback.status_code >= 400:
            raise RuntimeError(f"fal 提交失败: HTTP {fallback.status_code} {fallback.text[:300]}")
        response = fallback
    body = response.json()
    request_id = str(body.get("request_id", "")).strip()
    if not request_id:
        raise RuntimeError("fal 返回缺少 request_id")
    if submission_meta is not None and isinstance(submission_meta, dict):
        submission_meta["request_mode"] = "fal_queue"
        submission_meta["image_ref_count"] = 0
        submission_meta["has_face_ref"] = False
        submission_meta["has_scene_ref"] = False
        submission_meta["constraints_applied"] = True
        submission_meta["provider"] = "fal"
        submission_meta["status_url"] = str(body.get("status_url", "")).strip()
        submission_meta["response_url"] = str(body.get("response_url", "")).strip()
    return body


def fal_poll_video_result(
    api_key: str,
    base_url: str,
    video_model: str,
    request_id: str,
    interval: int,
    timeout: int,
    status_url: str = "",
    response_url: str = "",
    retry_count: int = 2,
    retry_wait: float = 1.5,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}
    safe_model = str(video_model).lstrip("/")
    status_endpoint = status_url.strip() or f"{base_url.rstrip('/')}/{safe_model}/requests/{request_id}/status"
    response_endpoint = response_url.strip() or f"{base_url.rstrip('/')}/{safe_model}/requests/{request_id}"
    deadline = time.time() + max(1, int(timeout or 1))
    last_status = ""
    while time.time() < deadline:
        status_resp = None
        status_error = ""
        max_attempts = max(1, int(retry_count or 0) + 1)
        for attempt in range(max_attempts):
            try:
                status_resp = requests.get(status_endpoint, headers=headers, timeout=60)
                if status_resp.status_code < 500 and status_resp.status_code != 429:
                    break
                status_error = f"HTTP {status_resp.status_code} {status_resp.text[:300]}"
            except requests.RequestException as exc:
                status_error = str(exc)
            if attempt < max_attempts - 1:
                time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
        if status_resp is None:
            raise RuntimeError(f"fal 查询状态失败: {status_error or '无响应'}")
        if status_resp.status_code >= 400:
            raise RuntimeError(f"fal 查询状态失败: HTTP {status_resp.status_code} {status_resp.text[:300]}")
        status_body = status_resp.json()
        last_status = str(status_body.get("status", "")).strip()
        if last_status.upper() == "COMPLETED":
            result_resp = None
            result_error = ""
            for attempt in range(max_attempts):
                try:
                    result_resp = requests.get(response_endpoint, headers=headers, timeout=120)
                    if result_resp.status_code < 500 and result_resp.status_code != 429:
                        break
                    result_error = f"HTTP {result_resp.status_code} {result_resp.text[:300]}"
                except requests.RequestException as exc:
                    result_error = str(exc)
                if attempt < max_attempts - 1:
                    time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
            if result_resp is None:
                raise RuntimeError(f"fal 获取结果失败: {result_error or '无响应'}")
            if result_resp.status_code >= 400:
                raise RuntimeError(f"fal 获取结果失败: HTTP {result_resp.status_code} {result_resp.text[:300]}")
            result_body = result_resp.json()
            output_payload_obj = result_body.get("payload", result_body)
            video_url = extract_video_url_from_payload(output_payload_obj)
            return {"status": last_status, "video_url": video_url, "payload": result_body}
        if last_status.upper() in {"FAILED", "ERROR", "CANCELLED"}:
            return {"status": last_status, "video_url": "", "payload": status_body}
        time.sleep(max(1, int(interval or 3)))
    return {"status": last_status or "TIMEOUT", "video_url": "", "payload": {}}


def fal_poll_request(
    api_key: str,
    base_url: str,
    endpoint: str,
    request_id: str,
    interval: int,
    timeout: int,
    status_url: str = "",
    response_url: str = "",
    retry_count: int = 2,
    retry_wait: float = 1.5,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}
    safe_endpoint = str(endpoint).lstrip("/")
    status_endpoint = status_url.strip() or f"{base_url.rstrip('/')}/{safe_endpoint}/requests/{request_id}/status"
    response_endpoint = response_url.strip() or f"{base_url.rstrip('/')}/{safe_endpoint}/requests/{request_id}"
    deadline = time.time() + max(1, int(timeout or 1))
    last_status = ""
    last_status_payload: Dict[str, Any] = {}
    while time.time() < deadline:
        status_resp = None
        status_error = ""
        max_attempts = max(1, int(retry_count or 0) + 1)
        for attempt in range(max_attempts):
            try:
                status_resp = requests.get(status_endpoint, headers=headers, timeout=60)
                if status_resp.status_code < 500 and status_resp.status_code != 429:
                    break
                status_error = f"HTTP {status_resp.status_code} {status_resp.text[:300]}"
            except requests.RequestException as exc:
                status_error = str(exc)
            if attempt < max_attempts - 1:
                time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
        if status_resp is None:
            raise RuntimeError(f"fal 查询状态失败: {status_error or '无响应'}")
        if status_resp.status_code >= 400:
            raise RuntimeError(f"fal 查询状态失败: HTTP {status_resp.status_code} {status_resp.text[:300]}")
        status_body = status_resp.json()
        last_status_payload = status_body if isinstance(status_body, dict) else {}
        last_status = str(last_status_payload.get("status", "")).strip()
        if last_status.upper() == "COMPLETED":
            result_resp = None
            result_error = ""
            for attempt in range(max_attempts):
                try:
                    result_resp = requests.get(response_endpoint, headers=headers, timeout=120)
                    if result_resp.status_code < 500 and result_resp.status_code != 429:
                        break
                    result_error = f"HTTP {result_resp.status_code} {result_resp.text[:300]}"
                except requests.RequestException as exc:
                    result_error = str(exc)
                if attempt < max_attempts - 1:
                    time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
            if result_resp is None:
                raise RuntimeError(f"fal 获取结果失败: {result_error or '无响应'}")
            if result_resp.status_code >= 400:
                raise RuntimeError(f"fal 获取结果失败: HTTP {result_resp.status_code} {result_resp.text[:300]}")
            result_body = result_resp.json()
            body_obj = result_body if isinstance(result_body, dict) else {}
            output_payload_obj = body_obj.get("payload", body_obj)
            return {
                "status": last_status,
                "video_url": extract_video_url_from_payload(output_payload_obj),
                "payload": body_obj,
                "status_payload": last_status_payload,
            }
        if last_status.upper() in {"FAILED", "ERROR", "CANCELLED"}:
            return {"status": last_status, "video_url": "", "payload": {}, "status_payload": last_status_payload}
        time.sleep(max(1, int(interval or 3)))
    return {"status": last_status or "TIMEOUT", "video_url": "", "payload": {}, "status_payload": last_status_payload}


def read_json_object_arg(raw_text: str, file_path: str) -> Any:
    if str(file_path or "").strip():
        body = Path(file_path).read_text(encoding="utf-8")
        return json.loads(body)
    text = str(raw_text or "").strip()
    if not text:
        return {}
    return json.loads(text)


def resolve_retry_options(args: Any) -> Dict[str, Any]:
    profile = str(getattr(args, "retry_profile", "") or "").strip().lower()
    defaults = {
        "stable": {"retry_count": 2, "retry_wait": 1.5},
        "aggressive": {"retry_count": 4, "retry_wait": 0.8},
        "conservative": {"retry_count": 1, "retry_wait": 2.0},
    }
    resolved_profile = profile or "stable"
    if resolved_profile == "auto":
        command_name = str(getattr(args, "command", "") or "").strip().lower()
        timeout_value = int(getattr(args, "timeout", 0) or 0)
        poll_enabled = bool(getattr(args, "poll", False))
        if command_name in {"fal-workflow-list", "fal-workflow"}:
            resolved_profile = "aggressive"
        elif poll_enabled and timeout_value >= 1800:
            resolved_profile = "conservative"
        else:
            resolved_profile = "stable"
    base = defaults.get(resolved_profile, defaults["stable"])
    retry_count_raw = getattr(args, "retry_count", None)
    retry_wait_raw = getattr(args, "retry_wait", None)
    retry_count = int(retry_count_raw) if retry_count_raw is not None else int(base["retry_count"])
    retry_wait = float(retry_wait_raw) if retry_wait_raw is not None else float(base["retry_wait"])
    return {
        "requested_retry_profile": profile or "stable",
        "retry_profile": resolved_profile,
        "retry_count": max(0, retry_count),
        "retry_wait": max(0.2, retry_wait),
    }


def output_payload(args, payload: Dict[str, Any]) -> None:
    if CURRENT_USAGE_ROWS:
        prompt_tokens = sum(int(x.get("prompt_tokens", 0)) for x in CURRENT_USAGE_ROWS)
        completion_tokens = sum(int(x.get("completion_tokens", 0)) for x in CURRENT_USAGE_ROWS)
        total_tokens = sum(int(x.get("total_tokens", 0)) for x in CURRENT_USAGE_ROWS)
        estimated_cost = round(sum(float(x.get("estimated_cost", 0.0)) for x in CURRENT_USAGE_ROWS), 8)
        currency = str(CURRENT_USAGE_ROWS[-1].get("currency", "CNY"))
        usage_summary = {
            "calls": len(CURRENT_USAGE_ROWS),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "estimated_cost": estimated_cost,
            "currency": currency,
        }
        payload["usage_estimate"] = usage_summary
        payload["usage_rows"] = CURRENT_USAGE_ROWS[-20:]
        persist_usage_summary(str(getattr(args, "state_file", "") or ""), CURRENT_USAGE_ROWS, usage_summary)
    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False))
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def smart_route(user_input: str) -> str:
    text = user_input.strip()
    if any(k in text for k in ["想法", "脑洞", "故事"]):
        return "文学车间-脑洞裂变"
    if any(k in text for k in ["小说", "大纲", "文本", "剧本"]):
        return "文学车间-剧本转译"
    if any(k in text for k in ["定妆", "角色", "场景", "视觉"]):
        return "视觉车间-资产扫描"
    if any(k in text for k in ["分镜", "怎么拍", "镜头"]):
        return "导演车间-七维分镜"
    if any(k in text for k in ["生成视频", "prompt", "出片"]):
        return "铸造车间-视频生成"
    return "启动向导"


def cmd_start(args):
    payload = {
        "ok": True,
        "name": "OpenVShot",
        "mode": "volc-enhanced",
        "quick": [
            "vshot (直接进聊天)",
            "vshot continue (恢复最近项目)",
            "vshot p new --name xxx (新建项目)",
            "vshot p list (项目列表)",
            "vshot p use --name xxx (切换项目)",
            "vshot s (查看状态)",
            "vshot t --refresh (任务进度)",
        ],
        "commands": [
            "setup",
            "project-init",
            "project-list",
            "project-use",
            "project-open",
            "p",
            "continue",
            "chat",
            "session-start",
            "session-step",
            "session-state",
            "session-close",
            "status",
            "resume",
            "tasks-list",
            "router",
            "brainhole",
            "scriptwriter",
            "storyboard",
            "character-design",
            "scene-design",
            "asset-list",
            "asset-activate",
            "asset-remove-version",
            "asset-lock",
            "forge",
            "plan",
            "revise",
            "pipeline",
            "render",
            "render-status",
            "fal-workflow",
            "render-shots",
            "run",
            "archive",
            "shell",
        ],
    }
    output_payload(args, payload)


def cmd_setup(args):
    path = Path(args.config_file) if args.config_file else default_config_path()
    config = ensure_setup(path, interactive=True)
    masked = dict(config)
    if masked.get("ARK_API_KEY"):
        key = str(masked["ARK_API_KEY"])
        masked["ARK_API_KEY"] = f"{key[:4]}***{key[-4:]}" if len(key) > 8 else "***"
    if masked.get("FAL_API_KEY"):
        fkey = str(masked["FAL_API_KEY"])
        masked["FAL_API_KEY"] = f"{fkey[:4]}***{fkey[-4:]}" if len(fkey) > 8 else "***"
    output_payload(args, {"ok": True, "config_file": str(path), "config": masked})


def mask_api_key(value: str) -> str:
    secret = str(value or "").strip()
    if not secret:
        return ""
    if len(secret) <= 8:
        return "***"
    return f"{secret[:4]}***{secret[-4:]}"


def group_model_kind(model_id: str) -> str:
    lower = str(model_id or "").lower()
    if any(token in lower for token in ["video", "seedance", "cogvideo", "hunyuanvideo", "wan2"]):
        return "video"
    if any(token in lower for token in ["image", "img", "diffusion", "sd", "flux", "seedream"]):
        return "image"
    if any(token in lower for token in ["audio", "speech", "voice", "tts", "asr", "music"]):
        return "audio"
    return "text"


def detect_provider(model_id: str, owned_by: str = "") -> str:
    lower = f"{model_id} {owned_by}".lower()
    rules = [
        ("doubao", "Doubao"),
        ("deepseek", "DeepSeek"),
        ("glm", "GLM"),
        ("zhipu", "GLM"),
        ("kimi", "Kimi"),
        ("moonshot", "Kimi"),
        ("qwen", "Qwen"),
        ("baichuan", "Baichuan"),
        ("yi-", "Yi"),
        ("internlm", "InternLM"),
        ("llama", "Llama"),
        ("claude", "Claude"),
        ("gemini", "Gemini"),
        ("mistral", "Mistral"),
    ]
    for key, name in rules:
        if key in lower:
            return name
    return "Other"


def parse_param_b(model_id: str) -> float:
    lower = str(model_id or "").lower()
    match = re.search(r"(\d+(?:\.\d+)?)\s*b\b", lower)
    if not match:
        return 0.0
    try:
        return float(match.group(1))
    except Exception:
        return 0.0


def normalize_model_rows(data: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    items = []
    if isinstance(data, dict):
        items = data.get("data", [])
    elif hasattr(data, "data"):
        items = getattr(data, "data", [])
    if not isinstance(items, list):
        return rows
    for item in items:
        obj = to_dict(item)
        model_id = str(obj.get("id", "")).strip()
        if not model_id:
            continue
        rows.append(
            {
                "id": model_id,
                "kind": group_model_kind(model_id),
                "owned_by": str(obj.get("owned_by", "")).strip(),
                "provider": detect_provider(model_id, str(obj.get("owned_by", "")).strip()),
                "param_b": parse_param_b(model_id),
                "raw": obj,
            }
        )
    return rows


def fetch_models_http(api_key: str, base_url: str) -> Any:
    url = f"{base_url.rstrip('/')}/models"
    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
    return response.json()


def cmd_config_set(args):
    cfg_path = Path(args.config_file) if args.config_file else default_config_path()
    cfg = load_config(cfg_path)
    updates = {
        "VIDEO_PROVIDER": normalize_video_provider(str(args.video_provider or "").strip()) if str(args.video_provider or "").strip() else "",
        "ARK_API_KEY": str(args.ark_api_key or "").strip(),
        "ARK_BASE_URL": str(args.ark_base_url or "").strip(),
        "VOLC_TEXT_MODEL": str(args.text_model or "").strip(),
        "VOLC_IMAGE_MODEL": str(args.image_model or "").strip(),
        "VOLC_VIDEO_MODEL": str(args.video_model or "").strip(),
        "VOLC_AUDIO_MODEL": str(args.audio_model or "").strip(),
        "VOLC_TTS_APP_ID": str(getattr(args, "tts_app_id", "") or "").strip(),
        "VOLC_TTS_ACCESS_TOKEN": str(getattr(args, "tts_access_token", "") or "").strip(),
        "VOLC_TTS_VOICE_TYPE": str(getattr(args, "tts_voice_type", "") or "").strip(),
        "VOLC_TTS_BASE_URL": str(getattr(args, "tts_base_url", "") or "").strip(),
        "FAL_API_KEY": str(args.fal_api_key or "").strip(),
        "FAL_BASE_URL": str(args.fal_base_url or "").strip(),
        "FAL_VIDEO_MODEL": str(args.fal_video_model or "").strip(),
        "FAL_IMAGE_MODEL": str(getattr(args, "fal_image_model", "") or "").strip(),
    }
    for key, value in updates.items():
        if value:
            cfg[key] = value
            os.environ[key] = value
    save_config(cfg_path, cfg)
    output_payload(
        args,
        {
            "ok": True,
            "config_file": str(cfg_path),
            "saved": {
                "ARK_API_KEY": mask_api_key(str(cfg.get("ARK_API_KEY", ""))),
                "ARK_BASE_URL": str(cfg.get("ARK_BASE_URL", "")),
                "VIDEO_PROVIDER": normalize_video_provider(str(cfg.get("VIDEO_PROVIDER", "ark"))),
                "VOLC_TEXT_MODEL": str(cfg.get("VOLC_TEXT_MODEL", "")),
                "VOLC_IMAGE_MODEL": str(cfg.get("VOLC_IMAGE_MODEL", "")),
                "VOLC_VIDEO_MODEL": str(cfg.get("VOLC_VIDEO_MODEL", "")),
                "VOLC_AUDIO_MODEL": str(cfg.get("VOLC_AUDIO_MODEL", "")),
                "VOLC_TTS_APP_ID": str(cfg.get("VOLC_TTS_APP_ID", "")),
                "VOLC_TTS_ACCESS_TOKEN": mask_secret(str(cfg.get("VOLC_TTS_ACCESS_TOKEN", ""))),
                "VOLC_TTS_VOICE_TYPE": str(cfg.get("VOLC_TTS_VOICE_TYPE", "")),
                "VOLC_TTS_BASE_URL": str(cfg.get("VOLC_TTS_BASE_URL", "")),
                "FAL_API_KEY": mask_api_key(str(cfg.get("FAL_API_KEY", ""))),
                "FAL_BASE_URL": str(cfg.get("FAL_BASE_URL", "")),
                "FAL_VIDEO_MODEL": str(cfg.get("FAL_VIDEO_MODEL", "")),
                "FAL_IMAGE_MODEL": str(cfg.get("FAL_IMAGE_MODEL", "")),
            },
        },
    )


def cmd_volc_models(args):
    cfg_path = Path(args.config_file) if args.config_file else default_config_path()
    cfg = load_config(cfg_path)
    api_key = str(args.ark_api_key or "").strip() or get_setting("ARK_API_KEY", cfg, "").strip()
    base_url = str(args.ark_base_url or "").strip() or get_setting("ARK_BASE_URL", cfg, "https://ark.cn-beijing.volces.com/api/v3").strip()
    if not api_key:
        raise RuntimeError("缺少 ARK_API_KEY")
    rows: List[Dict[str, Any]] = []
    fetch_method = ""
    errors: List[str] = []
    from volcenginesdkarkruntime import Ark

    client = Ark(base_url=base_url, api_key=api_key, region="cn-beijing")
    models_api = getattr(client, "models", None)
    if models_api and hasattr(models_api, "list"):
        try:
            listing = models_api.list()
            rows = normalize_model_rows(listing)
            fetch_method = "ark.models.list"
        except Exception as exc:
            errors.append(f"ark.models.list失败: {exc}")
    else:
        errors.append("当前Ark SDK未提供 models.list")
    if not rows:
        try:
            listing = fetch_models_http(api_key, base_url)
            rows = normalize_model_rows(listing)
            fetch_method = "http:/models"
        except Exception as exc:
            errors.append(f"HTTP /models失败: {exc}")
    if not rows:
        raise RuntimeError("无法获取模型列表；" + "；".join(errors))
    provider_filter = str(getattr(args, "provider", "all") or "all").strip().lower()
    min_params_b = as_float(getattr(args, "min_params_b", 0) or 0, 0.0)
    filtered_rows = []
    for row in rows:
        provider_name = str(row.get("provider", "其他"))
        param_b = as_float(row.get("param_b", 0.0), 0.0)
        provider_hit = provider_filter == "all" or provider_name.lower() == provider_filter
        param_hit = param_b <= 0 or param_b >= min_params_b
        if provider_hit and param_hit:
            filtered_rows.append(row)
    grouped = {"text": [], "image": [], "video": [], "audio": []}
    for row in filtered_rows:
        grouped[row["kind"]].append(row)
    if args.save_credentials:
        cfg["ARK_API_KEY"] = api_key
        cfg["ARK_BASE_URL"] = base_url
        save_config(cfg_path, cfg)
    selected = {
        "text": str(cfg.get("VOLC_TEXT_MODEL", "")).strip(),
        "image": str(cfg.get("VOLC_IMAGE_MODEL", "")).strip(),
        "video": str(cfg.get("VOLC_VIDEO_MODEL", "")).strip(),
        "audio": str(cfg.get("VOLC_AUDIO_MODEL", "")).strip(),
    }
    output_payload(
        args,
        {
            "ok": True,
            "config_file": str(cfg_path),
            "connection": {"base_url": base_url, "api_key_masked": mask_api_key(api_key), "fetch_method": fetch_method},
            "grouped_models": grouped,
            "selected_models": selected,
            "tts_settings": {
                "app_id": str(cfg.get("VOLC_TTS_APP_ID", "")).strip(),
                "access_token_masked": mask_secret(str(cfg.get("VOLC_TTS_ACCESS_TOKEN", "")).strip()),
                "voice_type": str(cfg.get("VOLC_TTS_VOICE_TYPE", "")).strip(),
                "base_url": str(cfg.get("VOLC_TTS_BASE_URL", "https://openspeech.bytedance.com/api/v3/tts/unidirectional")).strip(),
            },
            "provider_options": sorted(list({str(x.get("provider", "其他")) for x in rows})),
            "filter": {"provider": provider_filter, "min_params_b": min_params_b},
            "model_counts": {"before": len(rows), "after": len(filtered_rows)},
        },
    )


def cmd_router(args):
    output_payload(args, {"ok": True, "route": smart_route(args.input)})


def cmd_brainhole(args):
    client, text_model, _, _ = ensure_client()
    concept = read_text_input(args.input_file) if args.input_file else args.input
    prompt = (
        "你是SCU-OS文学车间的脑洞架构师。"
        "请把输入概念输出为四阶段结构：常态错觉、逻辑断裂、深渊凝视、终极重构。"
        "要求可拍摄、动作化、每段2-3句。"
        "输出JSON数组，结构[{\"id\":1,\"phase\":\"常态错觉\",\"content\":\"...\"}]。"
        f"\n概念：{concept}"
    )
    text = chat(client, text_model, prompt, temperature=0.6)
    data = extract_json(text)
    output_payload(args, {"ok": True, "data": data})


def cmd_scriptwriter(args):
    client, text_model, _, _ = ensure_client()
    src = read_text_input(args.input_file) if args.input_file else args.text
    prompt = (
        "你是SCU-OS剧本改编师。把输入文本转成标准分场剧本。"
        "输出JSON数组，结构[{\"scene_id\":\"SC01\",\"location\":\"...\",\"time\":\"...\",\"environment\":\"...\",\"action\":\"...\",\"dialogue\":[{\"role\":\"A\",\"line\":\"...\"}]}]。"
        "禁止心理描写，用可拍摄动作。"
        f"\n输入文本：{src}"
    )
    text = chat(client, text_model, prompt, temperature=0.4)
    data = extract_json(text)
    output_payload(args, {"ok": True, "data": data})


def cmd_script_draft(args):
    client, text_model, _, _ = ensure_client()
    title = str(getattr(args, "title", "") or "").strip()
    src = read_text_input(args.input_file) if args.input_file else args.text
    src = str(src or "").strip()
    if not src and not title:
        raise RuntimeError("请输入标题或故事梗概")
    source_text = f"标题：{title}\n梗概：{src}".strip()
    scene_count = max(1, min(8, int(getattr(args, "scene_count", 3) or 3)))
    prompt = (
        "你是资深文学编辑与影视编剧，请在保持可拍摄性的前提下提高叙事深度与戏剧张力。"
        "先进行内部创作推演（不要输出推演过程）：至少考虑3条冲突线、2次反转机会、1个主题回收。"
        "再输出最终结果。"
        "不要输出分镜参数，不要输出镜头编号，不要输出“第x集”。"
        "标题必须严格围绕用户标题，不得改题。"
        "输出必须是JSON对象："
        "{\"story_summary\":\"\",\"script_text\":\"\",\"scene_count\":3}"
        f"\nstory_summary要求：120-260字，包含主角目标、阻碍、代价、转折与结局钩子。"
        f"\nscript_text要求：控制在{scene_count}个场景以内；每场景必须有“场景标识/动作/对白”；"
        "对白要有人物意图与潜台词，冲突推进清晰，避免口号化与空泛抒情。"
        "结尾必须有有效回扣或反讽，形成闭环。"
        f"\n输入：{source_text}"
    )
    draft_max_tokens = min(1400, 480 + scene_count * 170)
    text = chat(client, text_model, prompt, temperature=0.42, max_tokens=draft_max_tokens)
    story_summary = ""
    script_text = ""
    data: Any = None
    try:
        data = extract_json(text)
    except Exception:
        data = None
    if isinstance(data, dict):
        story_summary = str(data.get("story_summary", "")).strip()
        script_text = str(data.get("script_text", "")).strip()
        if not script_text:
            script_text = str(data.get("script", "")).strip()
        if not script_text:
            script_text = str(data.get("content", "")).strip()
        if not script_text:
            script_text = str(data.get("text", "")).strip()
    elif isinstance(data, list):
        script_text = json.dumps(data, ensure_ascii=False, indent=2)
    if not script_text:
        cleaned = str(text or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) >= 3:
                cleaned = "\n".join(lines[1:-1]).strip()
        script_text = cleaned
    if not story_summary and script_text:
        snippet = script_text[:220].strip()
        story_summary = f"自动提取摘要：{snippet}" if snippet else ""
    if (len(story_summary) < 40 or len(script_text) < 260) and script_text:
        polish_prompt = (
            "你是资深剧本医生，请在不改变核心设定的前提下重写并加强文本。"
            "只输出JSON对象：{\"story_summary\":\"\",\"script_text\":\"\",\"scene_count\":3}。"
            f"scene_count固定为{scene_count}。"
            "要求：冲突更明确、人物动机更具体、对白更具行为目标、结尾形成记忆点。"
            "不得输出分镜参数。"
            f"\n原标题与输入：{source_text}"
            f"\n待增强摘要：{story_summary}"
            f"\n待增强剧本：{script_text}"
        )
        polished = chat(client, text_model, polish_prompt, temperature=0.38, max_tokens=min(1700, draft_max_tokens + 240))
        polished_data: Any = None
        try:
            polished_data = extract_json(polished)
        except Exception:
            polished_data = None
        if isinstance(polished_data, dict):
            polished_summary = str(polished_data.get("story_summary", "")).strip()
            polished_script = str(polished_data.get("script_text", "")).strip()
            if polished_summary and len(polished_summary) >= len(story_summary):
                story_summary = polished_summary
            if polished_script and len(polished_script) >= len(script_text):
                script_text = polished_script
    if not script_text:
        raise RuntimeError("script-draft 未返回有效文本")
    output_payload(
        args,
        {
            "ok": True,
            "title": title,
            "story_summary": story_summary,
            "script_text": script_text,
            "scene_count": scene_count,
            "raw_response": text,
        },
    )


def cmd_script_quality(args):
    client, text_model, _, _ = ensure_client()
    title = str(getattr(args, "title", "") or "").strip()
    src = read_text_input(args.input_file) if args.input_file else args.text
    script_text = str(src or "").strip()
    if not script_text:
        raise RuntimeError("请输入剧本文本")
    scene_count = max(1, min(12, int(getattr(args, "scene_count", 3) or 3)))
    prompt = (
        "你是短剧剧本审读专家。请对输入剧本进行结构体检，只输出JSON对象。"
        "评分维度（0-100）：conflict（冲突强度）、twist（反转有效性）、hook（前三秒钩子）、goal（角色目标清晰度）、payoff（结尾回扣）、shootability（可拍摄性）。"
        "再给出total、pass、summary、problems、suggestions。"
        "硬性规则：total<72 或 任一维度<60 则 pass=false。"
        "problems与suggestions各输出2-5条，必须可执行。"
        "JSON结构："
        "{\"conflict\":0,\"twist\":0,\"hook\":0,\"goal\":0,\"payoff\":0,\"shootability\":0,\"total\":0,\"pass\":false,\"summary\":\"\",\"problems\":[],\"suggestions\":[]}"
        f"\n标题：{title}"
        f"\n场景数：{scene_count}"
        f"\n剧本：{script_text}"
    )
    raw = chat(client, text_model, prompt, temperature=0.25, max_tokens=900)
    parsed: Any = None
    try:
        parsed = extract_json(raw)
    except Exception:
        parsed = None
    card = parsed if isinstance(parsed, dict) else {}

    def num_value(key: str, default: int) -> int:
        value = card.get(key, default)
        try:
            return int(max(0, min(100, float(value))))
        except Exception:
            return default

    conflict = num_value("conflict", 65)
    twist = num_value("twist", 62)
    hook = num_value("hook", 66)
    goal = num_value("goal", 64)
    payoff = num_value("payoff", 63)
    shootability = num_value("shootability", 68)
    total_default = int(round((conflict + twist + hook + goal + payoff + shootability) / 6))
    total = num_value("total", total_default)
    passed = bool(card.get("pass", total >= 72 and min(conflict, twist, hook, goal, payoff, shootability) >= 60))
    summary = str(card.get("summary", "")).strip() or "结构体检完成。"
    problems_raw = card.get("problems", [])
    suggestions_raw = card.get("suggestions", [])
    problems = [str(item).strip() for item in (problems_raw if isinstance(problems_raw, list) else []) if str(item).strip()]
    suggestions = [str(item).strip() for item in (suggestions_raw if isinstance(suggestions_raw, list) else []) if str(item).strip()]
    if not problems:
        problems = ["冲突层级仍可增强，建议增加主冲突与次冲突碰撞。"]
    if not suggestions:
        suggestions = ["前三秒给出人物目标与阻碍，结尾增加一句回扣台词。"]
    output_payload(
        args,
        {
            "ok": True,
            "scorecard": {
                "conflict": conflict,
                "twist": twist,
                "hook": hook,
                "goal": goal,
                "payoff": payoff,
                "shootability": shootability,
                "total": total,
                "pass": passed,
                "summary": summary,
                "problems": problems[:5],
                "suggestions": suggestions[:5],
            },
            "raw_response": raw,
        },
    )


def cmd_script_shortvideo_audit(args):
    client, text_model, _, _ = ensure_client()
    title = str(getattr(args, "title", "") or "").strip()
    src = read_text_input(args.input_file) if args.input_file else args.text
    script_text = str(src or "").strip()
    if not script_text:
        raise RuntimeError("请输入剧本文本")
    platform = str(getattr(args, "platform", "") or "").strip() or "douyin"
    duration_sec = max(5, min(180, int(getattr(args, "duration_sec", 30) or 30)))
    prompt = (
        "你是短视频运营总监与内容审核专家。请只输出JSON对象。"
        "评分维度（0-100）：hook_3s（前三秒钩子）、retention_mid（中段留存点）、cta_strength（转化行动号召）、rhythm_fit（节奏匹配）、platform_fit（平台适配）、risk_safety（版权/敏感安全）。"
        "再输出total、pass、summary、problems、suggestions。"
        "硬性规则：total<72 或 hook_3s<60 或 risk_safety<60 则 pass=false。"
        "platform_fit要求结合平台特性：douyin注重强钩子与快节奏，shipinhao注重信息密度与可信度，bilibili注重叙事完整和梗点承接。"
        "JSON结构："
        "{\"hook_3s\":0,\"retention_mid\":0,\"cta_strength\":0,\"rhythm_fit\":0,\"platform_fit\":0,\"risk_safety\":0,\"total\":0,\"pass\":false,\"summary\":\"\",\"problems\":[],\"suggestions\":[]}"
        f"\n标题：{title}"
        f"\n平台：{platform}"
        f"\n目标时长秒数：{duration_sec}"
        f"\n剧本：{script_text}"
    )
    raw = chat(client, text_model, prompt, temperature=0.25, max_tokens=950)
    parsed: Any = None
    try:
        parsed = extract_json(raw)
    except Exception:
        parsed = None
    card = parsed if isinstance(parsed, dict) else {}

    def num_value(key: str, default: int) -> int:
        value = card.get(key, default)
        try:
            return int(max(0, min(100, float(value))))
        except Exception:
            return default

    hook_3s = num_value("hook_3s", 64)
    retention_mid = num_value("retention_mid", 63)
    cta_strength = num_value("cta_strength", 60)
    rhythm_fit = num_value("rhythm_fit", 65)
    platform_fit = num_value("platform_fit", 62)
    risk_safety = num_value("risk_safety", 66)
    total_default = int(round((hook_3s + retention_mid + cta_strength + rhythm_fit + platform_fit + risk_safety) / 6))
    total = num_value("total", total_default)
    passed = bool(card.get("pass", total >= 72 and hook_3s >= 60 and risk_safety >= 60))
    summary = str(card.get("summary", "")).strip() or "短视频运营体检完成。"
    problems_raw = card.get("problems", [])
    suggestions_raw = card.get("suggestions", [])
    problems = [str(item).strip() for item in (problems_raw if isinstance(problems_raw, list) else []) if str(item).strip()]
    suggestions = [str(item).strip() for item in (suggestions_raw if isinstance(suggestions_raw, list) else []) if str(item).strip()]
    if not problems:
        problems = ["前三秒信息冲击不足，用户可能在首屏划走。"]
    if not suggestions:
        suggestions = ["前3秒增加冲突画面+反常识台词，结尾补一句可执行CTA。"]
    output_payload(
        args,
        {
            "ok": True,
            "audit": {
                "hook_3s": hook_3s,
                "retention_mid": retention_mid,
                "cta_strength": cta_strength,
                "rhythm_fit": rhythm_fit,
                "platform_fit": platform_fit,
                "risk_safety": risk_safety,
                "total": total,
                "pass": passed,
                "platform": platform,
                "summary": summary,
                "problems": problems[:5],
                "suggestions": suggestions[:5],
            },
            "raw_response": raw,
        },
    )


def cmd_script_safety_audit(args):
    client, text_model, _, _ = ensure_client()
    title = str(getattr(args, "title", "") or "").strip()
    src = read_text_input(args.input_file) if args.input_file else args.text
    script_text = str(src or "").strip()
    if not script_text:
        raise RuntimeError("请输入剧本文本")
    prompt = (
        "你是短视频版权与内容安全审核官。请只输出JSON对象。"
        "评分维度（0-100）：copyright_risk（版权风险，分数越高越安全）、sensitive_risk（敏感风险，分数越高越安全）、brand_safety（品牌安全）。"
        "并输出risk_level（low|medium|high）、pass、summary、violations、fixes。"
        "硬性规则：copyright_risk<60 或 sensitive_risk<60 或 risk_level=high 时 pass=false。"
        "JSON结构："
        "{\"copyright_risk\":0,\"sensitive_risk\":0,\"brand_safety\":0,\"risk_level\":\"low\",\"pass\":true,\"summary\":\"\",\"violations\":[],\"fixes\":[]}"
        f"\n标题：{title}"
        f"\n剧本：{script_text}"
    )
    raw = chat(client, text_model, prompt, temperature=0.2, max_tokens=900)
    parsed: Any = None
    try:
        parsed = extract_json(raw)
    except Exception:
        parsed = None
    card = parsed if isinstance(parsed, dict) else {}

    def num_value(key: str, default: int) -> int:
        value = card.get(key, default)
        try:
            return int(max(0, min(100, float(value))))
        except Exception:
            return default

    copyright_risk = num_value("copyright_risk", 68)
    sensitive_risk = num_value("sensitive_risk", 70)
    brand_safety = num_value("brand_safety", 72)
    risk_level_raw = str(card.get("risk_level", "")).strip().lower()
    if risk_level_raw not in {"low", "medium", "high"}:
        avg_safe = int(round((copyright_risk + sensitive_risk + brand_safety) / 3))
        risk_level_raw = "low" if avg_safe >= 78 else ("medium" if avg_safe >= 62 else "high")
    passed = bool(card.get("pass", copyright_risk >= 60 and sensitive_risk >= 60 and risk_level_raw != "high"))
    summary = str(card.get("summary", "")).strip() or "安全审查完成。"
    violations_raw = card.get("violations", [])
    fixes_raw = card.get("fixes", [])
    violations = [str(item).strip() for item in (violations_raw if isinstance(violations_raw, list) else []) if str(item).strip()]
    fixes = [str(item).strip() for item in (fixes_raw if isinstance(fixes_raw, list) else []) if str(item).strip()]
    if not violations:
        violations = ["未识别到明显高风险项，建议人工复核品牌名与素材引用来源。"]
    if not fixes:
        fixes = ["涉及真实品牌与IP时，改为泛化称呼并补充原创免责声明。"]
    output_payload(
        args,
        {
            "ok": True,
            "safety": {
                "copyright_risk": copyright_risk,
                "sensitive_risk": sensitive_risk,
                "brand_safety": brand_safety,
                "risk_level": risk_level_raw,
                "pass": passed,
                "summary": summary,
                "violations": violations[:5],
                "fixes": fixes[:5],
            },
            "raw_response": raw,
        },
    )


def cmd_storyboard(args):
    client, text_model, _, _ = ensure_client()
    script = read_text_input(args.script_file)
    prompt = (
        "你是SCU-OS导演车间分镜导演。输出七维分镜JSON数组。"
        "结构[{\"shot_id\":\"S01\",\"time\":\"0-4s\",\"visual\":\"...\",\"audio\":\"...\",\"camera\":\"...\",\"acting\":\"...\",\"action\":\"...\",\"vibe\":\"...\",\"sting\":\"...\"}]。"
        "要求适合短视频拍摄，清晰连续。"
        f"\n剧本：{script}"
    )
    text = chat(client, text_model, prompt, temperature=0.35)
    data = extract_json(text)
    output_payload(args, {"ok": True, "data": data})


def cmd_forge(args):
    client, text_model, _, _ = ensure_client()
    board_text = read_text_input(args.storyboard_file)
    prompt = (
        "你是SCU-OS铸造车间提示词工程师。"
        "将分镜转成视频生成提示词清单。"
        "输出JSON数组，结构[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，写实电影感，9:16\"}]。"
        f"\n分镜：{board_text}"
    )
    text = chat(client, text_model, prompt, temperature=0.3)
    data = extract_json(text)
    payload = {"ok": True, "data": data}
    if args.out_file:
        Path(args.out_file).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["saved_to"] = args.out_file
    output_payload(args, payload)


def cmd_render(args):
    client, _, _, video_model = ensure_client()
    if not video_model:
        raise RuntimeError("缺少 VOLC_VIDEO_MODEL")
    prompt = read_text_input(args.prompt_file) if args.prompt_file else args.prompt
    if not prompt.strip():
        raise RuntimeError("prompt 为空")
    duration = clamp_video_duration_for_model(video_model, int(args.duration or 1))
    result = client.content_generation.tasks.create(
        model=video_model,
        content=[{"type": "text", "text": prompt}],
        duration=duration,
        ratio=args.ratio,
    )
    payload = to_dict(result)
    task_id = payload.get("id") or getattr(result, "id", "")
    output_payload(args, {"ok": True, "task_id": task_id, "payload": payload})


def cmd_render_status(args):
    backend = resolve_video_backend()
    if str(backend.get("provider", "ark")) == "fal":
        model_id = str(getattr(args, "fal_model", "") or backend.get("video_model", "")).strip()
        if not model_id:
            raise RuntimeError("缺少 FAL 视频模型ID")
        poll = fal_poll_video_result(
            api_key=str(backend.get("api_key", "")),
            base_url=str(backend.get("base_url", "https://queue.fal.run")),
            video_model=model_id,
            request_id=str(args.task_id),
            interval=1,
            timeout=1,
        )
        output_payload(args, {"ok": True, "task_id": args.task_id, "provider": "fal", "payload": poll.get("payload", {}), "status": poll.get("status", ""), "video_url": poll.get("video_url", "")})
        return
    result = backend.get("client").content_generation.tasks.get(task_id=args.task_id)
    payload = to_dict(result)
    out = {"ok": True, "task_id": args.task_id, "provider": "ark", "payload": payload}
    text = json.dumps(payload, ensure_ascii=False)
    url_match = re.findall(r"https?://[^\"'\\s]+\\.(?:mp4|mov|webm|m3u8)", text)
    if url_match:
        out["video_url"] = url_match[0]
    output_payload(args, out)


def cmd_archive(args):
    root = Path(args.out_dir) / args.project
    tree = [
        root / "00_Script_Bible.md",
        root / "01_Assets" / "Characters",
        root / "01_Assets" / "Environments",
        root / "01_Assets" / "Props",
        root / "02_Pre-Production" / "Storyboard.md",
        root / "03_Production",
        root / "04_Post-Production",
    ]
    for p in tree:
        if p.suffix:
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.write_text("", encoding="utf-8")
        else:
            p.mkdir(parents=True, exist_ok=True)
    output_payload(args, {"ok": True, "root": str(root)})


def cmd_shell(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = load_state(state_path)
    active_video_model = get_active_video_model_name()
    shot_guidance = build_shot_generation_guidance(is_seedance_model(active_video_model), has_reference_assets(state))
    title = input("片名：").strip() or "未命名短片"
    story = read_text_input("")
    state["title"] = title
    state["story"] = story
    save_state(state_path, state)
    route = smart_route(story)
    print(f"推荐入口：{route}")
    split_prompt = (
        "把剧本拆成4-6个节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。"
        f"\n剧本：{story}"
    )
    beats = extract_json(chat(client, text_model, split_prompt, temperature=0.5))
    state["beats"] = beats
    save_state(state_path, state)
    print("节拍：")
    print(json.dumps(beats, ensure_ascii=False, indent=2))
    board_prompt = (
        "把节拍转成分镜，输出JSON数组，结构[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词\"}]。"
        + shot_guidance
        + f"\n节拍：{json.dumps(beats, ensure_ascii=False)}"
    )
    shots = extract_json(chat(client, text_model, board_prompt, temperature=0.35))
    state["shots"] = shots
    save_state(state_path, state)
    print("分镜初稿：")
    print(json.dumps(shots, ensure_ascii=False, indent=2))
    print(f"会话状态已保存：{state_path}")


def cmd_revise(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = load_state(state_path)
    target = args.target.strip().lower()
    instruction = read_text_input(args.input_file) if args.input_file else args.instruction
    if not instruction.strip():
        raise RuntimeError("修订指令为空")
    if target == "beats":
        beats = state.get("beats")
        if not beats:
            raise RuntimeError("状态中没有 beats，请先执行 shell 或 brainhole")
        prompt = (
            "你是SCU-OS文学车间编辑。请根据修订意见改写节拍，输出JSON数组"
            "[{\"id\":1,\"beat\":\"...\"}]。要求保留剧情主线，增强可拍摄性。"
            f"\n当前节拍：{json.dumps(beats, ensure_ascii=False)}"
            f"\n修订意见：{instruction}"
        )
        new_beats = extract_json(chat(client, text_model, prompt, temperature=0.45))
        state["beats"] = new_beats
        save_state(state_path, state)
        output_payload(args, {"ok": True, "target": "beats", "state_file": str(state_path), "data": new_beats})
        return
    if target == "shots":
        shots = state.get("shots")
        if not shots:
            raise RuntimeError("状态中没有 shots，请先执行 shell 或 storyboard/forge")
        shot_guidance = build_shot_generation_guidance(is_seedance_model(get_active_video_model_name()), has_reference_assets(state))
        prompt = (
            "你是SCU-OS导演车间分镜总监。请根据修订意见改写分镜，输出JSON数组，结构"
            "[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词\"}]。"
            "要求时长总和接近20秒并且镜头连续。"
            + shot_guidance
            + f"\n当前分镜：{json.dumps(shots, ensure_ascii=False)}"
            + f"\n修订意见：{instruction}"
        )
        new_shots = extract_json(chat(client, text_model, prompt, temperature=0.35))
        state["shots"] = new_shots
        save_state(state_path, state)
        output_payload(args, {"ok": True, "target": "shots", "state_file": str(state_path), "data": new_shots})
        return
    raise RuntimeError("target 仅支持 beats 或 shots")


def cmd_pipeline(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = load_state(state_path)
    story = read_text_input(args.story_file) if args.story_file else args.story
    if not story.strip():
        raise RuntimeError("故事文本为空")
    title = args.title.strip() if args.title else "未命名短片"
    shot_guidance = build_shot_generation_guidance(is_seedance_model(get_active_video_model_name()), has_reference_assets(state))
    beat_prompt = (
        "把剧本拆成4-6个节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。"
        f"\n剧本：{story}"
    )
    beats = extract_json(chat(client, text_model, beat_prompt, temperature=0.5))
    shot_prompt = (
        "把节拍转成分镜，输出JSON数组，结构"
        "[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，9:16写实电影感\"}]。"
        + shot_guidance
        + f"\n节拍：{json.dumps(beats, ensure_ascii=False)}"
        + f"\n目标总时长：{args.seconds}秒"
    )
    shots = extract_json(chat(client, text_model, shot_prompt, temperature=0.35))
    state["title"] = title
    state["story"] = story
    state["beats"] = beats
    state["shots"] = shots
    save_state(state_path, state)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = now_tag()
    json_path = out_dir / f"{title}_{tag}.json"
    json_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    prompts_path = out_dir / f"{title}_{tag}_prompts.txt"
    prompt_lines = []
    for s in shots:
        if not isinstance(s, dict):
            continue
        prompt_lines.append(f"{s.get('shot_id', '')} | {s.get('duration_sec', '')}s")
        prompt_lines.append(str(s.get("visual_prompt", "")))
        prompt_lines.append("")
    prompts_path.write_text("\n".join(prompt_lines), encoding="utf-8")
    output_payload(
        args,
        {
            "ok": True,
            "state_file": str(state_path),
            "json_file": str(json_path),
            "prompts_file": str(prompts_path),
            "title": title,
            "shots_count": len(shots) if isinstance(shots, list) else 0,
        },
    )


def cmd_plan(args):
    client, text_model, _, _ = ensure_client()
    story = read_text_input(args.story_file) if args.story_file else args.story
    if not story.strip():
        raise RuntimeError("故事文本为空")
    title = args.title.strip() if args.title else "未命名短片"
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    shot_guidance = build_shot_generation_guidance(is_seedance_model(get_active_video_model_name()), has_reference_assets(state))
    beat_prompt = (
        "把剧本拆成4-6个节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。"
        f"\n剧本：{story}"
    )
    beats = extract_json(chat(client, text_model, beat_prompt, temperature=0.5))
    shot_prompt = (
        "把节拍转成分镜，输出JSON数组，结构"
        "[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，9:16写实电影感\"}]。"
        + shot_guidance
        + f"\n节拍：{json.dumps(beats, ensure_ascii=False)}"
        + f"\n目标总时长：{args.seconds}秒"
    )
    shots = extract_json(chat(client, text_model, shot_prompt, temperature=0.35))
    state["title"] = title
    state["story"] = story
    state["beats"] = beats
    state["shots"] = shots
    set_workflow(state, "shots_ready", "shot-revise / render-shot / render-shots")
    if str(state.get("project_root", "")).strip():
        root = get_project_root(state)
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "shots").mkdir(parents=True, exist_ok=True)
        (root / "scripts" / "story.txt").write_text(story, encoding="utf-8")
        (root / "shots" / "beats.json").write_text(json.dumps(beats, ensure_ascii=False, indent=2), encoding="utf-8")
        (root / "shots" / "shots.json").write_text(json.dumps(shots, ensure_ascii=False, indent=2), encoding="utf-8")
    save_state(state_path, state)
    append_event("plan_completed", {"state_file": str(state_path), "shots": len(shots) if isinstance(shots, list) else 0})
    output_payload(
        args,
        {"ok": True, "state_file": str(state_path), "title": title, "beats": beats, "shots": shots},
    )


def cmd_render_shots(args):
    retry_opts = resolve_retry_options(args)
    backend = resolve_video_backend()
    provider = str(backend.get("provider", "ark"))
    video_model = str(backend.get("video_model", "")).strip()
    if not video_model:
        raise RuntimeError("缺少视频模型配置")
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    shots = state.get("shots")
    if not isinstance(shots, list) or not shots:
        raise RuntimeError("状态中没有 shots，请先执行 plan/pipeline/shell")
    created = []
    for idx, shot in enumerate(shots, start=1):
        if not isinstance(shot, dict):
            continue
        prompt = build_render_prompt(state, shot, str(shot.get("visual_prompt", "")).strip(), video_model)
        if not prompt:
            continue
        duration = clamp_video_duration_for_model(video_model, int(float(shot.get("duration_sec", 5) or 5)))
        submission_meta: Dict[str, Any] = {}
        if provider == "fal":
            payload = fal_submit_video_task(
                api_key=str(backend.get("api_key", "")),
                base_url=str(backend.get("base_url", "https://queue.fal.run")),
                video_model=video_model,
                state=state,
                prompt=prompt,
                duration=duration,
                ratio=args.ratio,
                submission_meta=submission_meta,
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
            task_id = str(payload.get("request_id", "")).strip()
        else:
            result = submit_video_task(
                client=backend.get("client"),
                video_model=video_model,
                state=state,
                prompt=prompt,
                duration=duration,
                ratio=args.ratio,
                strict_multimodal=bool(getattr(args, "strict_multimodal", False)),
                submission_meta=submission_meta,
            )
            payload = to_dict(result)
            task_id = payload.get("id") or getattr(result, "id", "")
        created.append(
            {
                "index": idx,
                "shot_id": shot.get("shot_id", f"S{idx:02d}"),
                "task_id": task_id,
                "provider": provider,
                "video_model": video_model,
                "duration_sec": duration,
                "request_mode": str(submission_meta.get("request_mode", "multimodal")),
                "image_ref_count": int(submission_meta.get("image_ref_count", 0) or 0),
                "has_face_ref": bool(submission_meta.get("has_face_ref", False)),
                "has_scene_ref": bool(submission_meta.get("has_scene_ref", False)),
                "constraints_applied": bool(submission_meta.get("constraints_applied", False)),
                "status_url": str(submission_meta.get("status_url", "")),
                "response_url": str(submission_meta.get("response_url", "")),
            }
        )
    state["render_tasks"] = created
    set_workflow(state, "rendering", "render-shots --poll 或 session-state")
    save_state(state_path, state)
    if not args.poll:
        output_payload(args, {"ok": True, "state_file": str(state_path), "retry": retry_opts, "tasks": created})
        return
    finished = []
    deadline = time.time() + args.timeout
    for item in created:
        task_id = item.get("task_id", "")
        video_url = ""
        status_value = ""
        if provider == "fal":
            poll_result = fal_poll_video_result(
                api_key=str(backend.get("api_key", "")),
                base_url=str(backend.get("base_url", "https://queue.fal.run")),
                video_model=video_model,
                request_id=str(task_id),
                interval=args.interval,
                timeout=max(1, int(deadline - time.time())),
                status_url=str(item.get("status_url", "")),
                response_url=str(item.get("response_url", "")),
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
            status_value = str(poll_result.get("status", ""))
            video_url = str(poll_result.get("video_url", ""))
        else:
            while time.time() < deadline:
                result = backend.get("client").content_generation.tasks.get(task_id=task_id)
                payload = to_dict(result)
                status_value = str(payload.get("status", ""))
                video_url = extract_video_url_from_payload(payload) or video_url
                if video_url:
                    break
                if status_value.lower() in {"failed", "error"}:
                    break
                time.sleep(args.interval)
        finished.append({**item, "status": status_value, "video_url": video_url})
    state["render_results"] = finished
    set_workflow(state, "rendered", "review shots -> approve -> merge-approved")
    save_state(state_path, state)
    append_event("render_shots_completed", {"state_file": str(state_path), "results": len(finished)})
    output_payload(args, {"ok": True, "state_file": str(state_path), "retry": retry_opts, "results": finished})


def find_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path:
        return path
    pkg_root = Path(os.getenv("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if pkg_root.exists():
        matches = list(pkg_root.rglob("ffmpeg.exe"))
        if matches:
            return str(matches[0])
    return ""


def resolve_volc_tts_settings(args) -> Dict[str, Any]:
    cfg_path = Path(args.config_file) if getattr(args, "config_file", None) else default_config_path()
    cfg = load_config(cfg_path)
    settings = {
        "app_id": str(getattr(args, "tts_app_id", "") or "").strip() or get_setting("VOLC_TTS_APP_ID", cfg, "").strip(),
        "access_token": str(getattr(args, "tts_access_token", "") or "").strip() or get_setting("VOLC_TTS_ACCESS_TOKEN", cfg, "").strip(),
        "voice_type": str(getattr(args, "tts_voice_type", "") or "").strip() or get_setting("VOLC_TTS_VOICE_TYPE", cfg, "").strip(),
        "resource_id": str(getattr(args, "tts_resource_id", "") or "").strip() or get_setting("VOLC_TTS_RESOURCE_ID", cfg, "").strip() or get_setting("VOLC_AUDIO_MODEL", cfg, "").strip(),
        "base_url": str(getattr(args, "tts_base_url", "") or "").strip() or get_setting("VOLC_TTS_BASE_URL", cfg, "https://openspeech.bytedance.com/api/v3/tts/unidirectional").strip(),
    }
    missing = [
        label
        for label, value in (
            ("VOLC_TTS_APP_ID", settings["app_id"]),
            ("VOLC_TTS_ACCESS_TOKEN", settings["access_token"]),
            ("VOLC_TTS_VOICE_TYPE", settings["voice_type"]),
            ("VOLC_AUDIO_MODEL/VOLC_TTS_RESOURCE_ID", settings["resource_id"]),
        )
        if not value
    ]
    if missing:
        raise RuntimeError("缺少火山语音配置：" + "、".join(missing))
    return settings


def build_voiceover_script_from_state(state: Dict[str, Any], approved_only: bool = False) -> str:
    approved = set(state.get("approved_shots", []))
    lines: List[str] = []
    for shot in state.get("shots", []):
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id", "")).strip()
        if approved_only and shot_id not in approved:
            continue
        subtitle = str(shot.get("subtitle", "")).strip()
        if subtitle:
            lines.append(subtitle)
    return "。".join(lines).strip("。 \n\t")


def extract_audio_bytes_from_response(response: requests.Response) -> bytes:
    content_type = str(response.headers.get("Content-Type", "")).lower()
    if content_type.startswith("audio/"):
        return response.content
    raw = response.content
    if raw[:4] == b"RIFF" or raw[:3] == b"ID3":
        return raw
    text = response.text.strip()
    if not text:
        raise RuntimeError("火山语音返回为空")
    chunks: List[Dict[str, Any]] = []
    try:
        parsed = response.json()
        if isinstance(parsed, dict):
            chunks = [parsed]
        elif isinstance(parsed, list):
            chunks = [item for item in parsed if isinstance(item, dict)]
    except Exception:
        decoder = json.JSONDecoder()
        index = 0
        while index < len(text):
            while index < len(text) and text[index].isspace():
                index += 1
            if index >= len(text):
                break
            item, next_index = decoder.raw_decode(text, index)
            if isinstance(item, dict):
                chunks.append(item)
            index = next_index
    if not chunks:
        raise RuntimeError(f"无法解析火山语音响应：{text[:300]}")
    audio_parts: List[bytes] = []
    for item in chunks:
        code = item.get("code")
        if code not in (0, 20000000, None):
            message = str(item.get("message") or item.get("msg") or item)
            raise RuntimeError(f"火山语音生成失败：{message}")
        for key in ("data", "audio", "audio_data"):
            data = item.get(key)
            if isinstance(data, str) and data:
                try:
                    audio_parts.append(base64.b64decode(data))
                    break
                except Exception:
                    continue
    if not audio_parts:
        raise RuntimeError("火山语音响应中未找到音频数据")
    return b"".join(audio_parts)


def synthesize_volc_tts(
    text: str,
    output_file: Path,
    settings: Dict[str, Any],
    speed_ratio: float = 1.0,
    volume_ratio: float = 1.0,
    pitch_ratio: float = 1.0,
) -> Path:
    payload = {
        "user": {"uid": f"openvshot-{uuid.uuid4().hex[:12]}"},
        "req_params": {
            "text": text,
            "speaker": str(settings.get("voice_type", "")).strip(),
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
                "speed_ratio": float(speed_ratio),
                "volume_ratio": float(volume_ratio),
                "pitch_ratio": float(pitch_ratio),
            },
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Api-App-ID": str(settings.get("app_id", "")).strip(),
        "X-Api-Access-Key": str(settings.get("access_token", "")).strip(),
        "X-Api-Resource-Id": str(settings.get("resource_id", "")).strip(),
    }
    response = requests.post(str(settings.get("base_url", "")).strip(), headers=headers, json=payload, timeout=300)
    if response.status_code >= 400:
        raise RuntimeError(f"火山语音请求失败: HTTP {response.status_code} {response.text[:300]}")
    audio_bytes = extract_audio_bytes_from_response(response)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_bytes(audio_bytes)
    return output_file


def cmd_run(args):
    config_path = Path(args.config_file) if args.config_file else default_config_path()
    ensure_setup(config_path, interactive=not args.no_prompt)
    client = None
    text_model = ""
    try:
        client, text_model, _, _ = ensure_client()
    except Exception:
        client = None
        text_model = ""
    backend = resolve_video_backend(config_path)
    retry_opts = resolve_retry_options(args)
    provider = str(backend.get("provider", "ark"))
    video_model = str(backend.get("video_model", "")).strip()
    if not video_model:
        raise RuntimeError("缺少视频模型配置")
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    story = read_text_input(args.story_file) if args.story_file else args.story
    if not story.strip():
        raise RuntimeError("故事文本为空")
    title = args.title.strip() if args.title else "短片"
    beats: Any = []
    shots: Any = []
    if client is not None and text_model:
        try:
            beat_prompt = (
                "把剧本拆成4-6个节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。"
                f"\n剧本：{story}"
            )
            beats = extract_json(chat(client, text_model, beat_prompt, temperature=0.5))
            shot_prompt = (
                "把节拍转成分镜，输出JSON数组，结构"
                "[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，9:16写实电影感\"}]。"
                f"\n节拍：{json.dumps(beats, ensure_ascii=False)}"
                f"\n目标总时长：{args.seconds}秒"
            )
            shots = extract_json(chat(client, text_model, shot_prompt, temperature=0.35))
        except Exception:
            beats = []
            shots = []
    if not isinstance(beats, list) or not beats:
        sentences = [s.strip() for s in re.split(r"[。！？!?\\n]+", story) if s.strip()]
        if not sentences:
            sentences = [story.strip()]
        sentences = sentences[:4]
        beats = [{"id": i + 1, "beat": s} for i, s in enumerate(sentences)]
    if not isinstance(shots, list) or not shots:
        shot_count = max(1, min(4, len(beats)))
        total_seconds = max(6, int(args.seconds or 20))
        per_sec = max(3, int(total_seconds / shot_count))
        generated = []
        for i in range(shot_count):
            beat_text = str(beats[i].get("beat", "")) if isinstance(beats[i], dict) else str(beats[i])
            generated.append(
                {
                    "shot_id": f"S{i+1:02d}",
                    "duration_sec": per_sec,
                    "subtitle": beat_text[:26],
                    "visual_prompt": f"realistic historical drama, cinematic, {beat_text}",
                }
            )
        shots = generated
    state = normalize_state(load_state(state_path))
    state["title"] = title
    state["story"] = story
    state["beats"] = beats
    state["shots"] = shots
    set_workflow(state, "rendering", "wait render completion")
    if str(state.get("project_root", "")).strip():
        root = get_project_root(state)
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "shots").mkdir(parents=True, exist_ok=True)
        (root / "scripts" / "story.txt").write_text(story, encoding="utf-8")
        (root / "shots" / "beats.json").write_text(json.dumps(beats, ensure_ascii=False, indent=2), encoding="utf-8")
        (root / "shots" / "shots.json").write_text(json.dumps(shots, ensure_ascii=False, indent=2), encoding="utf-8")
    save_state(state_path, state)
    created = []
    for idx, shot in enumerate(shots, start=1):
        if not isinstance(shot, dict):
            continue
        prompt = build_detailed_shot_prompt(state, shot, str(shot.get("visual_prompt", "")).strip())
        if not prompt:
            continue
        duration = int(float(shot.get("duration_sec", 5) or 5))
        submission_meta: Dict[str, Any] = {}
        if provider == "fal":
            payload = fal_submit_video_task(
                api_key=str(backend.get("api_key", "")),
                base_url=str(backend.get("base_url", "https://queue.fal.run")),
                video_model=video_model,
                state=state,
                prompt=prompt,
                duration=duration,
                ratio=args.ratio,
                submission_meta=submission_meta,
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
            task_id = str(payload.get("request_id", "")).strip()
        else:
            result = submit_video_task(
                client=backend.get("client"),
                video_model=video_model,
                state=state,
                prompt=prompt,
                duration=duration,
                ratio=args.ratio,
                strict_multimodal=bool(getattr(args, "strict_multimodal", False)),
                submission_meta=submission_meta,
            )
            payload = to_dict(result)
            task_id = payload.get("id") or getattr(result, "id", "")
        created.append(
            {
                "index": idx,
                "shot_id": shot.get("shot_id", f"S{idx:02d}"),
                "task_id": task_id,
                "provider": provider,
                "video_model": video_model,
                "duration_sec": duration,
                "request_mode": str(submission_meta.get("request_mode", "multimodal")),
                "image_ref_count": int(submission_meta.get("image_ref_count", 0) or 0),
                "has_face_ref": bool(submission_meta.get("has_face_ref", False)),
                "has_scene_ref": bool(submission_meta.get("has_scene_ref", False)),
                "constraints_applied": bool(submission_meta.get("constraints_applied", False)),
                "status_url": str(submission_meta.get("status_url", "")),
                "response_url": str(submission_meta.get("response_url", "")),
            }
        )
    state["render_tasks"] = created
    save_state(state_path, state)
    finished = []
    deadline = time.time() + args.timeout
    for item in created:
        task_id = item.get("task_id", "")
        video_url = ""
        status_value = ""
        if provider == "fal":
            poll_result = fal_poll_video_result(
                api_key=str(backend.get("api_key", "")),
                base_url=str(backend.get("base_url", "https://queue.fal.run")),
                video_model=video_model,
                request_id=str(task_id),
                interval=args.interval,
                timeout=max(1, int(deadline - time.time())),
                status_url=str(item.get("status_url", "")),
                response_url=str(item.get("response_url", "")),
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
            status_value = str(poll_result.get("status", ""))
            video_url = str(poll_result.get("video_url", ""))
        else:
            while time.time() < deadline:
                result = backend.get("client").content_generation.tasks.get(task_id=task_id)
                payload = to_dict(result)
                status_value = str(payload.get("status", ""))
                video_url = extract_video_url_from_payload(payload) or video_url
                if video_url:
                    break
                if status_value.lower() in {"failed", "error"}:
                    break
                time.sleep(args.interval)
        finished.append({**item, "status": status_value, "video_url": video_url})
    state["render_results"] = finished
    set_workflow(state, "rendered", "review outputs / merge-approved")
    save_state(state_path, state)
    download_dir = Path(args.download_dir)
    download_dir.mkdir(parents=True, exist_ok=True)
    downloaded_files = []
    for item in finished:
        url = item.get("video_url", "")
        if not url:
            continue
        shot_id = str(item.get("shot_id", "shot")).replace("/", "_")
        out_path = download_dir / f"{shot_id}.mp4"
        response = requests.get(url, timeout=180)
        response.raise_for_status()
        out_path.write_bytes(response.content)
        downloaded_files.append(str(out_path))
    merged_file = ""
    if args.merge and len(downloaded_files) >= 2:
        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            raise RuntimeError("未找到 ffmpeg，可先安装后重试")
        output_path = download_dir / args.merged_name
        cmd = [ffmpeg_path, "-y"]
        for file_path in downloaded_files:
            cmd.extend(["-i", file_path])
        filter_in = "".join([f"[{i}:v]" for i in range(len(downloaded_files))])
        filter_expr = f"{filter_in}concat=n={len(downloaded_files)}:v=1:a=0[v]"
        cmd.extend(["-filter_complex", filter_expr, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(output_path)])
        subprocess.run(cmd, check=True)
        merged_file = str(output_path)
    payload = {
        "ok": True,
        "state_file": str(state_path),
        "retry": retry_opts,
        "shots_count": len(shots) if isinstance(shots, list) else 0,
        "tasks": created,
        "results": finished,
        "downloaded_files": downloaded_files,
        "merged_file": merged_file,
    }
    output_payload(args, payload)


def cmd_script_generate(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    source = args.source
    if source == "story":
        text = str(state.get("story", "")).strip()
    else:
        text = json.dumps(state.get("beats", []), ensure_ascii=False)
    if not text:
        raise RuntimeError("缺少可用输入，请先提供 story 或 beats")
    prompt = (
        "你是SCU-OS剧本改编师。把输入内容改写为分场剧本JSON数组。"
        "结构[{\"scene_id\":\"SC01\",\"location\":\"...\",\"time\":\"...\",\"environment\":\"...\",\"action\":\"...\",\"dialogue\":[{\"role\":\"A\",\"line\":\"...\"}]}]。"
        "强调可拍摄动作，不写心理独白。"
        f"\n输入：{text}"
    )
    scenes = extract_json(chat(client, text_model, prompt, temperature=0.4))
    state["script_scenes"] = scenes
    set_workflow(state, "script_ready", "script-revise / plan")
    if str(state.get("project_root", "")).strip():
        root = get_project_root(state)
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "scripts" / "script_scenes.json").write_text(json.dumps(scenes, ensure_ascii=False, indent=2), encoding="utf-8")
    save_state(state_path, state)
    append_event("script_generated", {"state_file": str(state_path), "scenes": len(scenes) if isinstance(scenes, list) else 0})
    output_payload(args, {"ok": True, "state_file": str(state_path), "script_scenes": scenes})


def cmd_script_revise(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    scenes = state.get("script_scenes")
    if not scenes:
        raise RuntimeError("没有 script_scenes，请先执行 script-generate")
    instruction = read_text_input(args.input_file) if args.input_file else args.instruction
    if not instruction.strip():
        raise RuntimeError("修订意见为空")
    prompt = (
        "根据修订意见改写分场剧本，输出同结构JSON数组。"
        f"\n当前分场剧本：{json.dumps(scenes, ensure_ascii=False)}"
        f"\n修订意见：{instruction}"
    )
    new_scenes = extract_json(chat(client, text_model, prompt, temperature=0.35))
    state["script_scenes"] = new_scenes
    set_workflow(state, "script_revised", "继续 script-revise 或 plan")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "script_scenes": new_scenes})


def normalize_stage2_plan(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}
    characters_raw = payload.get("characters", [])
    scenes_raw = payload.get("scenes", [])
    storyboard_raw = payload.get("storyboard_text", [])
    characters = []
    scenes = []
    storyboard_text = []
    virtual_name_keys = {
        "旁白",
        "解说",
        "画外音",
        "画外旁白",
        "字幕",
        "narrator",
        "voiceover",
        "voice-over",
        "commentator",
        "os",
        "vo",
    }
    for idx, item in enumerate(characters_raw, start=1):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip() or f"角色{idx}"
        name_norm = re.sub(r"[\s_\-·•]+", "", name).lower()
        if any(key in name_norm for key in virtual_name_keys):
            continue
        desc = str(item.get("description", "")).strip()
        prompt = str(item.get("prompt", "")).strip()
        if len(desc) < 60:
            desc = (
                f"{desc} "
                f"外观细节：发型与发色、脸型与五官、体型比例、肤色或种族特征。"
                f"服装细节：上装/下装/外套/鞋履材质、主辅配色、磨损或装饰细节。"
                f"配件细节：帽子/耳饰/项链/手套/武器或道具，注明位置与材质。"
            ).strip()
        if len(prompt) < 90:
            prompt = (
                f"{prompt} "
                f"角色名：{name}，写实电影级角色设定，保持身份锚点一致。"
                "必须体现服装层次与材质细节（皮革/布料/金属）、缝线与褶皱。"
                "生成多角度信息可复用：正面、左侧、右侧、背面与脸部特写的一致性描述。"
                "禁止更换服装主色与关键配件，禁止卡通化。"
            ).strip()
        if desc or prompt:
            characters.append({"name": name, "description": desc, "prompt": prompt})
    for idx, item in enumerate(scenes_raw, start=1):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip() or f"场景{idx}"
        desc = str(item.get("description", "")).strip()
        prompt = str(item.get("prompt", "")).strip()
        if desc or prompt:
            scenes.append({"name": name, "description": desc, "prompt": prompt})
    for idx, item in enumerate(storyboard_raw, start=1):
        if not isinstance(item, dict):
            continue
        shot_id = str(item.get("shot_id", "")).strip() or f"S{idx:02d}"
        subtitle = str(item.get("subtitle", "")).strip()
        visual_hint = str(item.get("visual_hint", "")).strip()
        duration_sec = float(item.get("duration_sec", 5) or 5)
        if subtitle or visual_hint:
            storyboard_text.append(
                {
                    "shot_id": shot_id,
                    "duration_sec": max(1.0, round(duration_sec, 2)),
                    "subtitle": subtitle,
                    "visual_hint": visual_hint,
                }
            )
    return {"characters": characters, "scenes": scenes, "storyboard_text": storyboard_text}


def cmd_stage2_prepare(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, text_model, _, _ = ensure_client()
    instruction = read_text_input(args.input_file) if args.input_file else args.instruction
    story = str(state.get("story", "")).strip()
    beats = state.get("beats", [])
    scenes = state.get("script_scenes", [])
    if not story and not beats and not scenes:
        raise RuntimeError("缺少剧本基础内容，请先完成剧本阶段")
    if args.title and str(args.title).strip():
        state["title"] = str(args.title).strip()
    source = {
        "title": str(state.get("title", "")).strip(),
        "story": story,
        "beats": beats,
        "script_scenes": scenes,
    }
    prompt = (
        "你是短视频制作总监。请基于输入的剧本信息，输出第二阶段所需结构化内容。"
        "输出必须是JSON对象，结构为："
        "{\"characters\":[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}],"
        "\"scenes\":[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}],"
        "\"storyboard_text\":[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"\",\"visual_hint\":\"\"}]}"
        "要求：角色与场景信息具体，可直接用于生成素材；storyboard_text用于后续生成正式分镜。"
        f"\n剧本输入：{json.dumps(source, ensure_ascii=False)}"
        f"\n补充要求：{instruction or '保持写实电影感，风格统一，适配9:16短视频。'}"
    )
    raw = extract_json(chat(client, text_model, prompt, temperature=0.35))
    plan = normalize_stage2_plan(raw)
    state["stage2_plan"] = plan
    set_workflow(state, "stage2_prepared", "可调整第二阶段描述后执行 stage2-generate-assets")
    save_state(state_path, state)
    append_event(
        "stage2_prepared",
        {
            "state_file": str(state_path),
            "characters": len(plan.get("characters", [])),
            "scenes": len(plan.get("scenes", [])),
            "storyboard_text": len(plan.get("storyboard_text", [])),
        },
    )
    output_payload(args, {"ok": True, "state_file": str(state_path), "project": str(state.get("title", "")), "stage2_plan": plan})


def cmd_stage2_set_plan(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    plan_json = str(args.plan_json or "").strip()
    if not plan_json:
        raise RuntimeError("缺少 plan_json")
    try:
        payload = json.loads(plan_json)
    except Exception as exc:
        raise RuntimeError(f"plan_json 不是有效JSON: {exc}")
    plan = normalize_stage2_plan(payload)
    state["stage2_plan"] = plan
    set_workflow(state, "stage2_prepared", "可执行 stage2-generate-assets")
    save_state(state_path, state)
    append_event(
        "stage2_plan_set",
        {
            "state_file": str(state_path),
            "characters": len(plan.get("characters", [])),
            "scenes": len(plan.get("scenes", [])),
            "storyboard_text": len(plan.get("storyboard_text", [])),
        },
    )
    output_payload(args, {"ok": True, "state_file": str(state_path), "project": str(state.get("title", "")), "stage2_plan": plan})


def cmd_stage2_set_shots(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    shots_json = str(getattr(args, "shots_json", "") or "").strip()
    if not shots_json:
        raise RuntimeError("缺少 shots_json")
    try:
        payload = json.loads(shots_json)
    except Exception as exc:
        raise RuntimeError(f"shots_json 不是有效JSON: {exc}")
    if not isinstance(payload, list):
        raise RuntimeError("shots_json 必须是数组")
    normalized_shots = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            continue
        shot_id = str(item.get("shot_id", "")).strip() or f"S{str(index).zfill(2)}"
        duration_raw = item.get("duration_sec", 5)
        try:
            duration_sec = round(max(1.0, float(duration_raw or 5)), 2)
        except Exception:
            duration_sec = 5.0
        subtitle = str(item.get("subtitle", "")).strip()
        visual_prompt = str(item.get("visual_prompt", "")).strip()
        normalized_shots.append(
            {
                "shot_id": shot_id,
                "duration_sec": int(duration_sec) if float(duration_sec).is_integer() else duration_sec,
                "subtitle": subtitle,
                "visual_prompt": visual_prompt,
            }
        )
    if not normalized_shots:
        raise RuntimeError("未提供有效镜头")
    state["shots"] = normalized_shots
    set_workflow(state, "shots_ready", "可继续修订镜头并渲染")
    save_state(state_path, state)
    append_event("stage2_shots_set", {"state_file": str(state_path), "shots": len(normalized_shots)})
    output_payload(args, {"ok": True, "state_file": str(state_path), "state": state, "shots": normalized_shots})


def cmd_stage2_generate_assets(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, text_model, image_model, _ = ensure_client()
    if not image_model:
        raise RuntimeError("缺少 VOLC_IMAGE_MODEL")
    root = get_project_root(state)
    plan = state.get("stage2_plan", {})
    plan = normalize_stage2_plan(plan)
    if not plan.get("characters") and not plan.get("scenes"):
        raise RuntimeError("缺少第二阶段内容，请先执行 stage2-prepare")
    generated_characters = []
    generated_scenes = []
    size = str(args.size or "1024x1024").strip() or "1024x1024"
    scene_with_character_anchors = not bool(getattr(args, "scene_ignore_character_anchors", False))
    for idx, item in enumerate(plan.get("characters", []), start=1):
        name = str(item.get("name", "")).strip() or f"角色{idx}"
        description = str(item.get("description", "")).strip()
        prompt = str(item.get("prompt", "")).strip() or f"写实电影角色定妆，角色名{name}。{description}。9:16美术一致性，真实毛发与光照。"
        result = client.images.generate(model=image_model, prompt=prompt, size=size, response_format="url")
        data = getattr(result, "data", None) or []
        first = data[0] if data else None
        image_url = first.get("url", "") if isinstance(first, dict) else (getattr(first, "url", "") if first is not None else "")
        if not image_url:
            continue
        out_dir = root / "assets" / "characters" / name
        out_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(out_dir.glob("v*.png"))
        next_v = len(existing) + 1
        out_file = out_dir / f"v{next_v:03d}.png"
        resp = requests.get(image_url, timeout=180)
        resp.raise_for_status()
        out_file.write_bytes(resp.content)
        shutil.copy2(str(out_file), str(out_dir / "latest.png"))
        rec = register_asset_version(state, "face", name, str(out_file), prompt=prompt, source="stage2", remote_url=image_url)
        generated_characters.append({"name": name, "image_file": str(out_file), "image_url": image_url, "version": rec.get("version")})
    for idx, item in enumerate(plan.get("scenes", []), start=1):
        name = str(item.get("name", "")).strip() or f"场景{idx}"
        description = str(item.get("description", "")).strip()
        prompt = str(item.get("prompt", "")).strip() or f"写实电影场景定桩，场景名{name}。{description}。真实光影材质，空间结构清晰，9:16。"
        if scene_with_character_anchors:
            prompt = append_scene_character_constraints(prompt, state, "master")
        result = client.images.generate(model=image_model, prompt=prompt, size=size, response_format="url")
        data = getattr(result, "data", None) or []
        first = data[0] if data else None
        image_url = first.get("url", "") if isinstance(first, dict) else (getattr(first, "url", "") if first is not None else "")
        if not image_url:
            continue
        out_dir = root / "assets" / "scenes" / name
        out_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(out_dir.glob("v*.png"))
        next_v = len(existing) + 1
        out_file = out_dir / f"v{next_v:03d}.png"
        resp = requests.get(image_url, timeout=180)
        resp.raise_for_status()
        out_file.write_bytes(resp.content)
        shutil.copy2(str(out_file), str(out_dir / "latest.png"))
        rec = register_asset_version(state, "scene", name, str(out_file), prompt=prompt, source="stage2", remote_url=image_url)
        generated_scenes.append({"name": name, "image_file": str(out_file), "image_url": image_url, "version": rec.get("version")})
    storyboard_text = plan.get("storyboard_text", [])
    if storyboard_text:
        prompt = (
            "把以下分镜文本转为正式分镜JSON数组。"
            "结构[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，写实电影感，9:16\"}]。"
            "visual_prompt必须包含可执行拍摄描述。"
            f"\n输入：{json.dumps(storyboard_text, ensure_ascii=False)}"
        )
        shots = extract_json(chat(client, text_model, prompt, temperature=0.3))
        if isinstance(shots, list):
            state["shots"] = shots
    set_workflow(state, "shots_ready", "shot-revise / render-shot / render-shots")
    save_state(state_path, state)
    append_event(
        "stage2_assets_generated",
        {"state_file": str(state_path), "characters": len(generated_characters), "scenes": len(generated_scenes), "shots": len(state.get("shots", []))},
    )
    output_payload(
        args,
        {
            "ok": True,
            "state_file": str(state_path),
            "project": str(state.get("title", "")),
            "generated_characters": generated_characters,
            "generated_scenes": generated_scenes,
            "shots": state.get("shots", []),
        },
    )


def cmd_stage2_generate_item(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, _, image_model, _ = ensure_client()
    if not image_model:
        raise RuntimeError("缺少 VOLC_IMAGE_MODEL")
    kind = str(args.kind or "").strip().lower()
    if kind not in {"face", "scene"}:
        raise RuntimeError("kind 仅支持 face/scene")
    name = str(args.name or "").strip()
    if not name:
        raise RuntimeError("缺少 name")
    plan = normalize_stage2_plan(state.get("stage2_plan", {}))
    items = plan.get("characters", []) if kind == "face" else plan.get("scenes", [])
    hit = None
    for item in items:
        if str(item.get("name", "")).strip() == name:
            hit = item
            break
    if hit is None:
        raise RuntimeError(f"在第二步计划中未找到 {name}")
    description = str(hit.get("description", "")).strip()
    style_text = str(args.style or "").strip()
    mode = str(args.mode or "").strip()
    strict_layout = bool(getattr(args, "strict_layout", False))
    scene_with_character_anchors = not bool(getattr(args, "scene_ignore_character_anchors", False))
    if kind == "face":
        base_style = style_text or "写实电影感"
        face_mode = mode or "full_body"
        if face_mode == "portrait":
            composition = "构图：单角色半身或近景肖像，突出脸部特征与表情。"
        elif face_mode == "model_sheet":
            composition = (
                "构图：角色设定板，纯白背景。"
                "同一张图内包含四部分：1) 正面大字型全身站姿（四肢伸展开）；"
                "2) 左侧视图全身；3) 右侧视图全身；4) 脸部细节特写。"
                "要求四部分是同一个角色，外观一致。"
            )
        elif face_mode == "turnaround":
            composition = "构图：单角色站姿定妆，身体完整可见，姿态中性。"
        elif face_mode == "action_pose":
            composition = "构图：单角色全身动作姿态，动作明确但仍为单主体。"
        else:
            composition = "构图：单角色全身定妆照，主体完整。"
        prompt = (
            f"角色名：{name}。角色设定：{description}。"
            f"画面风格：{base_style}。"
            "要求：只出现一个主体角色，不要第二只猫，不要多人互动，不要双角色同框，不要拥抱/对话/并排行走。"
            + composition
            + "硬性约束：角色身份锚点必须一致（发型/毛色、瞳色、服装主色、关键配饰、体型比例）；不得更换服装设定，不得改变年龄感与体型。"
            + "主体占比：角色需清晰可辨并占画面主要区域，禁止主体过小。"
            + "画面质量：高细节、干净背景、无文字水印。"
        )
        if "写实" in base_style:
            prompt += "严格写实摄影风格，不要卡通、不要动漫、不要3D玩具质感。"
        if face_mode == "model_sheet":
            prompt += "背景必须纯白，版面类似角色三视图/模型设定页，禁止出现第二角色。"
            if strict_layout:
                prompt += "使用固定机位与正交式版式：正面、左侧、右侧三视图等比例并排，面部特写单独区域，角色尺度一致，禁止透视夸张和镜头倾斜。"
        out_dir = get_project_root(state) / "assets" / "characters" / name
    else:
        base_style = style_text or "写实电影感"
        scene_mode = mode or "master"
        if scene_mode == "wide":
            scene_composition = "构图：超广角大全景，强调空间关系与景深层次。"
        elif scene_mode == "detail":
            scene_composition = "构图：场景局部特写，突出关键道具或纹理细节。"
        elif scene_mode == "empty_plate":
            scene_composition = "构图：空镜场景，无角色入镜，适合作为环境底板。"
        else:
            scene_composition = "构图：标准场景主镜头，空间结构清晰。"
        prompt = (
            f"场景名：{name}。场景设定：{description}。"
            f"画面风格：{base_style}。"
            + scene_composition
            + "硬性约束：空间结构必须完整（前景/中景/后景可区分），地面与墙体或环境边界关系清晰。"
            + "硬性约束：光源方向明确且稳定，禁止混乱多主光。"
            + "要求：不要出现多角色对戏，不要人物特写抢占主体，光影统一，材质真实。"
        )
        if scene_with_character_anchors:
            prompt = append_scene_character_constraints(prompt, state, scene_mode)
        out_dir = get_project_root(state) / "assets" / "scenes" / name
    prompt += "负面约束：禁止卡通化、禁止Q版、禁止低清晰度、禁止过曝/欠曝、禁止畸变手脚、禁止重复肢体、禁止错位五官、禁止错别字与任何文字logo。"
    if style_text:
        prompt = f"{prompt}\n风格要求：{style_text}"
    size = str(args.size or "1024x1024").strip() or "1024x1024"
    result = client.images.generate(model=image_model, prompt=prompt, size=size, response_format="url")
    data = getattr(result, "data", None) or []
    first = data[0] if data else None
    image_url = first.get("url", "") if isinstance(first, dict) else (getattr(first, "url", "") if first is not None else "")
    if not image_url:
        raise RuntimeError("图片生成失败，未返回url")
    resp = requests.get(image_url, timeout=180)
    resp.raise_for_status()
    lock_path = acquire_state_lock(state_path)
    try:
        latest_state = normalize_state(load_state(state_path))
        out_dir = get_project_root(latest_state) / ("assets/characters" if kind == "face" else "assets/scenes") / name
        out_dir.mkdir(parents=True, exist_ok=True)
        unique_tag = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f") + "_" + uuid.uuid4().hex[:6]
        out_file = out_dir / f"v{unique_tag}.png"
        out_file.write_bytes(resp.content)
        shutil.copy2(str(out_file), str(out_dir / "latest.png"))
        rec = register_asset_version(latest_state, kind, name, str(out_file), prompt=prompt, source="stage2-item", remote_url=image_url)
        set_workflow(latest_state, "assets_ready", "可继续生成素材或进入渲染阶段")
        save_state(state_path, latest_state)
        state = latest_state
    finally:
        release_state_lock(lock_path)
    output_payload(
        args,
        {
            "ok": True,
            "state_file": str(state_path),
            "generated": {
                "kind": kind,
                "name": name,
                "image_file": str(out_file),
                "image_url": image_url,
                "version": rec.get("version"),
            },
            "assets": state.get("assets", {}),
            "asset_active": state.get("asset_active", {}),
        },
    )


def cmd_stage2_generate_shots(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, text_model, _, _ = ensure_client()
    active_video_model = get_active_video_model_name()
    seedance_mode = is_seedance_model(active_video_model)
    plan = normalize_stage2_plan(state.get("stage2_plan", {}))
    storyboard_text = plan.get("storyboard_text", [])
    if not storyboard_text:
        raise RuntimeError("缺少分镜文本，请先在第二步提取分镜")
    max_shots = max(0, int(getattr(args, "max_shots", 0) or 0))
    forced_duration = float(getattr(args, "duration_sec", 0) or 0)
    if forced_duration < 0:
        forced_duration = 0
    if forced_duration > 0 and seedance_mode:
        forced_duration = float(clamp_video_duration_for_model(active_video_model, int(round(forced_duration))))
    style_text = str(args.style or "").strip()
    prompt = (
        "把以下分镜文本转为正式分镜JSON数组。"
        "结构[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词，写实电影感，9:16\"}]。"
        + build_shot_generation_guidance(seedance_mode, has_reference_assets(state))
        + (f"镜头数量控制在{max_shots}条以内。" if max_shots > 0 else "")
        + (f"美术风格：{style_text}。" if style_text else "")
        + f"\n输入：{json.dumps(storyboard_text, ensure_ascii=False)}"
    )
    shots = extract_json(chat(client, text_model, prompt, temperature=0.3))
    if not isinstance(shots, list) or len(shots) == 0:
        raise RuntimeError("未生成有效分镜")
    if max_shots > 0:
        shots = shots[:max_shots]
    if forced_duration > 0:
        normalized = max(1.0, round(forced_duration, 2))
        for item in shots:
            if isinstance(item, dict):
                item["duration_sec"] = normalized
    state["shots"] = shots
    set_workflow(state, "shots_ready", "可继续修订镜头并渲染")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "shots": shots})


def cmd_asset_add(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    file_path = Path(args.file).resolve()
    if not file_path.exists():
        raise RuntimeError(f"素材不存在: {file_path}")
    asset_name = args.name.strip() or file_path.stem
    target_path = str(file_path)
    if str(state.get("project_root", "")).strip():
        kind_key = "face" if args.kind == "face" else "scene"
        if args.kind == "face":
            target_base = project_path(state, f"assets/characters/{asset_name}")
        else:
            target_base = project_path(state, f"assets/scenes/{asset_name}")
        target_base.mkdir(parents=True, exist_ok=True)
        existing = sorted(target_base.glob("v*.png"))
        next_v = len(existing) + 1
        target_file = target_base / f"v{next_v:03d}.png"
        shutil.copy2(str(file_path), str(target_file))
        latest_alias = target_base / "latest.png"
        shutil.copy2(str(target_file), str(latest_alias))
        target_path = str(target_file)
        register_asset_version(state, kind_key, asset_name, target_path, prompt="", source="import")
    else:
        kind_key = "face" if args.kind == "face" else "scene"
        register_asset_version(state, kind_key, asset_name, target_path, prompt="", source="import")
    set_workflow(state, "assets_ready", "shot-revise / render-shot")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "assets": state["assets"], "asset_active": state.get("asset_active", {})})


def cmd_project_init(args):
    base_root = Path(args.root).expanduser().resolve() if args.root else Path.cwd()
    project_name = args.name.strip() if args.name else f"proj_{now_tag()}"
    project_type = str(getattr(args, "project_type", "short")).strip().lower() or "short"
    series_name = str(getattr(args, "series_name", "")).strip() or project_name
    episode_index = max(1, int(getattr(args, "episode_index", 1) or 1))
    if project_type == "series":
        series_root = base_root / series_name
        project_root = series_root / "episodes" / f"ep{episode_index:02d}"
        project_name = f"{series_name}-E{episode_index:02d}"
    else:
        series_root = None
        project_root = base_root / project_name
    state_path = Path(args.state_file).expanduser().resolve() if args.state_file else (project_root / ".openvshot" / "state.json")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state = normalize_state(load_state(state_path))
    (project_root / "assets" / "characters").mkdir(parents=True, exist_ok=True)
    (project_root / "assets" / "scenes").mkdir(parents=True, exist_ok=True)
    (project_root / "scripts").mkdir(parents=True, exist_ok=True)
    (project_root / "shots").mkdir(parents=True, exist_ok=True)
    (project_root / "renders" / "images").mkdir(parents=True, exist_ok=True)
    (project_root / "renders" / "videos").mkdir(parents=True, exist_ok=True)
    if series_root is not None:
        (series_root / "series_bible").mkdir(parents=True, exist_ok=True)
        series_manifest_path = series_root / "series.json"
        series_manifest = {
            "series_name": series_name,
            "updated_at": now_str(),
            "episodes": [],
        }
        if series_manifest_path.exists():
            try:
                loaded_series = json.loads(series_manifest_path.read_text(encoding="utf-8"))
                if isinstance(loaded_series, dict):
                    series_manifest.update(loaded_series)
            except Exception:
                pass
        episodes = series_manifest.get("episodes", [])
        if not isinstance(episodes, list):
            episodes = []
        episode_item = {"episode_index": episode_index, "project_name": project_name, "project_root": str(project_root), "state_file": str(state_path)}
        episodes = [x for x in episodes if int(x.get("episode_index", 0) or 0) != episode_index]
        episodes.append(episode_item)
        episodes.sort(key=lambda x: int(x.get("episode_index", 0) or 0))
        series_manifest["episodes"] = episodes
        series_manifest["updated_at"] = now_str()
        series_manifest_path.write_text(json.dumps(series_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "name": project_name,
        "created_at": now_str(),
        "root": str(project_root),
        "state_file": str(state_path),
        "project_type": project_type,
    }
    if series_root is not None:
        manifest["series_name"] = series_name
        manifest["episode_index"] = episode_index
        manifest["series_root"] = str(series_root)
    (project_root / "project.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    state["project_root"] = str(project_root)
    state["title"] = project_name
    state["project_type"] = project_type
    if series_root is not None:
        state["series_name"] = series_name
        state["episode_index"] = episode_index
        state["series_root"] = str(series_root)
        inherit_state_file = str(getattr(args, "inherit_from_state", "") or "").strip()
        if inherit_state_file:
            try:
                prev_state = normalize_state(load_state(Path(inherit_state_file)))
                for key in ["character_list", "scene_list", "active_faces", "active_scenes", "stage2_instruction", "art_style"]:
                    if key in prev_state:
                        state[key] = prev_state.get(key)
            except Exception:
                pass
    set_workflow(state, "project_ready", "输入故事或先做角色定妆")
    save_state(state_path, state)
    upsert_project_index(default_config_path(), project_name, str(project_root), str(state_path))
    append_event("project_init", {"project_root": str(project_root), "state_file": str(state_path)})
    output_payload(
        args,
        {
            "ok": True,
            "project_name": project_name,
            "project_root": str(project_root),
            "state_file": str(state_path),
            "project_type": project_type,
            "series_name": series_name if series_root is not None else "",
            "episode_index": episode_index if series_root is not None else 0,
        },
    )


def cmd_project_next_episode(args):
    current_state_path = Path(args.state_file) if args.state_file else Path(default_state_path())
    if not current_state_path.exists():
        raise RuntimeError("当前项目状态文件不存在，无法创建下一集")
    current_state = normalize_state(load_state(current_state_path))
    current_root = Path(str(current_state.get("project_root", "")).strip() or ".").resolve()
    series_name = str(current_state.get("series_name", "")).strip() or str(getattr(args, "series_name", "") or "").strip()
    series_root_text = str(current_state.get("series_root", "")).strip()
    if series_root_text:
        series_root = Path(series_root_text).resolve()
    elif current_root.parent.name.lower() == "episodes":
        series_root = current_root.parent.parent.resolve()
    else:
        series_root = current_root.parent.resolve()
    if not series_name:
        series_name = series_root.name or str(current_state.get("title", "")).strip() or "series"
    episode_index = int(current_state.get("episode_index", 0) or 0) + 1
    if episode_index <= 1:
        episode_index = max(2, int(getattr(args, "episode_index", 2) or 2))
    cmd_project_init(
        argparse.Namespace(
            json=getattr(args, "json", False),
            name="",
            root=str(series_root.parent),
            state_file="",
            project_type="series",
            series_name=series_name,
            episode_index=episode_index,
            inherit_from_state=str(current_state_path),
        )
    )


def cmd_project_list(args):
    cfg = load_config(default_config_path())
    projects = cfg.get("projects", [])
    if not isinstance(projects, list):
        projects = []
    output_payload(args, {"ok": True, "projects": projects, "current_state_file": str(cfg.get("current_state_file", ""))})


def cmd_project_use(args):
    cfg_path = default_config_path()
    cfg = load_config(cfg_path)
    projects = cfg.get("projects", [])
    if not isinstance(projects, list):
        projects = []
    target = ""
    if args.state_file and str(args.state_file).strip():
        target = str(args.state_file).strip()
    elif args.name and str(args.name).strip():
        name = str(args.name).strip()
        match = next((p for p in projects if isinstance(p, dict) and str(p.get("name", "")) == name), None)
        if not match:
            raise RuntimeError(f"未找到项目: {name}")
        target = str(match.get("state_file", "")).strip()
    if not target:
        raise RuntimeError("请提供 --name 或 --state-file")
    state_name = ""
    state_root = ""
    try:
        st_path = Path(target)
        if st_path.exists():
            st = normalize_state(load_state(st_path))
            state_name = str(st.get("title", "")).strip()
            state_root = str(st.get("project_root", "")).strip()
    except Exception:
        state_name = ""
        state_root = ""
    cfg["current_state_file"] = target
    cfg["updated_at"] = now_str()
    save_config(cfg_path, cfg)
    if state_name or state_root:
        upsert_project_index(cfg_path, state_name or Path(target).stem, state_root, target)
    output_payload(args, {"ok": True, "current_state_file": target})


def cmd_project_delete(args):
    cfg_path = default_config_path()
    cfg = load_config(cfg_path)
    projects = cfg.get("projects", [])
    if not isinstance(projects, list):
        projects = []
    target = ""
    if args.state_file and str(args.state_file).strip():
        target = str(args.state_file).strip()
    elif args.name and str(args.name).strip():
        name = str(args.name).strip()
        match = next((p for p in projects if isinstance(p, dict) and str(p.get("name", "")) == name), None)
        if not match:
            raise RuntimeError(f"未找到项目: {name}")
        target = str(match.get("state_file", "")).strip()
    if not target:
        raise RuntimeError("请提供 --name 或 --state-file")
    matched = next((p for p in projects if isinstance(p, dict) and str(p.get("state_file", "")).strip() == target), None)
    if not matched:
        raise RuntimeError(f"未找到项目状态文件: {target}")
    cfg["projects"] = [
        p for p in projects
        if not (isinstance(p, dict) and str(p.get("state_file", "")).strip() == target)
    ]
    current = str(cfg.get("current_state_file", "")).strip()
    if current == target:
        if cfg["projects"]:
            cfg["current_state_file"] = str(cfg["projects"][0].get("state_file", "")).strip()
        else:
            cfg["current_state_file"] = ""
    save_config(cfg_path, cfg)
    removed_paths: List[str] = []
    if bool(getattr(args, "remove_files", False)):
        state_path = Path(target).expanduser().resolve()
        project_root_text = str(matched.get("project_root", "")).strip()
        if not project_root_text and state_path.exists():
            try:
                loaded_state = normalize_state(load_state(state_path))
                project_root_text = str(loaded_state.get("project_root", "")).strip()
            except Exception:
                project_root_text = ""
        if project_root_text:
            project_root = Path(project_root_text).expanduser().resolve()
            if project_root.exists() and project_root.is_dir():
                marker_a = project_root / ".openvshot"
                marker_b = project_root / "project.json"
                if marker_a.exists() or marker_b.exists() or bool(getattr(args, "force", False)):
                    shutil.rmtree(project_root, ignore_errors=True)
                    removed_paths.append(str(project_root))
                else:
                    raise RuntimeError(f"项目目录缺少安全标记，拒绝删除：{project_root}")
        if state_path.exists() and state_path.is_file():
            state_path.unlink(missing_ok=True)
            removed_paths.append(str(state_path))
    output_payload(
        args,
        {
            "ok": True,
            "deleted_state_file": target,
            "current_state_file": str(cfg.get("current_state_file", "")),
            "projects": cfg.get("projects", []),
            "removed_paths": removed_paths,
        },
    )


def cmd_project_set_story(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    story = read_text_input(args.input_file) if getattr(args, "input_file", "") else args.story
    story = str(story or "").strip()
    if not story:
        raise RuntimeError("story 为空")
    if args.title and str(args.title).strip():
        state["title"] = str(args.title).strip()
    state["story"] = story
    state["beats"] = state.get("beats", [])
    if not isinstance(state["beats"], list):
        state["beats"] = []
    set_workflow(state, "script_confirmed", "请在第二步分别生成角色、场景与分镜文本")
    save_state(state_path, state)
    append_event("project_set_story", {"state_file": str(state_path), "title": str(state.get("title", "")), "story_len": len(story)})
    output_payload(args, {"ok": True, "state_file": str(state_path), "project": str(state.get("title", "")), "story": story})


def cmd_stage2_generate_part(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, text_model, _, _ = ensure_client()
    story = str(state.get("story", "")).strip()
    if not story:
        raise RuntimeError("缺少已确认剧本，请先完成第一步确认")
    part = str(args.part or "").strip().lower()
    instruction = str(args.instruction or "").strip()
    max_shots = max(0, int(getattr(args, "max_shots", 0) or 0))
    plan = normalize_stage2_plan(state.get("stage2_plan", {}))
    def pick_list(raw: Any, key: str):
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            val = raw.get(key)
            if isinstance(val, list):
                return val
        return []
    if part == "characters":
        prompt = (
            "你是选角导演。根据剧本输出角色数组JSON："
            "[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}]。"
            "要求：角色描述具体，可直接用于生成角色素材。"
            "严格排除：旁白、解说、画外音、字幕、narrator、VO、OS 这类声音或文本标签都不是角色，禁止输出为角色。"
            "强制要求：每个角色description必须包含外观（发型/脸型/体型）、服装（上装/下装/鞋履/材质/颜色）、配件（位置与材质）。"
            "强制要求：每个角色prompt必须包含多角度一致性信息，至少覆盖正面、左侧、右侧、背面、脸部特写。"
            "强制要求：禁止输出空泛词，description和prompt都不少于80个中文字符。"
            f"\n剧本：{story}\n补充要求：{instruction or '角色风格写实，形象鲜明。'}"
        )
        chars = pick_list(extract_json(chat(client, text_model, prompt, temperature=0.35)), "characters")
        if not chars:
            raise RuntimeError("未提取到角色，请调整要求后重试")
        plan["characters"] = chars
    elif part == "scenes":
        prompt = (
            "你是美术场景导演。根据剧本输出场景数组JSON："
            "[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}]。"
            "要求：场景描述可直接用于生成场景素材。"
            f"\n剧本：{story}\n补充要求：{instruction or '空间关系清晰，光影写实。'}"
        )
        scenes = pick_list(extract_json(chat(client, text_model, prompt, temperature=0.35)), "scenes")
        if not scenes:
            raise RuntimeError("未提取到场景，请调整要求后重试")
        plan["scenes"] = scenes
    elif part == "storyboard":
        prompt = (
            "你是分镜导演。根据剧本输出分镜文本数组JSON："
            "[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"\",\"visual_hint\":\"\"}]。"
            "要求：镜头连续，时长合理，适配9:16短视频。"
            "严格要求：每条visual_hint必须明确角色是谁（外观特征/服装）、所在场景（地点/时间/天气或室内外）、镜头景别与机位、动作与情绪、光线与氛围、关键道具。"
            "每条visual_hint不少于60个中文字符，禁止空泛短句。"
            "每条visual_hint必须包含动作分解（起势-主动作-收势-定格）和动作连贯要求，避免假人感、肢体扭曲、脚步滑移、视线乱跳。"
            "相邻镜头必须体现动作衔接与视线方向衔接。"
            + (f"镜头数量控制在{max_shots}条以内。" if max_shots > 0 else "")
            + f"\n剧本：{story}\n补充要求：{instruction or '突出冲突和反转。'}"
        )
        boards = pick_list(extract_json(chat(client, text_model, prompt, temperature=0.35)), "storyboard_text")
        if not boards:
            raise RuntimeError("未提取到分镜文本，请调整要求后重试")
        if max_shots > 0:
            boards = boards[:max_shots]
        plan["storyboard_text"] = boards
    else:
        raise RuntimeError("part 仅支持 characters/scenes/storyboard")
    plan = normalize_stage2_plan(plan)
    state["stage2_plan"] = plan
    set_workflow(state, "stage2_prepared", "可继续生成其它部分或进入素材阶段")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "part": part, "stage2_plan": plan})


def cmd_project_open(args):
    cfg_path = default_config_path()
    cfg = load_config(cfg_path)
    projects = cfg.get("projects", [])
    if not isinstance(projects, list):
        projects = []
    if not projects:
        raise RuntimeError("没有可用项目，请先 project-init")
    if args.index > 0:
        idx = args.index - 1
        if idx < 0 or idx >= len(projects):
            raise RuntimeError(f"项目序号无效: {args.index}")
        chosen = projects[idx]
    else:
        print("请选择要恢复的项目：")
        for i, p in enumerate(projects, start=1):
            if not isinstance(p, dict):
                continue
            print(f"{i}. {p.get('name','')} | {p.get('project_root','')} | {p.get('last_used_at','')}")
        raw = input("输入序号: ").strip()
        if not raw.isdigit():
            raise RuntimeError("请输入有效数字序号")
        idx = int(raw) - 1
        if idx < 0 or idx >= len(projects):
            raise RuntimeError("序号超出范围")
        chosen = projects[idx]
    target = str(chosen.get("state_file", "")).strip()
    if not target:
        raise RuntimeError("项目缺少 state_file")
    cfg["current_state_file"] = target
    save_config(cfg_path, cfg)
    output_payload(args, {"ok": True, "current_state_file": target, "project": chosen})


def cmd_continue(args):
    cfg_path = default_config_path()
    cfg = load_config(cfg_path)
    target = str(cfg.get("current_state_file", "")).strip()
    if not target:
        raise RuntimeError("没有最近项目，请先 project-init 或 project-use")
    st_path = Path(target)
    if not st_path.exists():
        raise RuntimeError(f"最近项目状态文件不存在: {target}")
    state = normalize_state(load_state(st_path))
    status = compute_status(state)
    project = {
        "name": str(state.get("title", "")).strip() or st_path.stem,
        "project_root": str(state.get("project_root", "")).strip(),
        "state_file": str(st_path),
    }
    if args.open_chat or getattr(args, "chat", False):
        cmd_chat(argparse.Namespace(json=False, state_file=str(st_path), config_file="",))
        return
    output_payload(
        args,
        {
            "ok": True,
            "project": project,
            "status": status,
            "recommended_action": status.get("next_action", ""),
        },
    )


def cmd_p(args):
    action = str(args.action or "").strip().lower()
    if action in {"new", "init"}:
        cmd_project_init(
            argparse.Namespace(
                json=getattr(args, "json", False),
                name=args.name,
                root=args.root,
                state_file=args.state_file,
                project_type=getattr(args, "project_type", "short"),
                series_name=getattr(args, "series_name", ""),
                episode_index=getattr(args, "episode_index", 1),
                inherit_from_state=getattr(args, "inherit_from_state", ""),
            )
        )
        return
    if action in {"next-episode", "next-ep"}:
        cmd_project_next_episode(
            argparse.Namespace(
                json=getattr(args, "json", False),
                state_file=args.state_file,
                series_name=getattr(args, "series_name", ""),
                episode_index=getattr(args, "episode_index", 2),
            )
        )
        return
    if action in {"list", "ls"}:
        cmd_project_list(argparse.Namespace(json=getattr(args, "json", False)))
        return
    if action in {"use", "switch"}:
        cmd_project_use(
            argparse.Namespace(
                json=getattr(args, "json", False),
                name=args.name,
                state_file=args.state_file,
            )
        )
        return
    if action in {"delete", "remove", "rm"}:
        cmd_project_delete(
            argparse.Namespace(
                json=getattr(args, "json", False),
                name=args.name,
                state_file=args.state_file,
                remove_files=getattr(args, "remove_files", False),
                force=getattr(args, "force", False),
            )
        )
        return
    if action in {"open", "pick"}:
        cmd_project_open(
            argparse.Namespace(
                json=getattr(args, "json", False),
                index=args.index,
            )
        )
        return
    if action in {"continue", "cont"}:
        cmd_continue(
            argparse.Namespace(
                json=getattr(args, "json", False),
                open_chat=args.open_chat,
                chat=args.chat,
            )
        )
        return
    raise RuntimeError("p 命令只支持: new/list/use/delete/open/continue/next-episode")


def cmd_character_design(args):
    client, _, image_model, _ = ensure_client()
    if not image_model:
        raise RuntimeError("缺少 VOLC_IMAGE_MODEL")
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    root = get_project_root(state)
    name = args.name.strip()
    description = args.description.strip()
    if not name or not description:
        raise RuntimeError("name 和 description 不能为空")
    prompt = (
        f"写实宠物角色定妆，角色名{name}。{description}。"
        "三视图设定感，真实毛发细节，摄影级光照，中性纯色背景，角色一致性锁定，无文字无水印。"
    )
    result = client.images.generate(
        model=image_model,
        prompt=prompt,
        size=args.size,
        response_format="url",
    )
    data = getattr(result, "data", None) or []
    first = data[0] if data else None
    image_url = ""
    if isinstance(first, dict):
        image_url = first.get("url", "")
    else:
        image_url = getattr(first, "url", "") if first is not None else ""
    if not image_url:
        raise RuntimeError("图片生成成功但未返回 URL")
    out_dir = root / "assets" / "characters" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(out_dir.glob("v*.png"))
    next_v = len(existing) + 1
    out_file = out_dir / f"v{next_v:03d}.png"
    resp = requests.get(image_url, timeout=180)
    resp.raise_for_status()
    out_file.write_bytes(resp.content)
    latest_alias = out_dir / "latest.png"
    shutil.copy2(str(out_file), str(latest_alias))
    rec = register_asset_version(state, "face", name, str(out_file), prompt=prompt, source="generated", remote_url=image_url)
    set_workflow(state, "character_ready", "继续 character-design 或 scene-design")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "name": name, "image_file": str(out_file), "image_url": image_url, "version": rec.get("version"), "tag": rec.get("tag")})


def cmd_scene_design(args):
    client, _, image_model, _ = ensure_client()
    if not image_model:
        raise RuntimeError("缺少 VOLC_IMAGE_MODEL")
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    root = get_project_root(state)
    name = args.name.strip()
    description = args.description.strip()
    if not name or not description:
        raise RuntimeError("name 和 description 不能为空")
    prompt = (
        f"写实影视场景定桩，场景名{name}。{description}。"
        "电影级构图，真实光影与材质，空间关系清晰，便于分镜复用，中性底色参考图风格。"
    )
    result = client.images.generate(
        model=image_model,
        prompt=prompt,
        size=args.size,
        response_format="url",
    )
    data = getattr(result, "data", None) or []
    first = data[0] if data else None
    image_url = ""
    if isinstance(first, dict):
        image_url = first.get("url", "")
    else:
        image_url = getattr(first, "url", "") if first is not None else ""
    if not image_url:
        raise RuntimeError("图片生成成功但未返回 URL")
    out_dir = root / "assets" / "scenes" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(out_dir.glob("v*.png"))
    next_v = len(existing) + 1
    out_file = out_dir / f"v{next_v:03d}.png"
    resp = requests.get(image_url, timeout=180)
    resp.raise_for_status()
    out_file.write_bytes(resp.content)
    latest_alias = out_dir / "latest.png"
    shutil.copy2(str(out_file), str(latest_alias))
    rec = register_asset_version(state, "scene", name, str(out_file), prompt=prompt, source="generated", remote_url=image_url)
    set_workflow(state, "scene_ready", "继续 scene-design 或 plan")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "name": name, "image_file": str(out_file), "image_url": image_url, "version": rec.get("version"), "tag": rec.get("tag")})


def cmd_asset_list(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    ensure_asset_structures(state)
    kind = args.kind.strip() if args.kind else ""
    name = args.name.strip() if args.name else ""
    registry = state.get("asset_registry", {})
    active = state.get("asset_active", {})
    payload = {"ok": True, "state_file": str(state_path), "registry": registry, "active": active}
    if kind in {"face", "scene"}:
        payload["registry"] = {kind: registry.get(kind, {})}
        payload["active"] = {kind: active.get(kind, {})}
    if name:
        scoped = {}
        for k in ["face", "scene"]:
            entry = registry.get(k, {}).get(name)
            if entry:
                scoped.setdefault("registry", {})[k] = {name: entry}
                scoped.setdefault("active", {})[k] = {name: active.get(k, {}).get(name)}
        payload.update(scoped)
    output_payload(args, payload)


def cmd_asset_activate(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    ensure_asset_structures(state)
    kind = args.kind.strip()
    name = args.name.strip()
    reg = state["asset_registry"].get(kind, {}).get(name)
    if not reg:
        raise RuntimeError(f"未找到资产: {kind}/{name}")
    versions = reg.get("versions", [])
    if not versions:
        raise RuntimeError(f"资产没有版本: {kind}/{name}")
    lock_ver = int(state.get("asset_lock", {}).get(kind, {}).get(name, 0))
    if lock_ver and args.version != "latest" and int(args.version) != lock_ver:
        raise RuntimeError(f"资产已锁定为 v{lock_ver}，请先解锁")
    if args.version == "latest":
        version_no = latest_valid_version(versions)
    else:
        version_no = int(args.version)
    match = next((v for v in versions if int(v.get("version", 0)) == version_no), None)
    if not match:
        raise RuntimeError(f"版本不存在: {kind}/{name} v{version_no}")
    if match.get("deleted"):
        raise RuntimeError(f"版本已软删除: {kind}/{name} v{version_no}")
    if str(state.get("project_root", "")).strip():
        source_file = Path(str(match.get("file", "")))
        if source_file.exists():
            sub_dir = "characters" if kind == "face" else "scenes"
            alias_dir = project_path(state, f"assets/{sub_dir}/{name}")
            alias_dir.mkdir(parents=True, exist_ok=True)
            alias_file = alias_dir / "latest.png"
            shutil.copy2(str(source_file), str(alias_file))
    state["asset_active"][kind][name] = version_no
    sync_active_assets_lists(state)
    set_workflow(state, "assets_ready", "继续分镜或渲染")
    save_state(state_path, state)
    append_event("asset_activate", {"kind": kind, "name": name, "version": version_no})
    output_payload(args, {"ok": True, "state_file": str(state_path), "kind": kind, "name": name, "active_version": version_no, "file": match.get("file", "")})


def cmd_asset_remove_version(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    ensure_asset_structures(state)
    kind = args.kind.strip()
    name = args.name.strip()
    version_no = int(args.version)
    reg = state["asset_registry"].get(kind, {}).get(name)
    if not reg:
        raise RuntimeError(f"未找到资产: {kind}/{name}")
    versions = reg.get("versions", [])
    target = next((v for v in versions if int(v.get("version", 0)) == version_no), None)
    if not target:
        raise RuntimeError(f"版本不存在: {kind}/{name} v{version_no}")
    target["deleted"] = True
    target["deleted_at"] = now_str()
    current_active = int(state.get("asset_active", {}).get(kind, {}).get(name, 0))
    if current_active == version_no:
        fallback = latest_valid_version(versions)
        if fallback > 0:
            state["asset_active"][kind][name] = fallback
        else:
            state["asset_active"][kind].pop(name, None)
    if str(state.get("project_root", "")).strip():
        sub_dir = "characters" if kind == "face" else "scenes"
        alias_dir = project_path(state, f"assets/{sub_dir}/{name}")
        alias_dir.mkdir(parents=True, exist_ok=True)
        alias_file = alias_dir / "latest.png"
        active_ver = int(state.get("asset_active", {}).get(kind, {}).get(name, 0))
        if active_ver:
            active_rec = next((v for v in versions if int(v.get("version", 0)) == active_ver), None)
            if active_rec and Path(str(active_rec.get("file", ""))).exists():
                shutil.copy2(str(active_rec.get("file", "")), str(alias_file))
        elif alias_file.exists():
            alias_file.unlink(missing_ok=True)
    sync_active_assets_lists(state)
    set_workflow(state, "assets_ready", "可继续生成或切换版本")
    save_state(state_path, state)
    append_event("asset_remove_version", {"kind": kind, "name": name, "version": version_no})
    output_payload(args, {"ok": True, "state_file": str(state_path), "kind": kind, "name": name, "removed_version": version_no, "active": state.get("asset_active", {}).get(kind, {}).get(name)})


def cmd_asset_lock(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    ensure_asset_structures(state)
    if "asset_lock" not in state or not isinstance(state.get("asset_lock"), dict):
        state["asset_lock"] = {"face": {}, "scene": {}}
    state["asset_lock"].setdefault("face", {})
    state["asset_lock"].setdefault("scene", {})
    kind = args.kind.strip()
    name = args.name.strip()
    reg = state["asset_registry"].get(kind, {}).get(name)
    if not reg:
        raise RuntimeError(f"未找到资产: {kind}/{name}")
    versions = reg.get("versions", [])
    if args.unlock:
        state["asset_lock"][kind].pop(name, None)
        save_state(state_path, state)
        append_event("asset_unlock", {"kind": kind, "name": name})
        output_payload(args, {"ok": True, "state_file": str(state_path), "kind": kind, "name": name, "locked": False})
        return
    if args.version == "latest":
        version_no = latest_valid_version(versions)
    else:
        version_no = int(args.version)
    match = next((v for v in versions if int(v.get("version", 0)) == version_no), None)
    if not match or match.get("deleted"):
        raise RuntimeError(f"无法锁定版本: {kind}/{name} v{version_no}")
    state["asset_lock"][kind][name] = version_no
    state["asset_active"][kind][name] = version_no
    sync_active_assets_lists(state)
    save_state(state_path, state)
    append_event("asset_lock", {"kind": kind, "name": name, "version": version_no})
    output_payload(args, {"ok": True, "state_file": str(state_path), "kind": kind, "name": name, "locked": True, "version": version_no})


def cmd_shot_revise(args):
    client, text_model, _, _ = ensure_client()
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    seedance_mode = is_seedance_model(get_active_video_model_name())
    shots = state.get("shots", [])
    if not shots:
        raise RuntimeError("没有 shots，请先执行 plan/pipeline")
    shot_id = args.shot_id.strip()
    target = None
    for s in shots:
        if isinstance(s, dict) and str(s.get("shot_id", "")).strip() == shot_id:
            target = s
            break
    if not target:
        raise RuntimeError(f"未找到镜头: {shot_id}")
    instruction = read_text_input(args.input_file) if args.input_file else args.instruction
    if not instruction.strip():
        raise RuntimeError("修订意见为空")
    face_refs = state.get("assets", {}).get("faces", [])
    scene_refs = state.get("assets", {}).get("scenes", [])
    prompt = (
        "你是SCU-OS分镜优化师。根据修订意见重写该镜头，输出单个JSON对象，结构"
        "{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词\"}。"
        "若有人脸素材和场景素材，必须在visual_prompt中加入referenced face/scene consistency描述。"
        + build_shot_generation_guidance(seedance_mode, has_reference_assets(state))
        + f"\n当前镜头：{json.dumps(target, ensure_ascii=False)}"
        + f"\n人脸素材：{json.dumps(face_refs, ensure_ascii=False)}"
        + f"\n场景素材：{json.dumps(scene_refs, ensure_ascii=False)}"
        + f"\n修订意见：{instruction}"
    )
    new_shot = extract_json(chat(client, text_model, prompt, temperature=0.35))
    if not isinstance(new_shot, dict):
        raise RuntimeError("模型未返回镜头对象")
    for i, s in enumerate(shots):
        if isinstance(s, dict) and str(s.get("shot_id", "")).strip() == shot_id:
            shots[i] = new_shot
            break
    state["shots"] = shots
    set_workflow(state, "shots_revised", "render-shot")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "shot": new_shot})


def cmd_render_shot(args):
    retry_opts = resolve_retry_options(args)
    backend = resolve_video_backend()
    provider = str(backend.get("provider", "ark"))
    video_model = str(backend.get("video_model", "")).strip()
    if not video_model:
        raise RuntimeError("缺少视频模型配置")
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    shots = state.get("shots", [])
    shot_id = args.shot_id.strip()
    shot = next((s for s in shots if isinstance(s, dict) and str(s.get("shot_id", "")).strip() == shot_id), None)
    if not shot:
        raise RuntimeError(f"未找到镜头: {shot_id}")
    prompt = build_render_prompt(state, shot, str(shot.get("visual_prompt", "")).strip(), video_model)
    if not prompt:
        raise RuntimeError("镜头缺少 visual_prompt")
    duration = clamp_video_duration_for_model(video_model, int(float(shot.get("duration_sec", 5) or 5)))
    submission_meta: Dict[str, Any] = {}
    if provider == "fal":
        payload = fal_submit_video_task(
            api_key=str(backend.get("api_key", "")),
            base_url=str(backend.get("base_url", "https://queue.fal.run")),
            video_model=video_model,
            state=state,
            prompt=prompt,
            duration=duration,
            ratio=args.ratio,
            submission_meta=submission_meta,
            retry_count=int(retry_opts["retry_count"]),
            retry_wait=float(retry_opts["retry_wait"]),
        )
        task_id = str(payload.get("request_id", "")).strip()
    else:
        created = submit_video_task(
            client=backend.get("client"),
            video_model=video_model,
            state=state,
            prompt=prompt,
            duration=duration,
            ratio=args.ratio,
            strict_multimodal=bool(getattr(args, "strict_multimodal", False)),
            submission_meta=submission_meta,
        )
        payload = to_dict(created)
        task_id = payload.get("id") or getattr(created, "id", "")
    result_obj = {
        "shot_id": shot_id,
        "task_id": task_id,
        "provider": provider,
        "video_model": video_model,
        "status": "",
        "video_url": "",
        "request_mode": str(submission_meta.get("request_mode", "multimodal")),
        "image_ref_count": int(submission_meta.get("image_ref_count", 0) or 0),
        "has_face_ref": bool(submission_meta.get("has_face_ref", False)),
        "has_scene_ref": bool(submission_meta.get("has_scene_ref", False)),
        "constraints_applied": bool(submission_meta.get("constraints_applied", False)),
        "status_url": str(submission_meta.get("status_url", "")),
        "response_url": str(submission_meta.get("response_url", "")),
    }
    if args.poll:
        if provider == "fal":
            poll_result = fal_poll_video_result(
                api_key=str(backend.get("api_key", "")),
                base_url=str(backend.get("base_url", "https://queue.fal.run")),
                video_model=video_model,
                request_id=str(task_id),
                interval=args.interval,
                timeout=args.timeout,
                status_url=str(result_obj.get("status_url", "")),
                response_url=str(result_obj.get("response_url", "")),
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
            result_obj["status"] = str(poll_result.get("status", ""))
            result_obj["video_url"] = str(poll_result.get("video_url", ""))
        else:
            deadline = time.time() + args.timeout
            last_status = ""
            while time.time() < deadline:
                result = backend.get("client").content_generation.tasks.get(task_id=task_id)
                body = to_dict(result)
                status_value = str(body.get("status", ""))
                last_status = status_value
                video_url = extract_video_url_from_payload(body)
                if video_url:
                    result_obj["video_url"] = video_url
                    result_obj["status"] = status_value
                    break
                if status_value.lower() in {"failed", "error"}:
                    result_obj["status"] = status_value
                    break
                time.sleep(args.interval)
            if not result_obj.get("status") and last_status:
                result_obj["status"] = last_status
    state["render_tasks"] = [x for x in state.get("render_tasks", []) if str(x.get("shot_id", "")) != shot_id]
    state["render_tasks"].append(
        {
            "shot_id": shot_id,
            "task_id": task_id,
            "provider": provider,
            "video_model": video_model,
            "duration_sec": duration,
            "request_mode": str(submission_meta.get("request_mode", "multimodal")),
            "image_ref_count": int(submission_meta.get("image_ref_count", 0) or 0),
            "has_face_ref": bool(submission_meta.get("has_face_ref", False)),
            "has_scene_ref": bool(submission_meta.get("has_scene_ref", False)),
            "constraints_applied": bool(submission_meta.get("constraints_applied", False)),
            "status_url": str(submission_meta.get("status_url", "")),
            "response_url": str(submission_meta.get("response_url", "")),
        }
    )
    state["render_results"] = [x for x in state.get("render_results", []) if str(x.get("shot_id", "")) != shot_id]
    state["render_results"].append(result_obj)
    if result_obj.get("video_url") and args.download_dir:
        download_dir = Path(args.download_dir)
        if not download_dir.is_absolute() and str(state.get("project_root", "")).strip():
            download_dir = project_path(state, f"renders/{args.download_dir}")
        download_dir.mkdir(parents=True, exist_ok=True)
        out = download_dir / f"{shot_id}.mp4"
        resp = requests.get(result_obj["video_url"], timeout=180)
        resp.raise_for_status()
        out.write_bytes(resp.content)
        result_obj["local_file"] = str(out)
    if args.approve and result_obj.get("video_url"):
        approved = set(state.get("approved_shots", []))
        approved.add(shot_id)
        state["approved_shots"] = sorted(list(approved))
    set_workflow(state, "shot_rendered", "继续 render-shot 或 merge-approved")
    save_state(state_path, state)
    append_event("render_shot", {"shot_id": shot_id, "approved": bool(args.approve)})
    output_payload(args, {"ok": True, "state_file": str(state_path), "retry": retry_opts, "result": result_obj, "approved_shots": state.get("approved_shots", [])})


def cmd_merge_approved(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    approved = set(state.get("approved_shots", []))
    if not approved:
        raise RuntimeError("没有已批准镜头，请先用 render-shot --approve")
    download_dir = Path(args.download_dir)
    if not download_dir.is_absolute() and str(state.get("project_root", "")).strip():
        download_dir = project_path(state, f"renders/{args.download_dir}")
    if not download_dir.exists():
        raise RuntimeError("下载目录不存在")
    render_results_map = {
        str(x.get("shot_id", "")): x
        for x in state.get("render_results", [])
        if isinstance(x, dict)
    }
    ordered = []
    for shot in state.get("shots", []):
        if not isinstance(shot, dict):
            continue
        sid = str(shot.get("shot_id", ""))
        if sid in approved:
            fp = download_dir / f"{sid}.mp4"
            if fp.exists():
                ordered.append(str(fp))
                continue
            rec = render_results_map.get(sid, {})
            rec_file = Path(str(rec.get("local_file", "")).strip()) if str(rec.get("local_file", "")).strip() else None
            if rec_file and rec_file.exists():
                ordered.append(str(rec_file))
                continue
            rec_url = str(rec.get("video_url", "")).strip()
            if rec_url:
                try:
                    response = requests.get(rec_url, timeout=180)
                    response.raise_for_status()
                    fp.write_bytes(response.content)
                    ordered.append(str(fp))
                except Exception:
                    pass
    if len(ordered) < 2:
        raise RuntimeError("可合并镜头不足2个")
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise RuntimeError("未找到 ffmpeg")
    output_file = download_dir / args.output
    cmd = [ffmpeg_path, "-y"]
    for fp in ordered:
        cmd.extend(["-i", fp])
    filter_in_av = "".join([f"[{i}:v][{i}:a]" for i in range(len(ordered))])
    filter_expr_av = f"{filter_in_av}concat=n={len(ordered)}:v=1:a=1[v][a]"
    try:
        subprocess.run(
            cmd
            + [
                "-filter_complex",
                filter_expr_av,
                "-map",
                "[v]",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                str(output_file),
            ],
            check=True,
        )
    except Exception:
        filter_in = "".join([f"[{i}:v]" for i in range(len(ordered))])
        filter_expr = f"{filter_in}concat=n={len(ordered)}:v=1:a=0[v]"
        subprocess.run(cmd + ["-filter_complex", filter_expr, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(output_file)], check=True)
    state["final_video"] = str(output_file)
    set_workflow(state, "merged", "完成")
    save_state(state_path, state)
    append_event("merge_completed", {"output_file": str(output_file), "merged_count": len(ordered)})
    output_payload(args, {"ok": True, "output_file": str(output_file), "merged_count": len(ordered)})


def cmd_voiceover_generate(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    script = read_text_input(args.input_file) if getattr(args, "input_file", None) else str(getattr(args, "script", "") or "").strip()
    if not script:
        script = build_voiceover_script_from_state(state, approved_only=bool(getattr(args, "approved_only", False)))
    if not script:
        raise RuntimeError("缺少旁白文本，且无法从镜头字幕生成")
    settings = resolve_volc_tts_settings(args)
    project_root = str(state.get("project_root", "")).strip()
    if not project_root:
        raise RuntimeError("项目缺少 project_root")
    output_file = Path(args.output) if getattr(args, "output", None) else project_path(state, f"voice/voiceover_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp3")
    if not output_file.is_absolute():
        output_file = project_path(state, f"voice/{args.output}")
    synthesize_volc_tts(
        text=script,
        output_file=output_file,
        settings=settings,
        speed_ratio=float(getattr(args, "speed_ratio", 1.0) or 1.0),
        volume_ratio=float(getattr(args, "volume_ratio", 1.0) or 1.0),
        pitch_ratio=float(getattr(args, "pitch_ratio", 1.0) or 1.0),
    )
    state["voiceover"] = {
        **to_dict(state.get("voiceover")),
        "provider": "volcano_tts",
        "script": script,
        "audio_file": str(output_file),
        "voice_type": str(settings.get("voice_type", "")).strip(),
        "resource_id": str(settings.get("resource_id", "")).strip(),
        "updated_at": iso_now(),
    }
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "voiceover": state["voiceover"]})


def cmd_dub_final_video(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise RuntimeError("未找到 ffmpeg")
    video_file = Path(str(getattr(args, "video_file", "") or "").strip() or str(state.get("final_video", "")).strip())
    if not video_file.exists():
        raise RuntimeError("待配音视频不存在，请先合并视频")
    voiceover = to_dict(state.get("voiceover"))
    audio_file = Path(str(getattr(args, "audio_file", "") or "").strip() or str(voiceover.get("audio_file", "")).strip())
    if not audio_file.exists():
        raise RuntimeError("配音音频不存在，请先生成旁白音频")
    output_file = Path(str(getattr(args, "output", "") or "").strip()) if str(getattr(args, "output", "") or "").strip() else video_file.with_name(f"{video_file.stem}_dubbed.mp4")
    if not output_file.is_absolute():
        output_file = project_path(state, f"voice/{output_file.name}")
    subprocess.run(
        [
            ffmpeg_path,
            "-y",
            "-i",
            str(video_file),
            "-i",
            str(audio_file),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            str(output_file),
        ],
        check=True,
    )
    state["voiceover"] = {
        **voiceover,
        "dubbed_video": str(output_file),
        "updated_at": iso_now(),
    }
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "voiceover": state["voiceover"], "output_file": str(output_file)})


def cmd_approve_shots(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    raw = str(args.shot_ids or "").strip()
    if not raw:
        raise RuntimeError("shot_ids 为空")
    shot_ids = [s.strip() for s in raw.split(",") if s.strip()]
    if not shot_ids:
        raise RuntimeError("shot_ids 为空")
    known = set()
    for shot in state.get("shots", []):
        if isinstance(shot, dict):
            sid = str(shot.get("shot_id", "")).strip()
            if sid:
                known.add(sid)
    valid = [sid for sid in shot_ids if sid in known]
    if not valid:
        raise RuntimeError("未匹配到有效镜头ID")
    if args.replace:
        approved = set(valid)
    else:
        approved = set(state.get("approved_shots", []))
        approved.update(valid)
    state["approved_shots"] = sorted(list(approved))
    save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "approved_shots": state.get("approved_shots", []), "applied": valid})


def cmd_status(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    output_payload(args, {"ok": True, "state_file": str(state_path), "status": compute_status(state)})


def cmd_resume(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    status = compute_status(state)
    action = status.get("next_action", "")
    resumed = {"ok": True, "state_file": str(state_path), "status": status}
    if args.poll_render:
        client, _, _, _ = ensure_client()
        tasks = state.get("render_tasks", [])
        results_map = {str(x.get("shot_id", "")): x for x in state.get("render_results", []) if isinstance(x, dict)}
        deadline = time.time() + args.timeout
        updated = []
        for t in tasks:
            if not isinstance(t, dict):
                continue
            shot_id = str(t.get("shot_id", ""))
            prior = results_map.get(shot_id, {})
            if prior.get("video_url"):
                updated.append(prior)
                continue
            task_id = str(t.get("task_id", ""))
            status_value = ""
            video_url = ""
            while time.time() < deadline:
                result = client.content_generation.tasks.get(task_id=task_id)
                body = to_dict(result)
                status_value = str(body.get("status", ""))
                video_url = extract_video_url_from_payload(body) or video_url
                if video_url:
                    break
                if status_value.lower() in {"failed", "error"}:
                    break
                time.sleep(args.interval)
            rec = {"shot_id": shot_id, "task_id": task_id, "status": status_value, "video_url": video_url}
            updated.append(rec)
        state["render_results"] = updated
        set_workflow(state, "rendered", "review shots -> approve -> merge-approved")
        save_state(state_path, state)
        resumed["render_results"] = updated
        resumed["status"] = compute_status(state)
        action = resumed["status"].get("next_action", "")
    resumed["recommended_action"] = action
    output_payload(args, resumed)


def cmd_regression_full(args):
    state_file = Path(args.state_file).expanduser().resolve() if str(args.state_file or "").strip() else (Path(args.root).expanduser().resolve() / ".openvshot" / "state.json")
    project_root = Path(args.root).expanduser().resolve()
    script_path = Path(__file__).resolve()
    download_dir = Path(args.download_dir).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()
    max_shots = max(1, int(getattr(args, "max_shots", 4) or 4))
    size = str(getattr(args, "size", "1024x1024") or "1024x1024").strip() or "1024x1024"

    def run_cli_json(step_name: str, cli_args: List[str]) -> Dict[str, Any]:
        cmd = [sys.executable, str(script_path), "--json"] + cli_args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            stderr_text = (result.stderr or "").strip()
            stdout_text = (result.stdout or "").strip()
            message = stderr_text or stdout_text or f"{step_name} 执行失败"
            raise RuntimeError(f"{step_name} 失败: {message}")
        lines = [line.strip() for line in str(result.stdout or "").splitlines() if line.strip()]
        payload_line = next((line for line in reversed(lines) if line.startswith("{") and line.endswith("}")), "")
        if not payload_line:
            return {"ok": True}
        try:
            return json.loads(payload_line)
        except Exception:
            return {"ok": True, "raw": payload_line}

    init_payload = run_cli_json(
        "project-init",
        [
            "project-init",
            "--name",
            str(args.name or "regression-full"),
            "--root",
            str(project_root.parent),
            "--state-file",
            str(state_file),
            "--project-type",
            "short",
        ],
    )
    run_cli_json(
        "project-set-story",
        [
            "project-set-story",
            "--state-file",
            str(state_file),
            "--title",
            str(args.title or "回归短片"),
            "--story",
            str(args.story or ""),
        ],
    )
    quality_payload = run_cli_json(
        "script-quality",
        [
            "script-quality",
            "--title",
            str(args.title or "回归短片"),
            "--text",
            str(args.story or ""),
            "--scene-count",
            "3",
        ],
    )
    short_audit_payload = run_cli_json(
        "script-shortvideo-audit",
        [
            "script-shortvideo-audit",
            "--title",
            str(args.title or "回归短片"),
            "--text",
            str(args.story or ""),
            "--platform",
            str(args.platform or "douyin"),
            "--duration-sec",
            str(max(5, int(getattr(args, "duration_sec", 30) or 30))),
        ],
    )
    safety_payload = run_cli_json(
        "script-safety-audit",
        [
            "script-safety-audit",
            "--title",
            str(args.title or "回归短片"),
            "--text",
            str(args.story or ""),
        ],
    )
    gate_payload = {
        "quality_pass": bool(quality_payload.get("scorecard", {}).get("pass")) if isinstance(quality_payload, dict) else False,
        "shortvideo_pass": bool(short_audit_payload.get("audit", {}).get("pass")) if isinstance(short_audit_payload, dict) else False,
        "safety_pass": bool(safety_payload.get("safety", {}).get("pass")) if isinstance(safety_payload, dict) else False,
    }
    gate_payload["all_pass"] = bool(gate_payload["quality_pass"] and gate_payload["shortvideo_pass"] and gate_payload["safety_pass"])
    if bool(getattr(args, "strict_gate", False)) and not gate_payload["all_pass"]:
        detail = f"quality={gate_payload['quality_pass']}, shortvideo={gate_payload['shortvideo_pass']}, safety={gate_payload['safety_pass']}"
        raise RuntimeError(f"严格门控未通过，已中止回归流程：{detail}")
    part_char = run_cli_json("stage2-generate-part(characters)", ["--session-state-file", str(state_file), "stage2-generate-part", "--part", "characters"])
    part_scene = run_cli_json("stage2-generate-part(scenes)", ["--session-state-file", str(state_file), "stage2-generate-part", "--part", "scenes"])
    run_cli_json("stage2-generate-part(storyboard)", ["--session-state-file", str(state_file), "stage2-generate-part", "--part", "storyboard"])
    shots_payload = run_cli_json(
        "stage2-generate-shots",
        [
            "--session-state-file",
            str(state_file),
            "stage2-generate-shots",
            "--max-shots",
            str(max_shots),
        ],
    )

    character_plan = part_char.get("stage2_plan", {}).get("characters", []) if isinstance(part_char, dict) else []
    scene_plan = part_scene.get("stage2_plan", {}).get("scenes", []) if isinstance(part_scene, dict) else []
    default_face_name = str(args.face_name or (character_plan[0].get("name") if character_plan else "")).strip()
    default_scene_name = str(args.scene_name or (scene_plan[0].get("name") if scene_plan else "")).strip()
    face_ref_payload = {}
    if str(args.face_ref_file or "").strip() and default_face_name:
        face_ref_payload = run_cli_json(
            "asset-add(face)",
            [
                "asset-add",
                "--state-file",
                str(state_file),
                "--kind",
                "face",
                "--name",
                default_face_name,
                "--file",
                str(Path(args.face_ref_file).expanduser().resolve()),
            ],
        )
    scene_ref_payload = {}
    if str(args.scene_ref_file or "").strip() and default_scene_name:
        scene_ref_payload = run_cli_json(
            "asset-add(scene)",
            [
                "asset-add",
                "--state-file",
                str(state_file),
                "--kind",
                "scene",
                "--name",
                default_scene_name,
                "--file",
                str(Path(args.scene_ref_file).expanduser().resolve()),
            ],
        )
    scene_regen_payload = {}
    if default_scene_name:
        scene_regen_payload = run_cli_json(
            "stage2-generate-item(scene)",
            [
                "stage2-generate-item",
                "--state-file",
                str(state_file),
                "--kind",
                "scene",
                "--name",
                default_scene_name,
                "--mode",
                str(args.scene_mode or "master"),
                "--size",
                size,
                "--style",
                str(args.scene_style or "回归锚点验证"),
            ],
        )

    shots = shots_payload.get("shots", []) if isinstance(shots_payload, dict) else []
    shot_ids = [str(item.get("shot_id", "")).strip() for item in shots if isinstance(item, dict) and str(item.get("shot_id", "")).strip()]
    render_results = []
    for shot_id in shot_ids:
        render_payload = run_cli_json(
            f"render-shot({shot_id})",
            [
                "--session-state-file",
                str(state_file),
                "render-shot",
                "--shot-id",
                shot_id,
                "--poll",
                "--interval",
                "5",
                "--timeout",
                str(max(120, int(getattr(args, "render_timeout", 360) or 360))),
                "--download-dir",
                str(download_dir),
                "--approve",
            ],
        )
        render_results.append(render_payload.get("result", {}))
    if shot_ids:
        run_cli_json(
            "approve-shots",
            [
                "approve-shots",
                "--state-file",
                str(state_file),
                "--shot-ids",
                ",".join(shot_ids),
                "--replace",
            ],
        )
    merge_payload = run_cli_json(
        "merge-approved",
        [
            "merge-approved",
            "--state-file",
            str(state_file),
            "--download-dir",
            str(download_dir),
            "--output",
            str(output_file),
        ],
    )
    status_payload = run_cli_json("session-state", ["--session-state-file", str(state_file), "session-state"])
    output_payload(
        args,
        {
            "ok": True,
            "state_file": str(state_file),
            "project_init": init_payload,
            "quality": quality_payload,
            "shortvideo_audit": short_audit_payload,
            "safety_audit": safety_payload,
            "gate": gate_payload,
            "face_reference": face_ref_payload,
            "scene_reference": scene_ref_payload,
            "scene_regenerated": scene_regen_payload.get("generated", {}),
            "rendered_shots": render_results,
            "merged_file": str(merge_payload.get("output_file", output_file)),
            "status": status_payload.get("status", {}),
        },
    )


def cmd_tasks_list(args):
    retry_opts = resolve_retry_options(args)
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    tasks = state.get("render_tasks", []) if isinstance(state.get("render_tasks"), list) else []
    results = state.get("render_results", []) if isinstance(state.get("render_results"), list) else []
    results_map = {str(x.get("shot_id", "")): x for x in results if isinstance(x, dict)}
    rows = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        shot_id = str(t.get("shot_id", ""))
        if str(getattr(args, "shot_id", "") or "").strip() and shot_id != str(args.shot_id).strip():
            continue
        rec = results_map.get(shot_id, {})
        rows.append(
            {
                "shot_id": shot_id,
                "task_id": str(t.get("task_id", "")),
                "provider": str(t.get("provider", "ark")),
                "video_model": str(t.get("video_model", "")),
                "duration_sec": t.get("duration_sec", 0),
                "request_mode": str(t.get("request_mode", "")),
                "image_ref_count": int(t.get("image_ref_count", 0) or 0),
                "has_face_ref": bool(t.get("has_face_ref", False)),
                "has_scene_ref": bool(t.get("has_scene_ref", False)),
                "constraints_applied": bool(t.get("constraints_applied", False)),
                "status_url": str(t.get("status_url", "")),
                "response_url": str(t.get("response_url", "")),
                "status": str(rec.get("status", "")),
                "video_url": str(rec.get("video_url", "")),
                "local_file": str(rec.get("local_file", "")),
                "download_error": str(rec.get("download_error", "")),
            }
        )
    if args.refresh and rows:
        fal_backend: Dict[str, Any] = {}
        if any(str(r.get("provider", "ark")).lower() == "fal" for r in rows):
            cfg = ensure_setup(default_config_path(), interactive=False)
            fal_backend = {
                "api_key": get_setting("FAL_API_KEY", cfg, "").strip(),
                "base_url": get_setting("FAL_BASE_URL", cfg, "https://queue.fal.run").strip() or "https://queue.fal.run",
                "video_model": get_setting("FAL_VIDEO_MODEL", cfg, "").strip(),
            }
            if not fal_backend["api_key"]:
                raise RuntimeError("缺少 FAL_API_KEY，无法刷新 fal 任务")
        ark_client = None
        if any(str(r.get("provider", "ark")).lower() != "fal" for r in rows):
            ark_client, _, _, _ = ensure_client()
        deadline = time.time() + max(1, int(getattr(args, "timeout", 0) or 0))
        for row in rows:
            task_id = row.get("task_id", "")
            status_value = str(row.get("status", ""))
            video_url = str(row.get("video_url", ""))
            local_file = str(row.get("local_file", ""))
            should_query = bool(task_id) and (not video_url or (getattr(args, "poll", False) and not local_file))
            if should_query:
                if str(row.get("provider", "ark")).lower() == "fal":
                    poll_result = fal_poll_video_result(
                        api_key=str(fal_backend.get("api_key", "")),
                        base_url=str(fal_backend.get("base_url", "https://queue.fal.run")),
                        video_model=str(row.get("video_model", "") or fal_backend.get("video_model", "")),
                        request_id=str(task_id),
                        interval=max(1, int(getattr(args, "interval", 3) or 3)),
                        timeout=max(1, int(deadline - time.time())),
                        status_url=str(row.get("status_url", "")),
                        response_url=str(row.get("response_url", "")),
                        retry_count=int(retry_opts["retry_count"]),
                        retry_wait=float(retry_opts["retry_wait"]),
                    )
                    status_value = str(poll_result.get("status", ""))
                    video_url = str(poll_result.get("video_url", "")) or video_url
                else:
                    while True:
                        body = to_dict(ark_client.content_generation.tasks.get(task_id=task_id))
                        status_value = str(body.get("status", ""))
                        video_url = extract_video_url_from_payload(body) or video_url
                        if video_url:
                            break
                        if status_value.lower() in {"failed", "error"}:
                            break
                        if not getattr(args, "poll", False):
                            break
                        if time.time() >= deadline:
                            break
                        time.sleep(max(1, int(getattr(args, "interval", 3) or 3)))
                row["status"] = status_value
                row["video_url"] = video_url
            if row.get("video_url") and str(getattr(args, "download_dir", "") or "").strip():
                download_dir = Path(str(args.download_dir).strip())
                if not download_dir.is_absolute() and str(state.get("project_root", "")).strip():
                    download_dir = project_path(state, f"renders/{args.download_dir}")
                download_dir.mkdir(parents=True, exist_ok=True)
                shot_safe = str(row.get("shot_id", "shot")).replace("/", "_")
                out_file = download_dir / f"{shot_safe}.mp4"
                try:
                    resp = requests.get(row["video_url"], timeout=180)
                    resp.raise_for_status()
                    out_file.write_bytes(resp.content)
                    row["local_file"] = str(out_file)
                    row["download_error"] = ""
                except Exception:
                    row["download_error"] = "下载失败，可能链接已过期或防盗链"
        for row in rows:
            shot_id = row.get("shot_id", "")
            state["render_results"] = [x for x in state.get("render_results", []) if str(x.get("shot_id", "")) != shot_id]
            state["render_results"].append(
                {
                    "shot_id": shot_id,
                    "task_id": row.get("task_id", ""),
                    "provider": row.get("provider", "ark"),
                    "video_model": row.get("video_model", ""),
                    "status": row.get("status", ""),
                    "video_url": row.get("video_url", ""),
                    "local_file": row.get("local_file", ""),
                    "download_error": row.get("download_error", ""),
                }
            )
        save_state(state_path, state)
    output_payload(args, {"ok": True, "state_file": str(state_path), "retry": retry_opts, "tasks": rows, "count": len(rows)})


def cmd_session_start(args):
    config_path = Path(args.config_file) if args.config_file else default_config_path()
    ensure_setup(config_path, interactive=not args.no_prompt)
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    if not state.get("session_id"):
        state["session_id"] = str(uuid.uuid4())
    state["session_status"] = "active"
    set_workflow(state, "session_active", "session-step")
    save_state(state_path, state)
    append_event("session_start", {"state_file": str(state_path), "session_id": state["session_id"]})
    output_payload(args, {"ok": True, "session_id": state["session_id"], "state_file": str(state_path)})


def cmd_session_step(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    client, text_model, _, _ = ensure_client()
    user_text = read_text_input(args.input_file) if args.input_file else args.input
    if not user_text.strip():
        raise RuntimeError("输入为空")
    if not state.get("story"):
        title = args.title.strip() if args.title else "未命名短片"
        state["title"] = title
        state["story"] = user_text
        beat_prompt = "把剧本拆成4-6个节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。\n剧本：" + user_text
        beats = extract_json(chat(client, text_model, beat_prompt, temperature=0.5))
        state["beats"] = beats
        prep_prompt = (
            "根据剧本和节拍，提取第二阶段所需信息。"
            "输出JSON对象："
            "{\"characters\":[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}],"
            "\"scenes\":[{\"name\":\"\",\"description\":\"\",\"prompt\":\"\"}],"
            "\"storyboard_text\":[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"\",\"visual_hint\":\"\"}]}"
            + "\n剧本："
            + user_text
            + "\n节拍："
            + json.dumps(beats, ensure_ascii=False)
        )
        state["stage2_plan"] = normalize_stage2_plan(extract_json(chat(client, text_model, prep_prompt, temperature=0.35)))
        set_workflow(state, "script_ready", "先完善第二阶段细节，再执行 stage2-generate-assets")
        save_state(state_path, state)
        output_payload(
            args,
            {
                "ok": True,
                "step": "script_stage_ready",
                "state_file": str(state_path),
                "project": title,
                "beats": beats,
                "stage2_plan": state.get("stage2_plan", {}),
                "next_action": "第二步请确认人物素材、场景素材与分镜文本，再执行 stage2-generate-assets",
            },
        )
        return
    target = "shots"
    if any(k in user_text for k in ["节拍", "剧情", "故事结构"]):
        target = "beats"
    if target == "beats":
        current = state.get("beats", [])
        prompt = (
            "根据修订意见改写节拍，输出JSON数组[{\"id\":1,\"beat\":\"...\"}]。"
            + "\n当前节拍："
            + json.dumps(current, ensure_ascii=False)
            + "\n修订意见："
            + user_text
        )
        updated = extract_json(chat(client, text_model, prompt, temperature=0.45))
        state["beats"] = updated
        set_workflow(state, "beats_revised", "可继续 revise beats 或重做 shots")
        save_state(state_path, state)
        output_payload(args, {"ok": True, "step": "revise_beats", "state_file": str(state_path), "beats": updated, "next_action": "如需同步分镜，请继续输入：根据新节拍重做分镜"})
        return
    current = state.get("shots", [])
    prompt = (
        "根据修订意见改写分镜，输出JSON数组，结构[{\"shot_id\":\"S01\",\"duration_sec\":5,\"subtitle\":\"...\",\"visual_prompt\":\"英文提示词\"}]。"
        + "\n当前分镜："
        + json.dumps(current, ensure_ascii=False)
        + "\n修订意见："
        + user_text
    )
    updated = extract_json(chat(client, text_model, prompt, temperature=0.35))
    state["shots"] = updated
    set_workflow(state, "shots_revised", "render-shot / render-shots")
    save_state(state_path, state)
    output_payload(args, {"ok": True, "step": "revise_shots", "state_file": str(state_path), "shots": updated, "next_action": "如确认无误，可执行 render-shots"})


def cmd_session_state(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    output_payload(args, {"ok": True, "state_file": str(state_path), "state": state, "status": compute_status(state)})


def cmd_session_close(args):
    state_path = Path(args.state_file) if args.state_file else default_state_path()
    state = normalize_state(load_state(state_path))
    state["session_status"] = "closed"
    set_workflow(state, "closed", "无")
    save_state(state_path, state)
    append_event("session_close", {"state_file": str(state_path)})
    output_payload(args, {"ok": True, "state_file": str(state_path), "session_status": "closed"})


def cmd_chat(args):
    config_path = Path(args.config_file) if args.config_file else default_config_path()
    ensure_setup(config_path, interactive=True)
    resolved = resolve_state_file(args.state_file, config_path)
    state_path = Path(resolved) if resolved else default_state_path()
    if not state_path.exists():
        cmd_session_start(argparse.Namespace(json=False, state_file=str(state_path), config_file=str(config_path), no_prompt=True))
    print("┌──────────────────────────────────────────────┐")
    print("│ OpenVShot CLI (v1.0)                         │")
    print("│ mode: interactive-session                    │")
    print(f"│ state: {str(state_path)[:34]:<34} │")
    print("└──────────────────────────────────────────────┘")
    print("输入 exit 退出，state 查看状态，menu 查看快捷键。")
    print("也支持 --exit / --state / --menu / --continue。")
    while True:
        user_text = input("\n你: ").strip()
        if not user_text:
            continue
        key = user_text.strip().lower()
        key = key[1:] if key.startswith("/") else key
        if key in {"exit", "quit", "--exit", "--quit"}:
            print("会话结束。")
            break
        if key in {"menu", "--menu", "help", "--help"}:
            print("快捷键: state(状态) continue(下一步建议) exit(退出)")
            continue
        if key in {"state", "--state"}:
            cmd_session_state(argparse.Namespace(json=False, state_file=str(state_path)))
            continue
        if key in {"continue", "--continue", "next", "--next"}:
            st = normalize_state(load_state(Path(state_path)))
            s = compute_status(st)
            print(json.dumps({"project": st.get("title", ""), "stage": s.get("stage", ""), "next_action": s.get("next_action", "")}, ensure_ascii=False, indent=2))
            continue
        cmd_session_step(
            argparse.Namespace(
                json=False,
                state_file=str(state_path),
                input=user_text,
                input_file="",
                title="短片",
            )
        )


def cmd_prompt_suggest(args):
    client, text_model, _, _ = ensure_client()
    kind = str(args.kind or "generic").strip().lower()
    source_text = str(args.text or "").strip()
    context_text = str(args.context or "").strip()
    if not source_text:
        raise RuntimeError("请提供 --text 作为原始输入")
    kind_guide = {
        "script": "把一句话想法扩展为可拍摄短剧剧本，包含场景、动作、对白和情绪推进。",
        "script_refine": "在不改变核心剧情的前提下优化剧本表达，让动作更可拍、对白更自然。",
        "stage2_instruction": "输出用于第二步提取角色/场景/分镜的明确编辑指令。",
        "character_prompt": "输出角色素材生成Prompt，要求外观、服装、姿态、镜头、光线完整具体。",
        "scene_prompt": "输出场景素材生成Prompt，要求空间结构、时间、机位、光线、材质完整具体。",
        "storyboard_hint": "输出分镜画面提示，要求动作分解、景别、机位、光线、道具、连续性清晰。",
        "shot_instruction": "输出镜头修订意见，聚焦动作连贯、角色真实感、转场平滑。",
        "generic": "输出可直接用于生成任务的高质量Prompt。",
    }
    guide_text = kind_guide.get(kind, kind_guide["generic"])
    active_video_model = get_active_video_model_name()
    seedance_hint = ""
    if is_seedance_model(active_video_model) and kind in {"storyboard_hint", "generic"}:
        seedance_hint = (
            "\n当前视频模型包含Seedance：请按Subject、Action、Camera、Style、Quality五模块组织提示词；"
            "Action仅保留一个主动作；Style使用组合描述并包含稳定风格锚点；"
            "Quality结尾补上“4K, Ultra HD, Sharp clarity”；"
            "若是文生视频控制在120-280个英文词，若有参考图则控制在50-80个英文词；"
            "禁止输出任何否定提示词。"
        )
    prompt = (
        "你是影视AI提示词编辑助手。"
        "请基于用户输入补全为可直接提交生成的提示词文本。"
        "输出要求：只输出最终提示词正文，不要解释，不要编号，不要Markdown。"
        "文本需具体、可执行、避免空话；动作要分解且自然，禁止假人感与扭曲动作。"
        f"\n任务类型：{kind}\n任务目标：{guide_text}"
        f"{seedance_hint}"
        f"\n上下文：{context_text or '无'}"
        f"\n原始输入：{source_text}"
    )
    suggestion = chat(client, text_model, prompt, temperature=0.45, max_tokens=1200).strip()
    output_payload(
        args,
        {
            "ok": True,
            "kind": kind,
            "input": source_text,
            "context": context_text,
            "suggestion": suggestion,
        },
    )


def cmd_fal_workflow(args):
    cfg = ensure_setup(default_config_path(), interactive=False)
    api_key = str(args.fal_api_key or "").strip() or get_setting("FAL_API_KEY", cfg, "").strip()
    base_url = str(args.fal_base_url or "").strip() or get_setting("FAL_BASE_URL", cfg, "https://queue.fal.run").strip()
    endpoint = str(args.endpoint or "").strip().lstrip("/")
    if not api_key:
        raise RuntimeError("缺少 FAL_API_KEY")
    if not endpoint:
        raise RuntimeError("缺少 --endpoint")
    input_obj = read_json_object_arg(str(args.input_json or ""), str(args.input_file or ""))
    headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}
    submit_url = f"{base_url.rstrip('/')}/{endpoint}"
    retry_opts = resolve_retry_options(args)
    def execute_once(local_retry_opts: Dict[str, Any]) -> Dict[str, Any]:
        retry_count = int(local_retry_opts.get("retry_count", 2) or 2)
        retry_wait = float(local_retry_opts.get("retry_wait", 1.5) or 1.5)
        max_attempts = max(1, retry_count + 1)
        submit_resp = None
        submit_error = ""
        for attempt in range(max_attempts):
            try:
                submit_resp = requests.post(submit_url, headers=headers, json=input_obj, timeout=60)
                if submit_resp.status_code < 500 and submit_resp.status_code != 429:
                    break
                submit_error = f"HTTP {submit_resp.status_code} {submit_resp.text[:300]}"
            except requests.RequestException as exc:
                submit_error = str(exc)
            if attempt < max_attempts - 1:
                time.sleep(max(0.2, retry_wait) * (attempt + 1))
        if submit_resp is None:
            raise RuntimeError(f"fal workflow 提交失败: {submit_error or '无响应'}")
        if submit_resp.status_code >= 400:
            fallback = None
            fallback_error = ""
            for attempt in range(max_attempts):
                try:
                    fallback = requests.post(submit_url, headers=headers, json={"input": input_obj}, timeout=60)
                    if fallback.status_code < 500 and fallback.status_code != 429:
                        break
                    fallback_error = f"HTTP {fallback.status_code} {fallback.text[:300]}"
                except requests.RequestException as exc:
                    fallback_error = str(exc)
                if attempt < max_attempts - 1:
                    time.sleep(max(0.2, retry_wait) * (attempt + 1))
            if fallback is None:
                raise RuntimeError(f"fal workflow 提交失败: {fallback_error or '无响应'}")
            if fallback.status_code >= 400:
                raise RuntimeError(f"fal workflow 提交失败: HTTP {fallback.status_code} {fallback.text[:300]}")
            submit_resp = fallback
        submit_body = submit_resp.json()
        request_id = str(submit_body.get("request_id", "")).strip()
        if not request_id:
            raise RuntimeError("fal workflow 返回缺少 request_id")
        out: Dict[str, Any] = {
            "ok": True,
            "provider": "fal",
            "endpoint": endpoint,
            "retry_profile": local_retry_opts.get("retry_profile", "stable"),
            "request_id": request_id,
            "status_url": str(submit_body.get("status_url", "")).strip(),
            "response_url": str(submit_body.get("response_url", "")).strip(),
            "queue_position": submit_body.get("queue_position", None),
        }
        if args.poll:
            polled = fal_poll_request(
                api_key=api_key,
                base_url=base_url,
                endpoint=endpoint,
                request_id=request_id,
                interval=args.interval,
                timeout=args.timeout,
                status_url=out.get("status_url", ""),
                response_url=out.get("response_url", ""),
                retry_count=retry_count,
                retry_wait=retry_wait,
            )
            out["status"] = polled.get("status", "")
            out["video_url"] = polled.get("video_url", "")
            out["payload"] = polled.get("payload", {})
            out["status_payload"] = polled.get("status_payload", {})
        return out
    fallback_applied = False
    first_error_text = ""
    try:
        out = execute_once(retry_opts)
    except Exception as first_error:
        if str(retry_opts.get("requested_retry_profile", "stable")) == "auto" and str(retry_opts.get("retry_profile", "stable")) != "aggressive":
            fallback_applied = True
            first_error_text = str(first_error)
            retry_opts = {"requested_retry_profile": "auto", "retry_profile": "aggressive", "retry_count": 4, "retry_wait": 0.8}
            out = execute_once(retry_opts)
        else:
            raise first_error
    out["retry_fallback_applied"] = fallback_applied
    if first_error_text:
        out["retry_first_error"] = first_error_text[:600]
    append_event(
        "fal_workflow_call",
        {
            "endpoint": endpoint,
            "request_id": out.get("request_id", ""),
            "retry_profile": out.get("retry_profile", "stable"),
            "retry_fallback_applied": bool(fallback_applied),
            "retry_first_error": first_error_text[:300] if first_error_text else "",
            "poll": bool(args.poll),
            "status": str(out.get("status", "")),
        },
    )
    output_payload(args, out)


def cmd_fal_workflow_list(args):
    source = str(getattr(args, "source", "") or "api").strip().lower()
    limit = int(getattr(args, "limit", 0) or 0)
    category_filter = str(getattr(args, "category", "") or "").strip()
    query_filter = str(getattr(args, "query", "") or "").strip()
    if source == "api":
        cfg = ensure_setup(default_config_path(), interactive=False)
        api_base = str(getattr(args, "api_base", "") or "https://api.fal.ai/v1").strip().rstrip("/")
        api_key = str(getattr(args, "fal_api_key", "") or "").strip() or get_setting("FAL_API_KEY", cfg, "").strip()
        retry_opts = resolve_retry_options(args)
        fallback_applied = False
        first_error_text = ""
        try:
            model_data = fetch_fal_models(
                api_base=api_base,
                api_key=api_key,
                query=query_filter,
                category=category_filter,
                page_size=int(getattr(args, "page_size", 100) or 100),
                max_pages=int(getattr(args, "max_pages", 10) or 10),
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
        except Exception as first_error:
            if str(retry_opts.get("requested_retry_profile", "stable")) == "auto" and str(retry_opts.get("retry_profile", "stable")) != "aggressive":
                fallback_applied = True
                first_error_text = str(first_error)
                retry_opts = {"requested_retry_profile": "auto", "retry_profile": "aggressive", "retry_count": 4, "retry_wait": 0.8}
                model_data = fetch_fal_models(
                    api_base=api_base,
                    api_key=api_key,
                    query=query_filter,
                    category=category_filter,
                    page_size=int(getattr(args, "page_size", 100) or 100),
                    max_pages=int(getattr(args, "max_pages", 10) or 10),
                    retry_count=int(retry_opts["retry_count"]),
                    retry_wait=float(retry_opts["retry_wait"]),
                )
            else:
                raise first_error
        models = model_data.get("models", [])
        next_cursor = str(model_data.get("next_cursor", "") or "")
        has_more = bool(model_data.get("has_more", False))
        workflow_models: List[Dict[str, Any]] = []
        for item in models:
            if not isinstance(item, dict):
                continue
            endpoint_id = str(item.get("endpoint_id", "")).strip()
            if not endpoint_id:
                continue
            if endpoint_id.startswith("workflows/") or "/workflow-utilities/" in endpoint_id:
                workflow_models.append(item)
        if limit > 0:
            workflow_models = workflow_models[:limit]
        endpoints = [str(item.get("endpoint_id", "")).strip() for item in workflow_models]
        append_event(
            "fal_workflow_list",
            {
                "source": "api",
                "query": query_filter,
                "category": category_filter,
                "count": len(endpoints),
                "retry_profile": retry_opts.get("retry_profile", "stable"),
                "retry_fallback_applied": bool(fallback_applied),
                "retry_first_error": first_error_text[:300] if first_error_text else "",
            },
        )
        output_payload(
            args,
            {
                "ok": True,
                "source": "api",
                "retry_profile": retry_opts.get("retry_profile", "stable"),
                "retry_fallback_applied": fallback_applied,
                "retry_first_error": first_error_text[:600] if first_error_text else "",
                "api_base": api_base,
                "count": len(endpoints),
                "endpoints": endpoints,
                "models": workflow_models,
                "next_cursor": next_cursor or None,
                "has_more": has_more,
            },
        )
        return
    sitemap_url = str(getattr(args, "sitemap_url", "") or "https://fal.ai/sitemap-0.xml").strip()
    response = requests.get(sitemap_url, timeout=60)
    if response.status_code >= 400:
        raise RuntimeError(f"获取 fal sitemap 失败: HTTP {response.status_code}")
    text = str(response.text or "")
    pattern = r"https://fal.ai/models/fal-ai/workflow-utilities/([a-z0-9\\-]+)/api"
    names = sorted(set(m.group(1) for m in re.finditer(pattern, text, flags=re.IGNORECASE)))
    endpoints = [f"workflows/fal-ai/workflow-utilities/{name}" for name in names]
    limit = int(getattr(args, "limit", 0) or 0)
    if limit > 0:
        endpoints = endpoints[:limit]
    output_payload(
        args,
        {
            "ok": True,
            "source": sitemap_url,
            "count": len(endpoints),
            "endpoints": endpoints,
            "api_pages": [f"https://fal.ai/models/fal-ai/workflow-utilities/{name}/api" for name in names[: len(endpoints)]],
        },
    )


def fetch_fal_models(
    api_base: str,
    api_key: str,
    query: str = "",
    category: str = "",
    page_size: int = 100,
    max_pages: int = 10,
    retry_count: int = 2,
    retry_wait: float = 1.5,
) -> Dict[str, Any]:
    headers = {"Authorization": f"Key {api_key}"} if str(api_key or "").strip() else {}
    base = str(api_base or "https://api.fal.ai/v1").strip().rstrip("/")
    params: Dict[str, Any] = {"limit": max(1, min(200, int(page_size or 100)))}
    if str(query or "").strip():
        params["q"] = str(query).strip()
    if str(category or "").strip():
        params["category"] = str(category).strip()
    all_models: List[Dict[str, Any]] = []
    next_cursor = ""
    has_more = False
    for _ in range(max(1, min(100, int(max_pages or 10)))):
        page_params = dict(params)
        if next_cursor:
            page_params["cursor"] = next_cursor
        response = None
        error_text = ""
        max_attempts = max(1, int(retry_count or 0) + 1)
        for attempt in range(max_attempts):
            try:
                response = requests.get(f"{base}/models", headers=headers, params=page_params, timeout=60)
                if response.status_code < 500:
                    break
                error_text = f"HTTP {response.status_code} {response.text[:300]}"
            except requests.RequestException as exc:
                error_text = str(exc)
            if attempt < max_attempts - 1:
                time.sleep(max(0.2, float(retry_wait or 0.2)) * (attempt + 1))
        if response is None:
            raise RuntimeError(f"获取 fal models 失败: {error_text or '无响应'}")
        if response.status_code >= 400:
            raise RuntimeError(f"获取 fal models 失败: HTTP {response.status_code} {response.text[:300]}")
        body = response.json()
        page_models = body.get("models", []) if isinstance(body, dict) else []
        if isinstance(page_models, list):
            all_models.extend([x for x in page_models if isinstance(x, dict)])
        next_cursor = str(body.get("next_cursor", "")).strip() if isinstance(body, dict) else ""
        has_more = bool(body.get("has_more", False)) if isinstance(body, dict) else False
        if not has_more or not next_cursor:
            break
    return {"models": all_models, "next_cursor": next_cursor or None, "has_more": has_more}


def cmd_fal_shortdrama_auto(args):
    cfg = ensure_setup(default_config_path(), interactive=False)
    preset_name = str(getattr(args, "preset", "") or "").strip().lower()
    preset_map: Dict[str, Dict[str, Any]] = {
        "shortdrama-cn": {
            "query": "video text-to-video cinematic drama",
            "exclude_pattern": "workflow-utilities|audio|image-to-image|image-to-video",
            "allowed_status": "active",
            "require_commercial": True,
        },
        "shortdrama-global": {
            "query": "video text-to-video",
            "exclude_pattern": "workflow-utilities|audio|image-to-image|image-to-video",
            "allowed_status": "active",
            "require_commercial": True,
        },
        "shortdrama-cost": {
            "query": "video text-to-video fast turbo",
            "exclude_pattern": "workflow-utilities|audio|image-to-image|image-to-video|pro|max|ultra",
            "allowed_status": "active",
            "require_commercial": True,
            "priority_keywords": ["text-to-video", "fast", "turbo", "lite", "standard", "video"],
        },
        "shortdrama-quality": {
            "query": "video text-to-video cinematic pro quality",
            "exclude_pattern": "workflow-utilities|audio|image-to-image|image-to-video",
            "allowed_status": "active",
            "require_commercial": True,
            "priority_keywords": ["text-to-video", "pro", "master", "quality", "cinematic", "seedance", "kling", "video"],
        },
    }
    preset = preset_map.get(preset_name, {})
    api_key = str(args.fal_api_key or "").strip() or get_setting("FAL_API_KEY", cfg, "").strip()
    api_base = str(args.api_base or "").strip() or "https://api.fal.ai/v1"
    if not api_key:
        raise RuntimeError("缺少 FAL_API_KEY")
    query_value = str(args.query or "").strip() or str(preset.get("query", "video")).strip()
    category_value = str(args.category or "").strip()
    include_pattern_text = str(getattr(args, "include_pattern", "") or "").strip()
    if not include_pattern_text:
        include_pattern_text = str(preset.get("include_pattern", "")).strip()
    exclude_pattern_text = str(getattr(args, "exclude_pattern", "") or "").strip()
    if not exclude_pattern_text:
        exclude_pattern_text = str(preset.get("exclude_pattern", "workflow-utilities")).strip()
    allowed_status_text = str(getattr(args, "allowed_status", "") or "").strip()
    if not allowed_status_text:
        allowed_status_text = str(preset.get("allowed_status", "active")).strip()
    require_commercial = bool(getattr(args, "require_commercial", False))
    if not require_commercial and bool(preset.get("require_commercial", False)):
        require_commercial = True
    retry_opts = resolve_retry_options(args)
    fallback_applied = False
    first_error_text = ""
    try:
        model_data = fetch_fal_models(
            api_base=api_base,
            api_key=api_key,
            query=query_value,
            category=category_value,
            page_size=int(args.page_size or 100),
            max_pages=int(args.max_pages or 10),
            retry_count=int(retry_opts["retry_count"]),
            retry_wait=float(retry_opts["retry_wait"]),
        )
    except Exception as first_error:
        if str(retry_opts.get("requested_retry_profile", "stable")) == "auto" and str(retry_opts.get("retry_profile", "stable")) != "aggressive":
            fallback_applied = True
            first_error_text = str(first_error)
            retry_opts = {"requested_retry_profile": "auto", "retry_profile": "aggressive", "retry_count": 4, "retry_wait": 0.8}
            model_data = fetch_fal_models(
                api_base=api_base,
                api_key=api_key,
                query=query_value,
                category=category_value,
                page_size=int(args.page_size or 100),
                max_pages=int(args.max_pages or 10),
                retry_count=int(retry_opts["retry_count"]),
                retry_wait=float(retry_opts["retry_wait"]),
            )
        else:
            raise first_error
    models = model_data.get("models", [])
    include_pattern = re.compile(include_pattern_text, flags=re.IGNORECASE) if include_pattern_text else None
    exclude_pattern = re.compile(exclude_pattern_text, flags=re.IGNORECASE) if exclude_pattern_text else None
    allowed_status = {x.strip().lower() for x in allowed_status_text.split(",") if x.strip()}
    candidates: List[Dict[str, Any]] = []
    text_to_video_candidates: List[Dict[str, Any]] = []
    for item in models:
        endpoint_id = str(item.get("endpoint_id", "")).strip()
        meta = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
        category = str(meta.get("category", "")).strip().lower()
        status = str(meta.get("status", "")).strip().lower()
        license_type = str(meta.get("license_type", "")).strip().lower()
        if not endpoint_id:
            continue
        if allowed_status and status not in allowed_status:
            continue
        if require_commercial and license_type not in {"commercial", "enterprise"}:
            continue
        if include_pattern and not include_pattern.search(endpoint_id):
            continue
        if exclude_pattern and exclude_pattern.search(endpoint_id):
            continue
        if category in {"text-to-video", "image-to-video", "video-to-video"} or "video" in endpoint_id:
            candidates.append(item)
            endpoint_lower = endpoint_id.lower()
            if category == "text-to-video" or "text-to-video" in endpoint_lower:
                text_to_video_candidates.append(item)
    if not candidates:
        raise RuntimeError("未找到可用于短剧生成的视频模型")
    shortlist = text_to_video_candidates if text_to_video_candidates else candidates
    compact = []
    for item in shortlist[:40]:
        endpoint_id = str(item.get("endpoint_id", "")).strip()
        meta = item.get("metadata", {}) if isinstance(item.get("metadata", {}), dict) else {}
        compact.append(
            {
                "endpoint_id": endpoint_id,
                "category": str(meta.get("category", "")),
                "description": str(meta.get("description", "")),
                "tags": meta.get("tags", []) if isinstance(meta.get("tags", []), list) else [],
            }
        )
    selected_endpoint = ""
    selected_reason = ""
    try:
        client, text_model, _, _ = ensure_client()
        choose_prompt = (
            "你是视频模型选型导演。目标：短剧剧情视频，强调人物一致性、动作自然、叙事稳定。"
            "优先 text-to-video；避免 image-to-video（因为当前输入通常没有起始图）。"
            "从候选中只选1个最适合的 endpoint_id，输出JSON："
            "{\"endpoint_id\":\"...\",\"reason\":\"...\"}。"
            f"\n候选：{json.dumps(compact, ensure_ascii=False)}"
        )
        selected = extract_json(chat(client, text_model, choose_prompt, temperature=0.2, max_tokens=500))
        if isinstance(selected, dict):
            selected_endpoint = str(selected.get("endpoint_id", "")).strip()
            selected_reason = str(selected.get("reason", "")).strip()
    except Exception:
        selected_endpoint = ""
    allowed_endpoints = {str(x.get("endpoint_id", "")).strip() for x in compact}
    if selected_endpoint and selected_endpoint not in allowed_endpoints:
        selected_endpoint = ""
    if not selected_endpoint:
        preset_priority = preset.get("priority_keywords", [])
        priority = [str(x).strip().lower() for x in preset_priority if str(x).strip()] or ["text-to-video", "seedance", "kling", "hunyuan", "minimax", "wan", "video"]
        ranked = sorted(
            compact,
            key=lambda m: (
                0 if ("text-to-video" in m["endpoint_id"].lower() or str(m.get("category", "")).lower() == "text-to-video") else 1,
                min([m["endpoint_id"].lower().find(k) if k in m["endpoint_id"].lower() else 9999 for k in priority]),
            ),
        )
        selected_endpoint = str(ranked[0].get("endpoint_id", ""))
        selected_reason = "按视频短剧优先级规则自动选择"
    rank_keywords = [str(x).strip().lower() for x in preset.get("priority_keywords", []) if str(x).strip()] or ["text-to-video", "seedance", "kling", "hunyuan", "minimax", "wan", "video"]
    ranked_candidates = sorted(
        compact,
        key=lambda m: (
            0 if ("text-to-video" in m["endpoint_id"].lower() or str(m.get("category", "")).lower() == "text-to-video") else 1,
            min([m["endpoint_id"].lower().find(k) if k in m["endpoint_id"].lower() else 9999 for k in rank_keywords]),
        ),
    )
    config_file = str(args.config_file or "").strip()
    config_path = Path(config_file) if config_file else default_config_path()
    config_data = ensure_setup(config_path, interactive=False)
    config_data["VIDEO_PROVIDER"] = "fal"
    config_data["FAL_VIDEO_MODEL"] = selected_endpoint
    config_data["FAL_BASE_URL"] = str(args.fal_base_url or "").strip() or get_setting("FAL_BASE_URL", config_data, "https://queue.fal.run")
    if getattr(args, "save_fal_key", False):
        config_data["FAL_API_KEY"] = api_key
    save_config(config_path, config_data)
    run_payload: Dict[str, Any] = {}
    if getattr(args, "run", False):
        run_ns = argparse.Namespace(
            json=True,
            title=str(args.title or "短剧"),
            story=str(args.story or ""),
            story_file=str(args.story_file or ""),
            seconds=int(args.seconds or 20),
            ratio=str(args.ratio or "9:16"),
            interval=int(args.interval or 8),
            timeout=int(args.timeout or 3600),
            download_dir=str(args.download_dir or "videos"),
            merge=bool(args.merge),
            merged_name=str(args.merged_name or "final_merged.mp4"),
            strict_multimodal=bool(getattr(args, "strict_multimodal", False)),
            state_file=str(args.state_file or ""),
            config_file=str(args.config_file or ""),
            retry_profile=str(getattr(args, "retry_profile", "") or ""),
            retry_count=getattr(args, "retry_count", None),
            retry_wait=getattr(args, "retry_wait", None),
            no_prompt=True,
        )
        cmd_run(run_ns)
        run_payload = {"triggered": True}
    output_payload(
        args,
        {
            "ok": True,
            "selected_endpoint": selected_endpoint,
            "reason": selected_reason,
            "candidates_count": len(candidates),
            "ranked_candidates": ranked_candidates[:10],
            "filters": {
                "preset": preset_name or "",
                "retry_profile": retry_opts.get("retry_profile", "stable"),
                "retry_fallback_applied": fallback_applied,
                "retry_first_error": first_error_text[:600] if first_error_text else "",
                "include_pattern": include_pattern_text,
                "exclude_pattern": exclude_pattern_text,
                "allowed_status": sorted(list(allowed_status)),
                "require_commercial": require_commercial,
            },
            "provider": "fal",
            "run": run_payload,
        },
    )
    append_event(
        "fal_shortdrama_auto",
        {
            "preset": preset_name or "",
            "selected_endpoint": selected_endpoint,
            "candidates_count": len(candidates),
            "retry_profile": retry_opts.get("retry_profile", "stable"),
            "retry_fallback_applied": bool(fallback_applied),
            "retry_first_error": first_error_text[:300] if first_error_text else "",
            "run_triggered": bool(getattr(args, "run", False)),
        },
    )


def cmd_journal_report(args):
    journal_file = str(getattr(args, "journal_file", "") or "").strip()
    journal_path = Path(journal_file) if journal_file else (openvshot_home() / "journal.jsonl")
    if not journal_path.exists():
        output_payload(
            args,
            {"ok": True, "journal_file": str(journal_path), "events_total": 0, "report": {}},
        )
        return
    lines = journal_path.read_text(encoding="utf-8").splitlines()
    tail_n = int(getattr(args, "tail", 0) or 0)
    if tail_n > 0 and tail_n < len(lines):
        lines = lines[-tail_n:]
    event_filter = str(getattr(args, "event", "") or "").strip().lower()
    entries: List[Dict[str, Any]] = []
    for line in lines:
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if not isinstance(rec, dict):
            continue
        event_name = str(rec.get("event", "")).strip()
        if event_filter and event_name.lower() != event_filter:
            continue
        entries.append(rec)
    total = len(entries)
    by_event: Dict[str, int] = {}
    retry_profiles: Dict[str, int] = {}
    fallback_count = 0
    error_samples: List[str] = []
    for rec in entries:
        event_name = str(rec.get("event", "")).strip()
        by_event[event_name] = int(by_event.get(event_name, 0)) + 1
        details = rec.get("details", {}) if isinstance(rec.get("details", {}), dict) else {}
        retry_profile = str(details.get("retry_profile", "")).strip()
        if retry_profile:
            retry_profiles[retry_profile] = int(retry_profiles.get(retry_profile, 0)) + 1
        if bool(details.get("retry_fallback_applied", False)):
            fallback_count += 1
        err = str(details.get("retry_first_error", "")).strip()
        if err:
            error_samples.append(err)
    fallback_rate = (float(fallback_count) / float(total)) if total else 0.0
    result_payload = {
        "ok": True,
        "journal_file": str(journal_path),
        "events_total": total,
        "by_event": by_event,
        "retry_profiles": retry_profiles,
        "retry_fallback_count": fallback_count,
        "retry_fallback_rate": round(fallback_rate, 4),
        "retry_error_samples": error_samples[:10],
    }
    out_format = str(getattr(args, "format", "") or "json").strip().lower()
    if out_format == "markdown":
        lines_md: List[str] = []
        lines_md.append("# Journal Report")
        lines_md.append("")
        lines_md.append(f"- journal_file: {str(journal_path)}")
        lines_md.append(f"- events_total: {total}")
        lines_md.append(f"- retry_fallback_count: {fallback_count}")
        lines_md.append(f"- retry_fallback_rate: {round(fallback_rate, 4)}")
        lines_md.append("")
        lines_md.append("## Events")
        lines_md.append("")
        lines_md.append("| event | count |")
        lines_md.append("|---|---:|")
        for name, cnt in sorted(by_event.items(), key=lambda kv: (-int(kv[1]), kv[0])):
            lines_md.append(f"| {name} | {int(cnt)} |")
        lines_md.append("")
        lines_md.append("## Retry Profiles")
        lines_md.append("")
        lines_md.append("| profile | count |")
        lines_md.append("|---|---:|")
        for name, cnt in sorted(retry_profiles.items(), key=lambda kv: (-int(kv[1]), kv[0])):
            lines_md.append(f"| {name} | {int(cnt)} |")
        if error_samples:
            lines_md.append("")
            lines_md.append("## Error Samples")
            lines_md.append("")
            for idx, err in enumerate(error_samples[:10], start=1):
                lines_md.append(f"{idx}. {err}")
        markdown_text = "\n".join(lines_md)
        if getattr(args, "json", False):
            output_payload(args, {**result_payload, "format": "markdown", "markdown": markdown_text})
            return
        print(markdown_text)
        return
    output_payload(args, result_payload)


def build_parser():
    parser = argparse.ArgumentParser(prog="vshot")
    parser.add_argument("--version", action="version", version=f"OpenVshot CLI {APP_VERSION}")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--session", default="")
    parser.add_argument("--session-title", default="短片")
    parser.add_argument("--session-state-file", default="")
    parser.add_argument("--session-config-file", default="")
    parser.add_argument("--session-no-prompt", action="store_true")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("start")
    st = sub.add_parser("setup")
    st.add_argument("--config-file", default="")

    cfs = sub.add_parser("config-set")
    cfs.add_argument("--config-file", default="")
    cfs.add_argument("--video-provider", default="")
    cfs.add_argument("--ark-api-key", default="")
    cfs.add_argument("--ark-base-url", default="")
    cfs.add_argument("--text-model", default="")
    cfs.add_argument("--image-model", default="")
    cfs.add_argument("--video-model", default="")
    cfs.add_argument("--audio-model", default="")
    cfs.add_argument("--tts-app-id", default="")
    cfs.add_argument("--tts-access-token", default="")
    cfs.add_argument("--tts-voice-type", default="")
    cfs.add_argument("--tts-base-url", default="")
    cfs.add_argument("--fal-api-key", default="")
    cfs.add_argument("--fal-base-url", default="")
    cfs.add_argument("--fal-video-model", default="")
    cfs.add_argument("--fal-image-model", default="")

    vm = sub.add_parser("volc-models")
    vm.add_argument("--config-file", default="")
    vm.add_argument("--ark-api-key", default="")
    vm.add_argument("--ark-base-url", default="")
    vm.add_argument("--save-credentials", action="store_true")
    vm.add_argument("--provider", default="all")
    vm.add_argument("--min-params-b", type=float, default=0.0)

    fw = sub.add_parser("fal-workflow")
    fw.add_argument("--endpoint", required=True)
    fw.add_argument("--input-json", default="")
    fw.add_argument("--input-file", default="")
    fw.add_argument("--poll", action="store_true")
    fw.add_argument("--interval", type=int, default=3)
    fw.add_argument("--timeout", type=int, default=600)
    fw.add_argument("--retry-profile", default="stable")
    fw.add_argument("--retry-count", type=int, default=None)
    fw.add_argument("--retry-wait", type=float, default=None)
    fw.add_argument("--fal-api-key", default="")
    fw.add_argument("--fal-base-url", default="")

    fwl = sub.add_parser("fal-workflow-list")
    fwl.add_argument("--source", default="api")
    fwl.add_argument("--api-base", default="https://api.fal.ai/v1")
    fwl.add_argument("--fal-api-key", default="")
    fwl.add_argument("--category", default="")
    fwl.add_argument("--query", default="")
    fwl.add_argument("--sitemap-url", default="https://fal.ai/sitemap-0.xml")
    fwl.add_argument("--page-size", type=int, default=100)
    fwl.add_argument("--max-pages", type=int, default=10)
    fwl.add_argument("--retry-profile", default="stable")
    fwl.add_argument("--retry-count", type=int, default=None)
    fwl.add_argument("--retry-wait", type=float, default=None)
    fwl.add_argument("--limit", type=int, default=0)

    fsa = sub.add_parser("fal-shortdrama-auto")
    fsa.add_argument("--story", default="")
    fsa.add_argument("--story-file", default="")
    fsa.add_argument("--title", default="短剧")
    fsa.add_argument("--seconds", type=int, default=20)
    fsa.add_argument("--ratio", default="9:16")
    fsa.add_argument("--interval", type=int, default=8)
    fsa.add_argument("--timeout", type=int, default=3600)
    fsa.add_argument("--download-dir", default="videos")
    fsa.add_argument("--merge", action="store_true")
    fsa.add_argument("--merged-name", default="final_merged.mp4")
    fsa.add_argument("--strict-multimodal", action="store_true")
    fsa.add_argument("--state-file", default="")
    fsa.add_argument("--config-file", default="")
    fsa.add_argument("--fal-api-key", default="")
    fsa.add_argument("--fal-base-url", default="")
    fsa.add_argument("--api-base", default="https://api.fal.ai/v1")
    fsa.add_argument("--preset", default="")
    fsa.add_argument("--query", default="video")
    fsa.add_argument("--category", default="")
    fsa.add_argument("--include-pattern", default="")
    fsa.add_argument("--exclude-pattern", default="workflow-utilities")
    fsa.add_argument("--allowed-status", default="active")
    fsa.add_argument("--require-commercial", action="store_true")
    fsa.add_argument("--page-size", type=int, default=100)
    fsa.add_argument("--max-pages", type=int, default=10)
    fsa.add_argument("--retry-profile", default="stable")
    fsa.add_argument("--retry-count", type=int, default=None)
    fsa.add_argument("--retry-wait", type=float, default=None)
    fsa.add_argument("--save-fal-key", action="store_true")
    fsa.add_argument("--run", action="store_true")

    pi = sub.add_parser("project-init")
    pi.add_argument("--name", default="")
    pi.add_argument("--root", default="")
    pi.add_argument("--state-file", default="")
    pi.add_argument("--project-type", default="short")
    pi.add_argument("--series-name", default="")
    pi.add_argument("--episode-index", type=int, default=1)
    pi.add_argument("--inherit-from-state", default="")

    pne = sub.add_parser("project-next-episode")
    pne.add_argument("--state-file", default="")
    pne.add_argument("--series-name", default="")
    pne.add_argument("--episode-index", type=int, default=2)

    pls = sub.add_parser("project-list")

    pus = sub.add_parser("project-use")
    pus.add_argument("--name", default="")
    pus.add_argument("--state-file", default="")

    pdl = sub.add_parser("project-delete")
    pdl.add_argument("--name", default="")
    pdl.add_argument("--state-file", default="")
    pdl.add_argument("--remove-files", action="store_true")
    pdl.add_argument("--force", action="store_true")

    pss = sub.add_parser("project-set-story")
    pss.add_argument("--state-file", default="")
    pss.add_argument("--title", default="")
    pss.add_argument("--story", default="")
    pss.add_argument("--input-file", default="")

    pop = sub.add_parser("project-open")
    pop.add_argument("--index", type=int, default=0)

    ctn = sub.add_parser("continue")
    ctn.add_argument("--open-chat", action="store_true")
    ctn.add_argument("--chat", action="store_true")

    pg = sub.add_parser("p")
    pg.add_argument("action", nargs="?", default="list")
    pg.add_argument("--name", default="")
    pg.add_argument("--root", default="")
    pg.add_argument("--state-file", default="")
    pg.add_argument("--index", type=int, default=0)
    pg.add_argument("--open-chat", action="store_true")
    pg.add_argument("--chat", action="store_true")
    pg.add_argument("--project-type", default="short")
    pg.add_argument("--series-name", default="")
    pg.add_argument("--episode-index", type=int, default=1)
    pg.add_argument("--inherit-from-state", default="")
    pg.add_argument("--remove-files", action="store_true")
    pg.add_argument("--force", action="store_true")

    nx = sub.add_parser("new")
    nx.add_argument("--name", default="")
    nx.add_argument("--root", default="")
    nx.add_argument("--state-file", default="")
    nx.add_argument("--project-type", default="short")
    nx.add_argument("--series-name", default="")
    nx.add_argument("--episode-index", type=int, default=1)
    nx.add_argument("--inherit-from-state", default="")

    pj = sub.add_parser("projects")

    us = sub.add_parser("use")
    us.add_argument("--name", default="")
    us.add_argument("--state-file", default="")

    sx = sub.add_parser("s")
    sx.add_argument("--state-file", default="")

    tx = sub.add_parser("t")
    tx.add_argument("--state-file", default="")
    tx.add_argument("--refresh", action="store_true")

    rx = sub.add_parser("r")
    rx.add_argument("--state-file", default="")
    rx.add_argument("--poll-render", action="store_true")
    rx.add_argument("--interval", type=int, default=8)
    rx.add_argument("--timeout", type=int, default=3600)

    r = sub.add_parser("router")
    r.add_argument("--input", required=True)

    b = sub.add_parser("brainhole")
    b.add_argument("--input", default="")
    b.add_argument("--input-file", default="")

    sw = sub.add_parser("scriptwriter")
    sw.add_argument("--text", default="")
    sw.add_argument("--input-file", default="")

    sd = sub.add_parser("script-draft")
    sd.add_argument("--title", default="")
    sd.add_argument("--text", default="")
    sd.add_argument("--input-file", default="")
    sd.add_argument("--scene-count", type=int, default=3)

    sq = sub.add_parser("script-quality")
    sq.add_argument("--title", default="")
    sq.add_argument("--text", default="")
    sq.add_argument("--input-file", default="")
    sq.add_argument("--scene-count", type=int, default=3)

    sva = sub.add_parser("script-shortvideo-audit")
    sva.add_argument("--title", default="")
    sva.add_argument("--text", default="")
    sva.add_argument("--input-file", default="")
    sva.add_argument("--platform", default="douyin")
    sva.add_argument("--duration-sec", type=int, default=30)

    ssa = sub.add_parser("script-safety-audit")
    ssa.add_argument("--title", default="")
    ssa.add_argument("--text", default="")
    ssa.add_argument("--input-file", default="")

    sb = sub.add_parser("storyboard")
    sb.add_argument("--script-file", required=True)

    fg = sub.add_parser("forge")
    fg.add_argument("--storyboard-file", required=True)
    fg.add_argument("--out-file", default="")

    rd = sub.add_parser("render")
    rd.add_argument("--prompt", default="")
    rd.add_argument("--prompt-file", default="")
    rd.add_argument("--duration", type=int, default=5)
    rd.add_argument("--ratio", default="9:16")

    rs = sub.add_parser("render-status")
    rs.add_argument("--task-id", required=True)
    rs.add_argument("--fal-model", default="")

    ar = sub.add_parser("archive")
    ar.add_argument("--project", required=True)
    ar.add_argument("--out-dir", default=".")

    sh = sub.add_parser("shell")
    sh.add_argument("--state-file", default="")

    rv = sub.add_parser("revise")
    rv.add_argument("--target", required=True, choices=["beats", "shots"])
    rv.add_argument("--instruction", default="")
    rv.add_argument("--input-file", default="")
    rv.add_argument("--state-file", default="")

    pl = sub.add_parser("pipeline")
    pl.add_argument("--title", default="短片")
    pl.add_argument("--story", default="")
    pl.add_argument("--story-file", default="")
    pl.add_argument("--seconds", type=int, default=20)
    pl.add_argument("--out-dir", default="video")
    pl.add_argument("--state-file", default="")

    pn = sub.add_parser("plan")
    pn.add_argument("--title", default="短片")
    pn.add_argument("--story", default="")
    pn.add_argument("--story-file", default="")
    pn.add_argument("--seconds", type=int, default=20)
    pn.add_argument("--state-file", default="")

    rb = sub.add_parser("render-shots")
    rb.add_argument("--state-file", default="")
    rb.add_argument("--ratio", default="9:16")
    rb.add_argument("--poll", action="store_true")
    rb.add_argument("--interval", type=int, default=8)
    rb.add_argument("--timeout", type=int, default=3600)
    rb.add_argument("--retry-profile", default="stable")
    rb.add_argument("--retry-count", type=int, default=None)
    rb.add_argument("--retry-wait", type=float, default=None)
    rb.add_argument("--strict-multimodal", action="store_true")

    sgm = sub.add_parser("script-generate")
    sgm.add_argument("--state-file", default="")
    sgm.add_argument("--source", default="story", choices=["story", "beats"])

    srv = sub.add_parser("script-revise")
    srv.add_argument("--state-file", default="")
    srv.add_argument("--instruction", default="")
    srv.add_argument("--input-file", default="")

    s2p = sub.add_parser("stage2-prepare")
    s2p.add_argument("--state-file", default="")
    s2p.add_argument("--instruction", default="")
    s2p.add_argument("--input-file", default="")
    s2p.add_argument("--title", default="")

    s2g = sub.add_parser("stage2-generate-part")
    s2g.add_argument("--state-file", default="")
    s2g.add_argument("--part", required=True)
    s2g.add_argument("--instruction", default="")
    s2g.add_argument("--max-shots", type=int, default=0)

    s2s = sub.add_parser("stage2-set-plan")
    s2s.add_argument("--state-file", default="")
    s2s.add_argument("--plan-json", default="")

    s2ss = sub.add_parser("stage2-set-shots")
    s2ss.add_argument("--state-file", default="")
    s2ss.add_argument("--shots-json", default="")

    s2g = sub.add_parser("stage2-generate-assets")
    s2g.add_argument("--state-file", default="")
    s2g.add_argument("--size", default="1024x1024")
    s2g.add_argument("--scene-ignore-character-anchors", action="store_true")

    s2i = sub.add_parser("stage2-generate-item")
    s2i.add_argument("--state-file", default="")
    s2i.add_argument("--kind", required=True)
    s2i.add_argument("--name", required=True)
    s2i.add_argument("--size", default="1024x1024")
    s2i.add_argument("--style", default="")
    s2i.add_argument("--mode", default="")
    s2i.add_argument("--strict-layout", action="store_true")
    s2i.add_argument("--scene-ignore-character-anchors", action="store_true")

    s2s = sub.add_parser("stage2-generate-shots")
    s2s.add_argument("--state-file", default="")
    s2s.add_argument("--style", default="")
    s2s.add_argument("--max-shots", type=int, default=0)
    s2s.add_argument("--duration-sec", type=float, default=0)

    ast = sub.add_parser("asset-add")
    ast.add_argument("--state-file", default="")
    ast.add_argument("--kind", required=True, choices=["face", "scene"])
    ast.add_argument("--name", default="")
    ast.add_argument("--file", required=True)

    al = sub.add_parser("asset-list")
    al.add_argument("--state-file", default="")
    al.add_argument("--kind", default="")
    al.add_argument("--name", default="")

    aa = sub.add_parser("asset-activate")
    aa.add_argument("--state-file", default="")
    aa.add_argument("--kind", required=True, choices=["face", "scene"])
    aa.add_argument("--name", required=True)
    aa.add_argument("--version", default="latest")

    arm = sub.add_parser("asset-remove-version")
    arm.add_argument("--state-file", default="")
    arm.add_argument("--kind", required=True, choices=["face", "scene"])
    arm.add_argument("--name", required=True)
    arm.add_argument("--version", required=True)

    alk = sub.add_parser("asset-lock")
    alk.add_argument("--state-file", default="")
    alk.add_argument("--kind", required=True, choices=["face", "scene"])
    alk.add_argument("--name", required=True)
    alk.add_argument("--version", default="latest")
    alk.add_argument("--unlock", action="store_true")

    cd = sub.add_parser("character-design")
    cd.add_argument("--state-file", default="")
    cd.add_argument("--name", required=True)
    cd.add_argument("--description", required=True)
    cd.add_argument("--size", default="1024x1024")

    sd = sub.add_parser("scene-design")
    sd.add_argument("--state-file", default="")
    sd.add_argument("--name", required=True)
    sd.add_argument("--description", required=True)
    sd.add_argument("--size", default="1024x1024")

    shr = sub.add_parser("shot-revise")
    shr.add_argument("--state-file", default="")
    shr.add_argument("--shot-id", required=True)
    shr.add_argument("--instruction", default="")
    shr.add_argument("--input-file", default="")

    rso = sub.add_parser("render-shot")
    rso.add_argument("--state-file", default="")
    rso.add_argument("--shot-id", required=True)
    rso.add_argument("--ratio", default="9:16")
    rso.add_argument("--poll", action="store_true")
    rso.add_argument("--interval", type=int, default=8)
    rso.add_argument("--timeout", type=int, default=3600)
    rso.add_argument("--retry-profile", default="stable")
    rso.add_argument("--retry-count", type=int, default=None)
    rso.add_argument("--retry-wait", type=float, default=None)
    rso.add_argument("--download-dir", default="videos")
    rso.add_argument("--approve", action="store_true")
    rso.add_argument("--strict-multimodal", action="store_true")

    mg = sub.add_parser("merge-approved")
    mg.add_argument("--state-file", default="")
    mg.add_argument("--download-dir", default="videos")
    mg.add_argument("--output", default="approved_merged.mp4")

    vg = sub.add_parser("voiceover-generate")
    vg.add_argument("--state-file", default="")
    vg.add_argument("--config-file", default="")
    vg.add_argument("--script", default="")
    vg.add_argument("--input-file", default="")
    vg.add_argument("--approved-only", action="store_true")
    vg.add_argument("--output", default="")
    vg.add_argument("--speed-ratio", type=float, default=1.0)
    vg.add_argument("--volume-ratio", type=float, default=1.0)
    vg.add_argument("--pitch-ratio", type=float, default=1.0)
    vg.add_argument("--tts-app-id", default="")
    vg.add_argument("--tts-access-token", default="")
    vg.add_argument("--tts-voice-type", default="")
    vg.add_argument("--tts-resource-id", default="")
    vg.add_argument("--tts-base-url", default="")

    dv = sub.add_parser("dub-final-video")
    dv.add_argument("--state-file", default="")
    dv.add_argument("--video-file", default="")
    dv.add_argument("--audio-file", default="")
    dv.add_argument("--output", default="")

    ap = sub.add_parser("approve-shots")
    ap.add_argument("--state-file", default="")
    ap.add_argument("--shot-ids", default="")
    ap.add_argument("--replace", action="store_true")

    rn = sub.add_parser("run")
    rn.add_argument("--title", default="短片")
    rn.add_argument("--story", default="")
    rn.add_argument("--story-file", default="")
    rn.add_argument("--seconds", type=int, default=20)
    rn.add_argument("--ratio", default="9:16")
    rn.add_argument("--interval", type=int, default=8)
    rn.add_argument("--timeout", type=int, default=3600)
    rn.add_argument("--retry-profile", default="stable")
    rn.add_argument("--retry-count", type=int, default=None)
    rn.add_argument("--retry-wait", type=float, default=None)
    rn.add_argument("--download-dir", default="videos")
    rn.add_argument("--merge", action="store_true")
    rn.add_argument("--merged-name", default="final_merged.mp4")
    rn.add_argument("--strict-multimodal", action="store_true")
    rn.add_argument("--state-file", default="")
    rn.add_argument("--config-file", default="")
    rn.add_argument("--no-prompt", action="store_true")

    ss = sub.add_parser("session-start")
    ss.add_argument("--state-file", default="")
    ss.add_argument("--config-file", default="")
    ss.add_argument("--no-prompt", action="store_true")

    sp = sub.add_parser("session-step")
    sp.add_argument("--state-file", default="")
    sp.add_argument("--input", default="")
    sp.add_argument("--input-file", default="")
    sp.add_argument("--title", default="短片")

    sg = sub.add_parser("session-state")
    sg.add_argument("--state-file", default="")

    sc = sub.add_parser("session-close")
    sc.add_argument("--state-file", default="")

    ch = sub.add_parser("chat")
    ch.add_argument("--state-file", default="")
    ch.add_argument("--config-file", default="")

    stt = sub.add_parser("status")
    stt.add_argument("--state-file", default="")

    rsm = sub.add_parser("resume")
    rsm.add_argument("--state-file", default="")
    rsm.add_argument("--poll-render", action="store_true")
    rsm.add_argument("--interval", type=int, default=8)
    rsm.add_argument("--timeout", type=int, default=3600)

    tl = sub.add_parser("tasks-list")
    tl.add_argument("--state-file", default="")
    tl.add_argument("--refresh", action="store_true")
    tl.add_argument("--poll", action="store_true")
    tl.add_argument("--interval", type=int, default=3)
    tl.add_argument("--timeout", type=int, default=30)
    tl.add_argument("--retry-profile", default="stable")
    tl.add_argument("--retry-count", type=int, default=None)
    tl.add_argument("--retry-wait", type=float, default=None)
    tl.add_argument("--download-dir", default="")
    tl.add_argument("--shot-id", default="")

    rf = sub.add_parser("regression-full")
    rf.add_argument("--state-file", default="")
    rf.add_argument("--name", default="regression-full")
    rf.add_argument("--root", default="tmp/full_regression_demo/regression-full")
    rf.add_argument("--title", default="回归短片")
    rf.add_argument("--story", default="深夜女程序员在旧地铁站收到来自未来的报警短信。她按提示撤回一次高危配置提交，避免了线上事故，并在黎明前给未来自己留下回执。")
    rf.add_argument("--platform", default="douyin")
    rf.add_argument("--strict-gate", action="store_true")
    rf.add_argument("--duration-sec", type=int, default=30)
    rf.add_argument("--max-shots", type=int, default=4)
    rf.add_argument("--size", default="1024x1024")
    rf.add_argument("--face-ref-file", default="")
    rf.add_argument("--scene-ref-file", default="")
    rf.add_argument("--face-name", default="")
    rf.add_argument("--scene-name", default="")
    rf.add_argument("--scene-mode", default="master")
    rf.add_argument("--scene-style", default="回归锚点验证")
    rf.add_argument("--download-dir", default="tmp/full_regression_downloads")
    rf.add_argument("--output", default="tmp/full_regression_demo/full_regression_short.mp4")
    rf.add_argument("--render-timeout", type=int, default=360)

    ps = sub.add_parser("prompt-suggest")
    ps.add_argument("--kind", default="generic")
    ps.add_argument("--text", default="")
    ps.add_argument("--context", default="")
    ps.add_argument("--state-file", default="")

    jr = sub.add_parser("journal-report")
    jr.add_argument("--journal-file", default="")
    jr.add_argument("--tail", type=int, default=1000)
    jr.add_argument("--event", default="")
    jr.add_argument("--format", default="json")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        global CURRENT_USAGE_ROWS
        CURRENT_USAGE_ROWS = []
        if not args.command:
            if str(args.session).strip():
                config_file = args.session_config_file or ""
                state_file = resolve_state_file(args.session_state_file or "", Path(config_file) if config_file else default_config_path())
                config_file = args.session_config_file or ""
                cmd_session_start(
                    argparse.Namespace(
                        json=args.json,
                        state_file=state_file,
                        config_file=config_file,
                        no_prompt=args.session_no_prompt,
                    )
                )
                cmd_session_step(
                    argparse.Namespace(
                        json=args.json,
                        state_file=state_file,
                        input=str(args.session),
                        input_file="",
                        title=args.session_title,
                    )
                )
                return
            cmd_chat(
                argparse.Namespace(
                    json=False,
                    state_file=resolve_state_file(args.session_state_file or "", Path(args.session_config_file) if args.session_config_file else default_config_path()),
                    config_file=args.session_config_file or "",
                )
            )
            return
        command_map = {
            "start": cmd_start,
            "router": cmd_router,
            "setup": cmd_setup,
            "config-set": cmd_config_set,
            "volc-models": cmd_volc_models,
            "project-init": cmd_project_init,
            "project-next-episode": cmd_project_next_episode,
            "project-list": cmd_project_list,
            "project-use": cmd_project_use,
            "project-delete": cmd_project_delete,
            "project-set-story": cmd_project_set_story,
            "project-open": cmd_project_open,
            "continue": cmd_continue,
            "p": cmd_p,
            "new": cmd_project_init,
            "projects": cmd_project_list,
            "use": cmd_project_use,
            "s": cmd_status,
            "t": cmd_tasks_list,
            "r": cmd_resume,
            "brainhole": cmd_brainhole,
            "scriptwriter": cmd_scriptwriter,
            "script-draft": cmd_script_draft,
            "script-quality": cmd_script_quality,
            "script-shortvideo-audit": cmd_script_shortvideo_audit,
            "script-safety-audit": cmd_script_safety_audit,
            "storyboard": cmd_storyboard,
            "forge": cmd_forge,
            "render": cmd_render,
            "render-status": cmd_render_status,
            "script-generate": cmd_script_generate,
            "script-revise": cmd_script_revise,
            "stage2-prepare": cmd_stage2_prepare,
            "stage2-generate-part": cmd_stage2_generate_part,
            "stage2-set-plan": cmd_stage2_set_plan,
            "stage2-set-shots": cmd_stage2_set_shots,
            "stage2-generate-assets": cmd_stage2_generate_assets,
            "stage2-generate-item": cmd_stage2_generate_item,
            "stage2-generate-shots": cmd_stage2_generate_shots,
            "asset-add": cmd_asset_add,
            "asset-list": cmd_asset_list,
            "asset-activate": cmd_asset_activate,
            "asset-remove-version": cmd_asset_remove_version,
            "asset-lock": cmd_asset_lock,
            "character-design": cmd_character_design,
            "scene-design": cmd_scene_design,
            "shot-revise": cmd_shot_revise,
            "render-shot": cmd_render_shot,
            "merge-approved": cmd_merge_approved,
            "voiceover-generate": cmd_voiceover_generate,
            "dub-final-video": cmd_dub_final_video,
            "approve-shots": cmd_approve_shots,
            "archive": cmd_archive,
            "shell": cmd_shell,
            "revise": cmd_revise,
            "pipeline": cmd_pipeline,
            "plan": cmd_plan,
            "render-shots": cmd_render_shots,
            "run": cmd_run,
            "session-start": cmd_session_start,
            "session-step": cmd_session_step,
            "session-state": cmd_session_state,
            "session-close": cmd_session_close,
            "chat": cmd_chat,
            "prompt-suggest": cmd_prompt_suggest,
            "journal-report": cmd_journal_report,
            "fal-workflow": cmd_fal_workflow,
            "fal-workflow-list": cmd_fal_workflow_list,
            "fal-shortdrama-auto": cmd_fal_shortdrama_auto,
            "status": cmd_status,
            "resume": cmd_resume,
            "tasks-list": cmd_tasks_list,
            "regression-full": cmd_regression_full,
        }
        if args.command != "project-init" and hasattr(args, "state_file") and (not str(getattr(args, "state_file", "")).strip()):
            cfg_hint = getattr(args, "config_file", "") if hasattr(args, "config_file") else ""
            cfg_path = Path(cfg_hint) if str(cfg_hint).strip() else default_config_path()
            args.state_file = resolve_state_file("", cfg_path) or args.state_file
        command_map[args.command](args)
    except Exception as exc:
        payload = {"ok": False, "error": str(exc), "next_action": "python scu_cli.py setup"}
        if getattr(args, "json", False):
            print(json.dumps(payload, ensure_ascii=False))
            sys.exit(1)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
