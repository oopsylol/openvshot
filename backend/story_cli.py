import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

from volcenginesdkarkruntime import Ark


def now_tag() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


def read_story_from_file(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def read_story_from_stdin() -> str:
    print("请输入剧本内容，输入单独一行 END 结束：")
    lines = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def extract_json_block(text: str):
    match = re.search(r"```json\s*([\s\S]*?)```", text)
    if match:
        text = match.group(1).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def fallback_beats(story: str):
    chunks = [x.strip() for x in re.split(r"\n\s*\n+", story) if x.strip()]
    beats = []
    for idx, chunk in enumerate(chunks, start=1):
        beats.append({"id": idx, "beat": chunk})
    if not beats:
        beats.append({"id": 1, "beat": story.strip() or "空剧本"})
    return beats


def ensure_volc_client():
    api_key = os.getenv("ARK_API_KEY", "").strip()
    base_url = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").strip()
    model = os.getenv("VOLC_TEXT_MODEL", "").strip()
    if not api_key:
        raise RuntimeError("缺少 ARK_API_KEY")
    if not model:
        raise RuntimeError("缺少 VOLC_TEXT_MODEL")
    client = Ark(base_url=base_url, api_key=api_key, region="cn-beijing")
    return client, model


def volc_chat(client, model: str, prompt: str) -> str:
    result = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=4096,
    )
    choices = getattr(result, "choices", None)
    if not choices:
        raise RuntimeError("模型返回为空")
    return choices[0].message.content or ""


def split_story_to_beats(client, model: str, title: str, story: str):
    prompt = (
        "你是短视频编导助手。请把下面剧本拆分为适合20秒短视频的剧情节拍。\n"
        "输出必须是 JSON 数组，每项结构：{\"id\":数字,\"beat\":\"节拍文本\"}\n"
        "要求：\n"
        "1) 4-6个节拍\n"
        "2) 每个节拍可视化，可直接拍出来\n"
        "3) 保留情绪转折\n"
        f"标题：{title}\n"
        f"剧本：\n{story}\n"
    )
    text = volc_chat(client, model, prompt)
    try:
        beats = extract_json_block(text)
    except Exception:
        beats = fallback_beats(story)
    normalized = []
    for idx, item in enumerate(beats, start=1):
        if isinstance(item, dict):
            beat_text = str(item.get("beat", "")).strip()
        else:
            beat_text = str(item).strip()
        if beat_text:
            normalized.append({"id": idx, "beat": beat_text})
    return normalized or fallback_beats(story)


def make_shots_from_beats(client, model: str, title: str, beats, total_seconds: int):
    beats_text = "\n".join([f"{b['id']}. {b['beat']}" for b in beats])
    prompt = (
        "你是分镜导演。请把节拍转成分镜清单。\n"
        "输出必须是 JSON 数组，每项结构："
        "{\"shot_id\":\"S01\",\"duration_sec\":数字,\"scene\":\"场景\",\"action\":\"动作\",\"camera\":\"镜头语言\",\"subtitle\":\"字幕\",\"visual_prompt\":\"用于视频模型的英文提示词\"}\n"
        f"目标总时长：约{total_seconds}秒，允许上下浮动2秒。\n"
        "要求：\n"
        "1) 每条 visual_prompt 用英文，写实电影感，适合竖屏9:16\n"
        "2) 动作连续，避免抽象心理描写\n"
        "3) 字幕简短\n"
        f"片名：{title}\n"
        f"节拍：\n{beats_text}\n"
    )
    text = volc_chat(client, model, prompt)
    shots = extract_json_block(text)
    cleaned = []
    for idx, item in enumerate(shots, start=1):
        if not isinstance(item, dict):
            continue
        shot_id = item.get("shot_id") or f"S{idx:02d}"
        duration_sec = float(item.get("duration_sec", 4))
        cleaned.append(
            {
                "shot_id": str(shot_id),
                "duration_sec": round(duration_sec, 2),
                "scene": str(item.get("scene", "")).strip(),
                "action": str(item.get("action", "")).strip(),
                "camera": str(item.get("camera", "")).strip(),
                "subtitle": str(item.get("subtitle", "")).strip(),
                "visual_prompt": str(item.get("visual_prompt", "")).strip(),
            }
        )
    if not cleaned:
        raise RuntimeError("分镜生成为空")
    return cleaned


def print_beats(beats):
    print("\n剧情节拍：")
    for b in beats:
        print(f"[{b['id']}] {b['beat']}")


def print_shots(shots):
    print("\n分镜清单：")
    for s in shots:
        print(f"{s['shot_id']} | {s['duration_sec']}s | {s['scene']} | {s['camera']}")
        print(f"  action: {s['action']}")
        print(f"  subtitle: {s['subtitle']}")
        print(f"  prompt: {s['visual_prompt']}")


def edit_beats_loop(beats):
    while True:
        print_beats(beats)
        cmd = input("\n节拍操作 [next/edit/add/del]: ").strip().lower()
        if cmd == "next":
            return beats
        if cmd == "edit":
            idx = int(input("输入节拍序号: ").strip())
            text = input("新的节拍文本: ").strip()
            for b in beats:
                if b["id"] == idx:
                    b["beat"] = text
                    break
        elif cmd == "add":
            text = input("新增节拍文本: ").strip()
            beats.append({"id": len(beats) + 1, "beat": text})
        elif cmd == "del":
            idx = int(input("删除节拍序号: ").strip())
            beats = [b for b in beats if b["id"] != idx]
            for i, b in enumerate(beats, start=1):
                b["id"] = i
    return beats


def edit_shots_loop(shots):
    while True:
        print_shots(shots)
        cmd = input("\n分镜操作 [next/edit/regen]: ").strip().lower()
        if cmd == "next":
            return shots, False
        if cmd == "regen":
            return shots, True
        if cmd == "edit":
            shot_id = input("输入镜头ID，如 S01: ").strip()
            field = input("字段 [duration_sec/scene/action/camera/subtitle/visual_prompt]: ").strip()
            value = input("新值: ").strip()
            for s in shots:
                if s["shot_id"] == shot_id and field in s:
                    s[field] = float(value) if field == "duration_sec" else value
                    break
    return shots, False


def export_outputs(out_dir: str, title: str, story: str, beats, shots):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    tag = now_tag()
    bundle = {
        "title": title,
        "story": story,
        "beats": beats,
        "shots": shots,
        "total_duration": round(sum(float(s["duration_sec"]) for s in shots), 2),
    }
    json_path = Path(out_dir) / f"{title}_{tag}.json"
    json_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    prompt_lines = []
    for s in shots:
        prompt_lines.append(f"{s['shot_id']} ({s['duration_sec']}s)")
        prompt_lines.append(s["visual_prompt"])
        prompt_lines.append("")
    prompt_path = Path(out_dir) / f"{title}_{tag}_prompts.txt"
    prompt_path.write_text("\n".join(prompt_lines), encoding="utf-8")
    return str(json_path), str(prompt_path), bundle["total_duration"]


def run_interactive(args):
    title = args.title.strip() if args.title else "未命名短片"
    story = read_story_from_file(args.script_file) if args.script_file else read_story_from_stdin()
    if not story.strip():
        raise RuntimeError("剧本为空")
    client, model = ensure_volc_client()
    beats = split_story_to_beats(client, model, title, story)
    beats = edit_beats_loop(beats)
    while True:
        shots = make_shots_from_beats(client, model, title, beats, args.seconds)
        shots, need_regen = edit_shots_loop(shots)
        if not need_regen:
            break
    json_path, prompt_path, total = export_outputs(args.out_dir, title, story, beats, shots)
    print("\n已完成终稿导出：")
    print(f"JSON: {json_path}")
    print(f"Prompts: {prompt_path}")
    print(f"总时长: {total}s")


def build_parser():
    parser = argparse.ArgumentParser(prog="story-cli")
    sub = parser.add_subparsers(dest="command")
    i = sub.add_parser("interactive")
    i.add_argument("--title", type=str, default="短片")
    i.add_argument("--script-file", type=str, default="")
    i.add_argument("--seconds", type=int, default=20)
    i.add_argument("--out-dir", type=str, default="video")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not args.command:
        args = parser.parse_args(["interactive"])
    if args.command == "interactive":
        run_interactive(args)
        return
    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
