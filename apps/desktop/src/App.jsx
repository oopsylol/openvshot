import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Eye, EyeOff, FolderOpen, Images, MessageCircle, Settings, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const workflowSteps = [
  { key: "step1", title: "第一步：剧本阶段", stages: ["session_active", "script_ready", "script_revised"] },
  { key: "step2", title: "第二步：角色/场景/分镜文本", stages: ["stage2_prepared"] },
  { key: "step3", title: "第三步：素材与分镜", stages: ["character_ready", "scene_ready", "assets_ready", "shots_ready", "shots_revised"] },
  { key: "step4", title: "第四步：渲染与合成", stages: ["rendering", "rendered", "shot_rendered", "merged"] },
];

const assetSizePresets = [
  { value: "1024x1024", label: "1024×1024（通用方图）" },
  { value: "832x1216", label: "832×1216（角色竖构图）" },
  { value: "1216x832", label: "1216×832（场景横构图）" },
];

const videoSizePresets = [
  { value: "1080x1920", label: "1080×1920（手机竖屏/抖音）" },
  { value: "1920x1080", label: "1920×1080（横屏/B站/YouTube）" },
  { value: "1080x1080", label: "1080×1080（方屏/社媒封面）" },
  { value: "2160x3840", label: "2160×3840（4K竖屏）" },
  { value: "3840x2160", label: "3840×2160（4K横屏）" },
];

const artStylePresets = [
  { value: "写实电影感", label: "写实" },
  { value: "二次元动漫风", label: "动漫" },
  { value: "美式卡通风", label: "卡通" },
  { value: "赛博朋克霓虹风", label: "赛博朋克" },
  { value: "汉服古风电影感", label: "汉服风" },
  { value: "Pixar风3D动画质感", label: "3D动画" },
  { value: "日式新海诚光影风", label: "日系光影" },
  { value: "暗黑奇幻史诗风", label: "暗黑奇幻" },
  { value: "蒸汽朋克工业美术风", label: "蒸汽朋克" },
];

const faceModePresets = [
  { value: "full_body", label: "角色全身" },
  { value: "portrait", label: "角色肖像" },
  { value: "model_sheet", label: "角色设定板（白底三视图）" },
  { value: "turnaround", label: "角色定妆站姿" },
  { value: "action_pose", label: "角色动作姿态" },
];

const sceneModePresets = [
  { value: "master", label: "场景主镜头" },
  { value: "wide", label: "场景大全景" },
  { value: "detail", label: "场景细节特写" },
  { value: "empty_plate", label: "空镜底板" },
];

const falAutoPresetOptions = [
  { value: "shortdrama-quality", label: "shortdrama-quality（画质优先）" },
  { value: "shortdrama-cost", label: "shortdrama-cost（成本优先）" },
  { value: "shortdrama-cn", label: "shortdrama-cn（中文短剧）" },
  { value: "shortdrama-global", label: "shortdrama-global（通用短剧）" },
];

const falWorkflowKeywordOptions = [
  { value: "workflow", label: "workflow" },
  { value: "video", label: "video" },
  { value: "text-to-video", label: "text-to-video" },
  { value: "kling", label: "kling" },
];

const falWorkflowKeywordPresets = [
  { value: "shortdrama-basic", label: "短剧基础", query: "workflow", keywords: ["workflow", "video"] },
  { value: "shortdrama-ttv", label: "短剧文生视频", query: "video", keywords: ["text-to-video", "kling"] },
  { value: "workflow-only", label: "仅工作流", query: "workflow", keywords: ["workflow"] },
  { value: "custom", label: "自定义", query: "", keywords: [] },
];

const journalEventPresetOptions = [
  { value: "fal_workflow_call", label: "fal_workflow_call" },
  { value: "fal_workflow_list", label: "fal_workflow_list" },
  { value: "fal_shortdrama_auto", label: "fal_shortdrama_auto" },
];

function menuFromStage(stage) {
  const current = String(stage || "").trim();
  if (!current) {
    return "project";
  }
  const step4Stages = new Set(["rendering", "rendered", "shot_rendered", "merged"]);
  const step3Stages = new Set(["character_ready", "scene_ready", "assets_ready", "shots_ready", "shots_revised"]);
  const step2Stages = new Set(["script_confirmed", "stage2_prepared"]);
  if (step4Stages.has(current)) {
    return "step4";
  }
  if (step3Stages.has(current)) {
    return "step3";
  }
  if (step2Stages.has(current)) {
    return "step2";
  }
  return "step1";
}

function ratioFromSize(sizeText) {
  const raw = String(sizeText || "").trim().toLowerCase();
  const matched = raw.match(/^(\d+)\s*[x*]\s*(\d+)$/);
  if (!matched) {
    return "";
  }
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!(width > 0 && height > 0)) {
    return "";
  }
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function formatAssetTime(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "未知";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toLocaleString();
}

function parseSeedancePromptParts(promptText) {
  const text = String(promptText || "").trim();
  const parts = { subject: "", action: "", camera: "", style: "", quality: "" };
  if (!text) {
    parts.quality = "4K, Ultra HD, Sharp clarity";
    return parts;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const joined = lines.join(" ");
  const pattern = /(Subject|Action|Camera|Style|Quality)\s*:\s*/gi;
  const matches = Array.from(joined.matchAll(pattern));
  if (matches.length === 0) {
    parts.subject = text;
    parts.quality = "4K, Ultra HD, Sharp clarity";
    return parts;
  }
  matches.forEach((match, index) => {
    const label = String(match[1] || "").toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? joined.length : joined.length;
    const value = joined.slice(start, end).trim().replace(/[。．]$/, "").replace(/\.$/, "");
    if (label === "subject") {
      parts.subject = value;
    } else if (label === "action") {
      parts.action = value;
    } else if (label === "camera") {
      parts.camera = value;
    } else if (label === "style") {
      parts.style = value;
    } else if (label === "quality") {
      parts.quality = value;
    }
  });
  if (!parts.quality) {
    parts.quality = "4K, Ultra HD, Sharp clarity";
  }
  return parts;
}

function composeSeedancePromptParts(parts) {
  const rows = [
    ["Subject", parts?.subject],
    ["Action", parts?.action],
    ["Camera", parts?.camera],
    ["Style", parts?.style],
    ["Quality", parts?.quality || "4K, Ultra HD, Sharp clarity"],
  ];
  return rows
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label}: ${String(value || "").trim()}.`)
    .join("\n");
}

function detectReferenceAngle(versionItem) {
  const sourceText = [
    String(versionItem?.file || ""),
    String(versionItem?.prompt || ""),
    String(versionItem?.source || ""),
    String(versionItem?.tag || ""),
  ]
    .join(" ")
    .toLowerCase();
  if (/三分之三|四分之三|3\/4|three[\s-]?quarter|quarter/.test(sourceText)) {
    return "threeQuarter";
  }
  if (/侧面|profile|side/.test(sourceText)) {
    return "side";
  }
  if (/正面|front/.test(sourceText)) {
    return "front";
  }
  return "";
}

function summarizeReferenceCoverage(versions) {
  const summary = { front: false, side: false, threeQuarter: false, taggedCount: 0 };
  (Array.isArray(versions) ? versions : []).forEach((item) => {
    const angle = detectReferenceAngle(item);
    if (!angle) {
      return;
    }
    summary[angle] = true;
    summary.taggedCount += 1;
  });
  return summary;
}

function countPromptWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function validateSeedancePrompt(promptText, useImageRefs = false) {
  const parts = parseSeedancePromptParts(promptText);
  const wordCount = countPromptWords(promptText);
  const minWords = useImageRefs ? 50 : 120;
  const maxWords = useImageRefs ? 80 : 280;
  const actionSegments = String(parts.action || "")
    .split(/\s*(?:,|;| and | then | with | while | meanwhile )\s*/i)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const warnings = [];
  if (![parts.subject, parts.action, parts.camera, parts.style, parts.quality].every((item) => String(item || "").trim())) {
    warnings.push("五模块未补齐");
  }
  if (wordCount < minWords || wordCount > maxWords) {
    warnings.push(`词数建议 ${minWords}-${maxWords}`);
  }
  if (!/4k/i.test(parts.quality) || !/ultra hd/i.test(parts.quality) || !/sharp clarity/i.test(parts.quality)) {
    warnings.push("缺少标准画质后缀");
  }
  if (/(negative prompt|禁止|避免|without| no\s+[a-z])/i.test(String(promptText || ""))) {
    warnings.push("含否定提示词");
  }
  if (actionSegments.length > 1) {
    warnings.push("Action 疑似包含多个动作");
  }
  if (!/kodak|vision3|arri|film|35mm|500t/i.test(String(parts.style || ""))) {
    warnings.push("Style 缺少稳定风格锚点");
  }
  return {
    wordCount,
    minWords,
    maxWords,
    warnings,
    ok: warnings.length === 0,
  };
}

const seedanceQualitySuffix = "4K, Ultra HD, Sharp clarity";
const seedanceStyleAnchor = "Kodak Vision3 500T";
const seedanceContinuityCameraRules = [
  { label: "大全景", pattern: /(wide shot|wide angle|establishing|大全景|远景)/i },
  { label: "中景", pattern: /(medium shot|mid shot|中景)/i },
  { label: "近景", pattern: /(close[- ]?up|close shot|特写|近景)/i },
  { label: "俯拍", pattern: /(top shot|top[- ]?down|overhead|bird'?s[- ]?eye|俯拍)/i },
  { label: "仰拍", pattern: /(low angle|worm'?s[- ]?eye|仰拍)/i },
  { label: "主观镜头", pattern: /(pov|point of view|主观镜头)/i },
  { label: "跟拍", pattern: /(tracking shot|follow shot|跟拍)/i },
  { label: "推镜", pattern: /(push in|dolly in|推镜)/i },
  { label: "拉镜", pattern: /(pull back|dolly out|拉镜)/i },
  { label: "手持", pattern: /(handheld|手持)/i },
  { label: "固定机位", pattern: /(static shot|locked[- ]?off|stable framing|固定机位|固定镜头)/i },
];
const seedanceContinuityDirectionRules = [
  { label: "向左", pattern: /(向左|往左|leftward|move left|pan left|track left)/i },
  { label: "向右", pattern: /(向右|往右|rightward|move right|pan right|track right)/i },
  { label: "向前", pattern: /(向前|上前|forward|toward camera|move forward|push in)/i },
  { label: "向后", pattern: /(向后|后退|backward|away from camera|move back|pull back)/i },
  { label: "向上", pattern: /(向上|上升|upward|rise|tilt up|move up)/i },
  { label: "向下", pattern: /(向下|下降|downward|drop|tilt down|move down)/i },
];
const seedanceWardrobePattern = /(?:红色|白色|黑色|蓝色|绿色|灰色|银色|金色|红|白|黑|蓝|绿|灰|银|金|red|white|black|blue|green|gray|grey|silver|gold|brown|pink|purple)?(?:[\s-]{0,2}(?:长款|短款|宽松|修身|丝绸|皮质|牛仔|金属|formal|casual|leather|denim|silk))?[\s-]{0,2}(?:外套|大衣|风衣|夹克|西装|衬衫|长裙|短裙|礼服|盔甲|制服|斗篷|帽衫|毛衣|长袍|T恤|上衣|裤子|裙子|coat|jacket|blazer|shirt|dress|gown|armor|uniform|cloak|hoodie|sweater|robe|t-shirt|pants|trousers)/gi;

function normalizePromptSegment(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[，,;；]+$/g, "")
    .trim();
}

function stripNegativePromptClauses(text) {
  return normalizePromptSegment(
    String(text || "")
      .replace(/\bnegative prompt\s*:\s*[^.;,，。；\n]*/gi, " ")
      .replace(/(?:禁止|避免|不要|去掉|移除)[^,，。；;\n]*/g, " ")
      .replace(/\bwithout\s+[^,.;，。；\n]*/gi, " ")
      .replace(/\bno\s+[a-z][^,.;，。；\n]*/gi, " ")
      .replace(/\bnever\s+[^,.;，。；\n]*/gi, " ")
      .replace(/\bnot\s+[^,.;，。；\n]*/gi, " "),
  );
}

function splitSeedanceActionSegments(text) {
  return normalizePromptSegment(text)
    .split(/\s*(?:,|;| and | then | with | while | meanwhile |同时|然后|并且|并|且)\s*/i)
    .map((item) => normalizePromptSegment(item))
    .filter(Boolean);
}

function truncateWords(text, maxWords) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) {
    return normalizePromptSegment(text);
  }
  return normalizePromptSegment(words.slice(0, maxWords).join(" "));
}

function appendUniquePromptPhrase(text, phrase) {
  const base = normalizePromptSegment(text);
  const addition = normalizePromptSegment(phrase);
  if (!addition) {
    return base;
  }
  if (base.toLowerCase().includes(addition.toLowerCase())) {
    return base;
  }
  return [base, addition].filter(Boolean).join(", ");
}

function buildSeedanceTemplateParts(shot, artStyle) {
  const subtitle = normalizePromptSegment(String(shot?.subtitle || ""));
  return {
    subject: subtitle || "single subject in a coherent story world",
    action: subtitle || "perform one clear continuous action",
    camera: "medium shot, stable framing, smooth motion, natural end pose",
    style: `${normalizePromptSegment(String(artStyle || "")) || "realistic cinematic"} ${seedanceStyleAnchor}`,
    quality: seedanceQualitySuffix,
  };
}

function ensureSeedanceQualitySuffix(text) {
  let next = normalizePromptSegment(stripNegativePromptClauses(text));
  if (!next) {
    return seedanceQualitySuffix;
  }
  ["4K", "Ultra HD", "Sharp clarity"].forEach((token) => {
    if (!new RegExp(token.replace(/\s+/g, "\\s+"), "i").test(next)) {
      next = `${next}, ${token}`;
    }
  });
  return normalizePromptSegment(next);
}

function ensureSeedanceStyleAnchor(text, artStyle) {
  let next = normalizePromptSegment(stripNegativePromptClauses(text));
  if (!next) {
    next = `${normalizePromptSegment(String(artStyle || "")) || "realistic cinematic"} ${seedanceStyleAnchor}`;
  }
  if (!/kodak|vision3|arri|film|35mm|500t/i.test(next)) {
    next = `${next}, ${seedanceStyleAnchor}`;
  }
  return normalizePromptSegment(next);
}

function squeezeSeedancePartsToWordLimit(parts, maxWords) {
  let nextParts = { ...parts };
  const targetBudgets = [
    ["style", 28],
    ["camera", 18],
    ["subject", 24],
    ["action", 16],
  ];
  targetBudgets.forEach(([key, budget]) => {
    if (countPromptWords(composeSeedancePromptParts(nextParts)) > maxWords) {
      nextParts = {
        ...nextParts,
        [key]: truncateWords(nextParts[key], budget),
      };
    }
  });
  const shrinkOrder = ["style", "camera", "subject", "action"];
  let guard = 0;
  while (countPromptWords(composeSeedancePromptParts(nextParts)) > maxWords && guard < 24) {
    const overflow = countPromptWords(composeSeedancePromptParts(nextParts)) - maxWords;
    let changed = false;
    shrinkOrder.forEach((key) => {
      if (changed) {
        return;
      }
      const words = String(nextParts[key] || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length <= 4) {
        return;
      }
      nextParts = {
        ...nextParts,
        [key]: truncateWords(nextParts[key], Math.max(4, words.length - overflow)),
      };
      changed = true;
    });
    if (!changed) {
      break;
    }
    guard += 1;
  }
  return nextParts;
}

function expandSeedancePartsToMinWords(parts, minWords) {
  const fillerQueue = [
    ["subject", "consistent character identity, readable costume details, clear facial expression"],
    ["action", "natural body mechanics, seamless motion arc, controlled pacing"],
    ["camera", "cinematic composition, stable focus, smooth lens movement, clean framing"],
    ["style", "filmic lighting contrast, grounded texture detail, cohesive color palette"],
  ];
  let nextParts = { ...parts };
  let cursor = 0;
  while (countPromptWords(composeSeedancePromptParts(nextParts)) < minWords && cursor < 12) {
    const [key, filler] = fillerQueue[cursor % fillerQueue.length];
    nextParts = {
      ...nextParts,
      [key]: appendUniquePromptPhrase(nextParts[key], filler),
    };
    cursor += 1;
  }
  return nextParts;
}

function autoFixSeedancePromptForShot(shot, artStyle, useImageRefs = false) {
  const promptText = String(shot?.visual_prompt || "");
  const parts = parseSeedancePromptParts(promptText);
  const templateParts = buildSeedanceTemplateParts(shot, artStyle);
  let nextParts = {
    subject: normalizePromptSegment(stripNegativePromptClauses(parts.subject)) || templateParts.subject,
    action: normalizePromptSegment(stripNegativePromptClauses(splitSeedanceActionSegments(parts.action).at(0) || parts.action || shot?.subtitle)) || templateParts.action,
    camera: normalizePromptSegment(stripNegativePromptClauses(parts.camera)) || templateParts.camera,
    style: ensureSeedanceStyleAnchor(parts.style, artStyle),
    quality: ensureSeedanceQualitySuffix(parts.quality),
  };
  const minWords = useImageRefs ? 50 : 120;
  const maxWords = useImageRefs ? 80 : 280;
  nextParts = squeezeSeedancePartsToWordLimit(nextParts, maxWords);
  nextParts = expandSeedancePartsToMinWords(nextParts, minWords);
  nextParts = squeezeSeedancePartsToWordLimit(nextParts, maxWords);
  return composeSeedancePromptParts(nextParts);
}

function extractContinuityMatches(text, dictionary) {
  const source = String(text || "").toLowerCase();
  return Array.from(
    new Set(
      (Array.isArray(dictionary) ? dictionary : [])
        .map((item) => normalizePromptSegment(item))
        .filter(Boolean)
        .filter((item) => source.includes(item.toLowerCase())),
    ),
  );
}

function extractWardrobeDescriptors(text) {
  const matches = String(text || "").match(seedanceWardrobePattern) || [];
  return Array.from(new Set(matches.map((item) => normalizePromptSegment(item)).filter(Boolean)));
}

function detectContinuityLabel(text, rules) {
  const source = String(text || "");
  const matched = (Array.isArray(rules) ? rules : []).find((item) => item.pattern.test(source));
  return matched?.label || "";
}

function buildShotContinuitySnapshot(shot, index, characterNames) {
  const shotId = String(shot?.shot_id || `S${String(index + 1).padStart(2, "0")}`);
  const parts = parseSeedancePromptParts(String(shot?.visual_prompt || ""));
  const subjectText = [shot?.subtitle, parts.subject, parts.action].map((item) => String(item || "")).join(" ");
  const cameraText = [parts.camera, parts.action, shot?.subtitle].map((item) => String(item || "")).join(" ");
  return {
    shotId,
    characters: extractContinuityMatches(subjectText, characterNames),
    wardrobe: extractWardrobeDescriptors(subjectText),
    camera: detectContinuityLabel(parts.camera, seedanceContinuityCameraRules),
    direction: detectContinuityLabel(cameraText, seedanceContinuityDirectionRules),
  };
}

function hasContinuityOverlap(source, target) {
  return source.some((item) => target.includes(item));
}

function compareShotContinuity(previousShot, nextShot) {
  const warnings = [];
  if (
    previousShot.characters.length &&
    nextShot.characters.length &&
    !hasContinuityOverlap(previousShot.characters, nextShot.characters)
  ) {
    warnings.push(`人物名可能跳变：${previousShot.characters.join("、")} → ${nextShot.characters.join("、")}`);
  }
  if (
    previousShot.wardrobe.length &&
    nextShot.wardrobe.length &&
    !hasContinuityOverlap(previousShot.wardrobe, nextShot.wardrobe)
  ) {
    warnings.push(`服装描述可能跳变：${previousShot.wardrobe.join("、")} → ${nextShot.wardrobe.join("、")}`);
  }
  if (previousShot.camera && nextShot.camera && previousShot.camera !== nextShot.camera) {
    warnings.push(`机位变化较大：${previousShot.camera} → ${nextShot.camera}`);
  }
  if (previousShot.direction && nextShot.direction && previousShot.direction !== nextShot.direction) {
    warnings.push(`动作方向可能反转：${previousShot.direction} → ${nextShot.direction}`);
  }
  return warnings;
}

const workspaceDraftKey = "openvshot_workspace_draft_v1";

function normalizeStatePath(pathText) {
  return String(pathText || "").trim().replace(/\//g, "\\").toLowerCase();
}

function parsePayload(stdout) {
  const tryParseJson = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const text = String(stdout || "").trim();
  if (!text) {
    return null;
  }
  const direct = tryParseJson(text);
  if (direct) {
    return direct;
  }
  {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
        continue;
      }
      const parsedLine = tryParseJson(candidate);
      if (parsedLine) {
        return parsedLine;
      }
    }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      const parsedSlice = tryParseJson(candidate);
      if (parsedSlice) {
        return parsedSlice;
      }
    }
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const candidate = text.slice(firstBracket, lastBracket + 1);
      const parsedSlice = tryParseJson(candidate);
      if (parsedSlice) {
        return parsedSlice;
      }
    }
    return null;
  }
}

function summarizeError(response, payload) {
  const payloadError = String(payload?.error || "").trim();
  if (payloadError) {
    return payloadError;
  }
  const stderr = String(response?.stderr || "").trim();
  if (stderr) {
    return stderr.slice(0, 300);
  }
  const stdout = String(response?.stdout || "").trim();
  if (stdout) {
    return stdout.slice(0, 300);
  }
  return "未返回具体错误信息";
}

function formatSummaryLabel(key) {
  const map = {
    shot_id: "镜头ID",
    duration_sec: "时长(秒)",
    subtitle: "字幕",
    visual_prompt: "画面提示词",
    action: "动作",
    scene: "场景",
    character: "角色",
    mood: "情绪",
  };
  return map[String(key || "").trim()] || String(key || "");
}

function toEpisodeSummaryCards(payload) {
  const rows = [];
  const source = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.episodes) ? payload.episodes : []);
  source.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const epRaw = item.episode ?? item.ep ?? item.index ?? item.id ?? index + 1;
    const summary = String(item.summary ?? item.synopsis ?? item.plot ?? item.outline ?? "").trim();
    if (!summary) {
      return;
    }
    rows.push({
      episode: String(epRaw).trim() || String(index + 1),
      summary,
    });
  });
  return rows;
}

function SummaryCardGrid({ items = [], prefix = "summary" }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div key={`${prefix}-${item.key}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs text-slate-500">{item.label}</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function SectionLead({ title, description }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{description}</div>
    </div>
  );
}

function TogglePanelHeader({ title, description, open, onToggle, openLabel, closedLabel }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-3">
      <SectionLead title={title} description={description} />
      <Button size="sm" variant="outline" onClick={onToggle}>
        {open ? openLabel : closedLabel}
      </Button>
    </div>
  );
}

function WorkflowNavButton({ active, disabled, icon, title, description, onClick }) {
  return (
    <button
      type="button"
      className={`rounded-xl border p-3 text-left ${active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
        {icon}
        {title}
      </div>
      <div className="mt-1 text-xs text-slate-500">{description}</div>
    </button>
  );
}

function App() {
  const firstRunGuideSteps = [
    { key: "project", title: "先从项目管理开始", description: "第一次使用时，先在这里新建项目或切换已有项目。没有项目时，后面的步骤会保持只读。" },
    { key: "settings", title: "然后确认模型设置", description: "在这里选择火山或 FAL 模式，并把文本 / 视频 / 图片模型配好，避免流程中途卡住。" },
    { key: "nav", title: "按左侧四步主流程推进", description: "左侧只保留主流程：写剧本 → 整理角色场景 → 生成素材镜头 → 渲染合成。" },
    { key: "workspace", title: "随时看工作台状态", description: "这里会持续显示当前模式、项目、阶段和就绪状态，方便你判断下一步该做什么。" },
  ];
  const [activeMenu, setActiveMenu] = useState("project");
  const [stateFile, setStateFile] = useState("");
  const [projectName, setProjectName] = useState("我的短片项目");
  const [projectRoot, setProjectRoot] = useState("");
  const [projectList, setProjectList] = useState([]);
  const [projectSelectName, setProjectSelectName] = useState("");
  const [currentProjectType, setCurrentProjectType] = useState("short");
  const [chatTitle, setChatTitle] = useState("短片");
  const [story, setStory] = useState("");
  const [scriptSceneCount, setScriptSceneCount] = useState("3");
  const [scriptKind, setScriptKind] = useState("short");
  const [seriesTotalEpisodes, setSeriesTotalEpisodes] = useState("8");
  const [seriesCurrentEpisode, setSeriesCurrentEpisode] = useState("1");
  const [step1ScriptMode, setStep1ScriptMode] = useState("ai");
  const [step1ModePreset, setStep1ModePreset] = useState("creative");
  const [step1ShowAdvanced, setStep1ShowAdvanced] = useState(false);
  const [step1AutoProceedAfterComplete, setStep1AutoProceedAfterComplete] = useState(true);
  const [step1QualityGateEnabled, setStep1QualityGateEnabled] = useState(false);
  const [step1QualityReport, setStep1QualityReport] = useState(null);
  const [step1ShortAuditGateEnabled, setStep1ShortAuditGateEnabled] = useState(false);
  const [step1ShortAuditPlatform, setStep1ShortAuditPlatform] = useState("douyin");
  const [step1ShortAuditDuration, setStep1ShortAuditDuration] = useState("30");
  const [step1ShortAuditReport, setStep1ShortAuditReport] = useState(null);
  const [step1SafetyGateEnabled, setStep1SafetyGateEnabled] = useState(false);
  const [step1SafetyReport, setStep1SafetyReport] = useState(null);
  const [step1ChatInput, setStep1ChatInput] = useState("");
  const [step1ManualSummary, setStep1ManualSummary] = useState("");
  const [step1Messages, setStep1Messages] = useState([]);
  const [step1PendingSummary, setStep1PendingSummary] = useState("");
  const [seriesSplitConfirmed, setSeriesSplitConfirmed] = useState(false);
  const [step1Streaming, setStep1Streaming] = useState(false);
  const [step1ResolveAllProgress, setStep1ResolveAllProgress] = useState({ running: false, done: 0, total: 0, current: "" });
  const [stage2Instruction, setStage2Instruction] = useState("请提取人物细节、场景细节，并给出可用于生成分镜的文本。");
  const [running, setRunning] = useState(false);
  const [currentAction, setCurrentAction] = useState("");
  const [projectTitle, setProjectTitle] = useState("未命名项目");
  const [projectStage, setProjectStage] = useState("idle");
  const [projectNextAction, setProjectNextAction] = useState("");
  const [stage2PlanPreview, setStage2PlanPreview] = useState("");
  const [scriptResultPreview, setScriptResultPreview] = useState("");
  const [characterList, setCharacterList] = useState([]);
  const [sceneList, setSceneList] = useState([]);
  const [storyboardList, setStoryboardList] = useState([]);
  const [shotTargetCount, setShotTargetCount] = useState("12");
  const [activeFaces, setActiveFaces] = useState([]);
  const [activeScenes, setActiveScenes] = useState([]);
  const [assetRegistry, setAssetRegistry] = useState({ face: {}, scene: {} });
  const [shotsList, setShotsList] = useState([]);
  const [shotsDirty, setShotsDirty] = useState(false);
  const [seedanceEditorShotId, setSeedanceEditorShotId] = useState("");
  const [renderTaskRows, setRenderTaskRows] = useState([]);
  const [renderResults, setRenderResults] = useState([]);
  const [approvedShots, setApprovedShots] = useState([]);
  const [finalVideo, setFinalVideo] = useState("");
  const [voiceoverInfo, setVoiceoverInfo] = useState({ audio_file: "", dubbed_video: "", script: "", voice_type: "", resource_id: "" });
  const [shotInstruction, setShotInstruction] = useState("请优化该镜头的景别与动作连续性。");
  const [shotDurationSec, setShotDurationSec] = useState("5");
  const [downloadDir, setDownloadDir] = useState("videos");
  const [mergeOutput, setMergeOutput] = useState("approved_merged.mp4");
  const [renderRatio, setRenderRatio] = useState("9:16");
  const [videoSize, setVideoSize] = useState("1080x1920");
  const [assetImageSize, setAssetImageSize] = useState("1024x1024");
  const [artStyle, setArtStyle] = useState("写实电影感");
  const [faceMode, setFaceMode] = useState("full_body");
  const [sceneMode, setSceneMode] = useState("master");
  const [step3ShowAdvancedControls, setStep3ShowAdvancedControls] = useState(false);
  const [step4ShowAdvancedTools, setStep4ShowAdvancedTools] = useState(false);
  const [faceAnglePackEnabled, setFaceAnglePackEnabled] = useState(true);
  const [sceneBindCharacterAnchors, setSceneBindCharacterAnchors] = useState(true);
  const [strictSheetLayout, setStrictSheetLayout] = useState(true);
  const [assetPreview, setAssetPreview] = useState({ src: "", title: "" });
  const [assetCompare, setAssetCompare] = useState({ leftSrc: "", rightSrc: "", title: "" });
  const [videoPreview, setVideoPreview] = useState({ src: "", title: "" });
  const [assetJobKeys, setAssetJobKeys] = useState([]);
  const [shotsGenerating, setShotsGenerating] = useState(false);
  const [expandedTaskKey, setExpandedTaskKey] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [taskSearchKeyword, setTaskSearchKeyword] = useState("");
  const [taskSortMode, setTaskSortMode] = useState("shot_asc");
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState("10");
  const [selectedTaskKeys, setSelectedTaskKeys] = useState([]);
  const [retryConcurrency, setRetryConcurrency] = useState("3");
  const [retryProfile, setRetryProfile] = useState("auto");
  const [retryCount, setRetryCount] = useState("");
  const [retryWait, setRetryWait] = useState("");
  const [retryBatchRunning, setRetryBatchRunning] = useState(false);
  const [retryBatchPaused, setRetryBatchPaused] = useState(false);
  const [retryCancelRequested, setRetryCancelRequested] = useState(false);
  const [retryBatchProgress, setRetryBatchProgress] = useState({ total: 0, done: 0, success: 0, failed: 0, current: "" });
  const [journalTail, setJournalTail] = useState("200");
  const [journalEvent, setJournalEvent] = useState("");
  const [journalFormat, setJournalFormat] = useState("markdown");
  const [journalReportPayload, setJournalReportPayload] = useState(null);
  const [falKeywordPreset, setFalKeywordPreset] = useState("shortdrama-basic");
  const [falWorkflowQuery, setFalWorkflowQuery] = useState("workflow");
  const [falWorkflowKeywords, setFalWorkflowKeywords] = useState(["workflow"]);
  const [falAutoPreset, setFalAutoPreset] = useState("shortdrama-quality");
  const [activeVideoProvider, setActiveVideoProvider] = useState("ark");
  const [falApiKey, setFalApiKey] = useState("");
  const [falSavedApiKeyMasked, setFalSavedApiKeyMasked] = useState("");
  const [falVideoModel, setFalVideoModel] = useState("");
  const [falImageModel, setFalImageModel] = useState("");
  const [falModelOptions, setFalModelOptions] = useState([]);
  const [falImageModelOptions, setFalImageModelOptions] = useState([]);
  const [falModelsLoading, setFalModelsLoading] = useState(false);
  const [falPanelPayload, setFalPanelPayload] = useState(null);
  const [falApplyingModel, setFalApplyingModel] = useState("");
  const [falSmokeRenderingModel, setFalSmokeRenderingModel] = useState("");
  const [falSmokeShotId, setFalSmokeShotId] = useState("");
  const [falSmokeResult, setFalSmokeResult] = useState(null);
  const [pendingLocateShotId, setPendingLocateShotId] = useState("");
  const [locatedTaskKey, setLocatedTaskKey] = useState("");
  const [autoRefreshStep4, setAutoRefreshStep4] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState("10");
  const [initApiKey, setInitApiKey] = useState("");
  const [savedApiKeyMasked, setSavedApiKeyMasked] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectModalTab, setProjectModalTab] = useState("open");
  const [showApiKey, setShowApiKey] = useState(false);
  const [initBaseUrl, setInitBaseUrl] = useState("https://ark.cn-beijing.volces.com/api/v3");
  const [initModels, setInitModels] = useState({ text: [], image: [], video: [], audio: [] });
  const [providerOptions, setProviderOptions] = useState(["all"]);
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [modelMinParamsB, setModelMinParamsB] = useState("14");
  const [selectedModels, setSelectedModels] = useState({ text: "", image: "", video: "", audio: "" });
  const [ttsAppId, setTtsAppId] = useState("");
  const [ttsAccessToken, setTtsAccessToken] = useState("");
  const [ttsVoiceType, setTtsVoiceType] = useState("");
  const [ttsBaseUrl, setTtsBaseUrl] = useState("https://openspeech.bytedance.com/api/v3/tts/unidirectional");
  const [ttsScript, setTtsScript] = useState("");
  const [ttsApprovedOnly, setTtsApprovedOnly] = useState(true);
  const [ttsOutputFileName, setTtsOutputFileName] = useState("voiceover_narration.mp3");
  const [dubbedOutputFileName, setDubbedOutputFileName] = useState("approved_merged_dubbed.mp4");
  const [initTesting, setInitTesting] = useState(false);
  const [initStatus, setInitStatus] = useState("未测试");
  const [showInitModal, setShowInitModal] = useState(false);
  const [showFirstRunGuide, setShowFirstRunGuide] = useState(false);
  const [firstRunGuideStep, setFirstRunGuideStep] = useState(0);
  const [usageSummary, setUsageSummary] = useState({ total_estimated_cost: 0, currency: "CNY", total_calls: 0, total_tokens: 0 });
  const [lastUsageEstimate, setLastUsageEstimate] = useState({ estimated_cost: 0, currency: "CNY", calls: 0, total_tokens: 0 });
  const [result, setResult] = useState({ ok: true, code: 0, stdout: "", stderr: "" });
  const [uiNotice, setUiNotice] = useState({ type: "info", text: "" });
  const [debugEntries, setDebugEntries] = useState([]);
  const [deletingProjectStateFile, setDeletingProjectStateFile] = useState("");
  const [projectDeleteCandidate, setProjectDeleteCandidate] = useState({ stateFile: "", name: "" });
  const retryCancelRef = useRef(false);
  const retryPauseRef = useRef(false);
  const draftRestoredRef = useRef(false);
  const pendingDraftRef = useRef(null);
  const pendingLocateRefreshRef = useRef("");

  const appendDebug = useCallback((entry) => {
    setDebugEntries((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          time: new Date().toLocaleTimeString(),
          ...entry,
        },
      ];
      return next.slice(-120);
    });
  }, []);

  const copyToClipboard = useCallback(async (text, successText) => {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }
    if (!navigator?.clipboard?.writeText) {
      setUiNotice({ type: "error", text: "当前环境不支持剪贴板复制" });
      return false;
    }
    try {
      await navigator.clipboard.writeText(value);
      setUiNotice({ type: "success", text: successText || "已复制到剪贴板" });
      return true;
    } catch (error) {
      setUiNotice({ type: "error", text: `复制失败：${String(error?.message || error || "未知错误")}` });
      return false;
    }
  }, []);

  const switchVideoProviderMode = useCallback((provider) => {
    const next = String(provider || "").trim().toLowerCase() === "fal" ? "fal" : "ark";
    setActiveVideoProvider(next);
    setUiNotice({ type: "success", text: next === "fal" ? "已切换到 FAL 模式（仅使用 FAL 视频模型）" : "已切换到火山模式（使用火山视频模型）" });
  }, []);

  const withStateFile = useCallback((args = []) => {
    if (stateFile.trim()) {
      return [...args, "--state-file", stateFile.trim()];
    }
    return args;
  }, [stateFile]);

  const buildRetryArgs = useCallback(() => {
    const args = ["--retry-profile", String(retryProfile || "auto").trim() || "auto"];
    const countText = String(retryCount || "").trim();
    const waitText = String(retryWait || "").trim();
    if (countText) {
      args.push("--retry-count", countText);
    }
    if (waitText) {
      args.push("--retry-wait", waitText);
    }
    return args;
  }, [retryCount, retryProfile, retryWait]);

  const applyRetryPreset = useCallback((presetKey) => {
    const key = String(presetKey || "").trim().toLowerCase();
    if (key === "stable") {
      setRetryProfile("stable");
      setRetryCount("");
      setRetryWait("");
      return;
    }
    if (key === "aggressive") {
      setRetryProfile("aggressive");
      setRetryCount("");
      setRetryWait("");
      return;
    }
    if (key === "conservative") {
      setRetryProfile("conservative");
      setRetryCount("");
      setRetryWait("");
      return;
    }
    if (key === "auto") {
      setRetryProfile("auto");
      setRetryCount("");
      setRetryWait("");
    }
  }, []);

  const applyFalKeywordPreset = useCallback((presetKey) => {
    const key = String(presetKey || "").trim();
    const preset = falWorkflowKeywordPresets.find((item) => item.value === key);
    if (!preset) {
      return;
    }
    setFalKeywordPreset(preset.value);
    if (preset.value !== "custom") {
      setFalWorkflowQuery(String(preset.query || "").trim());
      setFalWorkflowKeywords(Array.isArray(preset.keywords) ? preset.keywords : []);
    }
  }, []);

  const renderRetryControls = useCallback(
    ({ showConcurrency = false, disablePreset = false } = {}) => (
      <>
        <div className="grid gap-2 md:grid-cols-3">
          {showConcurrency ? <Input value={retryConcurrency} onChange={(event) => setRetryConcurrency(event.target.value)} placeholder="并发数（1-10）" /> : null}
          <Input value={retryProfile} onChange={(event) => setRetryProfile(event.target.value)} placeholder="重试档位（auto/stable/aggressive/conservative）" />
          <Input value={retryCount} onChange={(event) => setRetryCount(event.target.value)} placeholder="重试次数（可空）" />
          <Input value={retryWait} onChange={(event) => setRetryWait(event.target.value)} placeholder="重试间隔秒（可空）" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => applyRetryPreset("auto")} disabled={disablePreset}>重试预设：自动</Button>
          <Button size="sm" variant="outline" onClick={() => applyRetryPreset("stable")} disabled={disablePreset}>重试预设：稳定</Button>
          <Button size="sm" variant="outline" onClick={() => applyRetryPreset("aggressive")} disabled={disablePreset}>重试预设：激进</Button>
          <Button size="sm" variant="outline" onClick={() => applyRetryPreset("conservative")} disabled={disablePreset}>重试预设：保守</Button>
        </div>
      </>
    ),
    [applyRetryPreset, retryConcurrency, retryCount, retryProfile, retryWait],
  );

  const syncStage2Plan = useCallback((plan) => {
    if (!plan || typeof plan !== "object") {
      return;
    }
    setStage2PlanPreview(JSON.stringify(plan, null, 2));
    setCharacterList(Array.isArray(plan.characters) ? plan.characters : []);
    setSceneList(Array.isArray(plan.scenes) ? plan.scenes : []);
    setStoryboardList(Array.isArray(plan.storyboard_text) ? plan.storyboard_text : []);
  }, []);

  const syncFromStatePayload = useCallback((payload) => {
    const root = payload?.state || payload;
    const status = payload?.status || {};
    const titleValue = String(root?.title || status?.title || "").trim();
    const stageValue = String(status?.stage || root?.workflow?.stage || "").trim();
    const nextAction = String(status?.next_action || root?.workflow?.next_action || "").trim();
    const incomingStateFile = String(payload?.state_file || "").trim();
    const currentStateFile = String(stateFile || "").trim();
    const switchedProject = Boolean(
      incomingStateFile
      && currentStateFile
      && normalizeStatePath(incomingStateFile) !== normalizeStatePath(currentStateFile),
    );
    const hasStateSnapshot = Boolean(
      payload?.state
      || incomingStateFile
      || root?.workflow
      || root?.project_root
      || root?.project_type
      || root?.story !== undefined,
    );
    if (titleValue) {
      setProjectTitle(titleValue);
    }
    if (stageValue) {
      setProjectStage(stageValue);
    }
    setProjectNextAction(nextAction);
    if (incomingStateFile) {
      setStateFile(incomingStateFile);
    }
    if (hasStateSnapshot) {
      setStory(String(root?.story ?? payload?.story ?? ""));
    }
    const summaryFromState = String(
      root?.story_summary
      ?? payload?.story_summary
      ?? root?.summary
      ?? payload?.summary
      ?? "",
    ).trim();
    if (summaryFromState) {
      setStep1ManualSummary(summaryFromState);
      setStep1PendingSummary(summaryFromState);
    } else if (switchedProject) {
      setStep1ManualSummary("");
      setStep1PendingSummary("");
    }
    const projectTypeValue = String(root?.project_type || payload?.project_type || "").trim().toLowerCase();
    if (projectTypeValue === "series" || projectTypeValue === "short") {
      setCurrentProjectType(projectTypeValue);
      setScriptKind(projectTypeValue);
    }
    const episodeIndexRaw = Number(root?.episode_index ?? payload?.episode_index ?? 0);
    if (episodeIndexRaw > 0) {
      setSeriesCurrentEpisode(String(Math.max(1, Math.floor(episodeIndexRaw))));
    }
    const planPayload = root?.stage2_plan || payload?.stage2_plan;
    if (planPayload && typeof planPayload === "object") {
      syncStage2Plan(planPayload);
    } else if (switchedProject) {
      setStage2PlanPreview("");
      setCharacterList([]);
      setSceneList([]);
      setStoryboardList([]);
    }
    if (Array.isArray(payload?.projects)) {
      setProjectList(payload.projects);
    }
    if (Array.isArray(payload?.beats)) {
      setScriptResultPreview(JSON.stringify(payload.beats, null, 2));
    }
    if (Array.isArray(payload?.script_scenes)) {
      setScriptResultPreview(JSON.stringify(payload.script_scenes, null, 2));
    }
    if (Array.isArray(payload?.shots) && payload?.step !== "script_stage_ready") {
      setScriptResultPreview(JSON.stringify(payload.shots, null, 2));
    } else if (switchedProject && !Array.isArray(payload?.beats) && !Array.isArray(payload?.script_scenes)) {
      setScriptResultPreview("");
    }
    if (root?.assets && typeof root.assets === "object") {
      setActiveFaces(Array.isArray(root.assets.faces) ? root.assets.faces : []);
      setActiveScenes(Array.isArray(root.assets.scenes) ? root.assets.scenes : []);
    } else if (switchedProject) {
      setActiveFaces([]);
      setActiveScenes([]);
    }
    if (root?.asset_registry && typeof root.asset_registry === "object") {
      setAssetRegistry({
        face: root?.asset_registry?.face && typeof root.asset_registry.face === "object" ? root.asset_registry.face : {},
        scene: root?.asset_registry?.scene && typeof root.asset_registry.scene === "object" ? root.asset_registry.scene : {},
      });
    } else if (payload?.registry && typeof payload.registry === "object") {
      setAssetRegistry({
        face: payload?.registry?.face && typeof payload.registry.face === "object" ? payload.registry.face : {},
        scene: payload?.registry?.scene && typeof payload.registry.scene === "object" ? payload.registry.scene : {},
      });
    } else if (switchedProject) {
      setAssetRegistry({ face: {}, scene: {} });
    }
    if (Array.isArray(root?.shots)) {
      setShotsList(root.shots);
      setShotsDirty(false);
    } else if (switchedProject) {
      setShotsList([]);
      setShotsDirty(false);
    }
    if (Array.isArray(payload?.tasks)) {
      setRenderTaskRows(payload.tasks);
    } else if (switchedProject) {
      setRenderTaskRows([]);
    }
    if (Array.isArray(root?.render_results)) {
      setRenderResults(root.render_results);
    } else if (switchedProject) {
      setRenderResults([]);
    }
    if (Array.isArray(root?.approved_shots)) {
      setApprovedShots(root.approved_shots);
    } else if (switchedProject) {
      setApprovedShots([]);
    }
    if (payload?.result && typeof payload.result === "object") {
      const item = payload.result;
      if (item.shot_id) {
        setRenderResults((prev) => {
          const list = prev.filter((x) => String(x?.shot_id || "") !== String(item.shot_id));
          list.push(item);
          return list;
        });
      }
    }
    if (payload?.results && Array.isArray(payload.results)) {
      setRenderResults(payload.results);
    }
    if (payload?.output_file) {
      setFinalVideo(String(payload.output_file));
    }
    if (root?.final_video) {
      setFinalVideo(String(root.final_video));
    } else if (switchedProject) {
      setFinalVideo("");
    }
    if (root?.voiceover && typeof root.voiceover === "object") {
      setVoiceoverInfo({
        audio_file: String(root.voiceover.audio_file || ""),
        dubbed_video: String(root.voiceover.dubbed_video || ""),
        script: String(root.voiceover.script || ""),
        voice_type: String(root.voiceover.voice_type || ""),
        resource_id: String(root.voiceover.resource_id || ""),
      });
      if (!ttsScript.trim() && String(root.voiceover.script || "").trim()) {
        setTtsScript(String(root.voiceover.script || ""));
      }
    } else if (switchedProject) {
      setVoiceoverInfo({ audio_file: "", dubbed_video: "", script: "", voice_type: "", resource_id: "" });
    }
    if (root?.usage_cost_summary && typeof root.usage_cost_summary === "object") {
      setUsageSummary((prev) => ({
        total_estimated_cost: Number(root.usage_cost_summary.total_estimated_cost ?? prev.total_estimated_cost ?? 0),
        currency: String(root.usage_cost_summary.currency || prev.currency || "CNY"),
        total_calls: Number(root.usage_cost_summary.total_calls ?? prev.total_calls ?? 0),
        total_tokens: Number(root.usage_cost_summary.total_tokens ?? prev.total_tokens ?? 0),
      }));
    }
    if (payload?.usage_estimate && typeof payload.usage_estimate === "object") {
      setLastUsageEstimate({
        estimated_cost: Number(payload.usage_estimate.estimated_cost ?? 0),
        currency: String(payload.usage_estimate.currency || "CNY"),
        calls: Number(payload.usage_estimate.calls ?? 0),
        total_tokens: Number(payload.usage_estimate.total_tokens ?? 0),
      });
      setUsageSummary((prev) => ({
        total_estimated_cost: Number(prev.total_estimated_cost ?? 0) + Number(payload.usage_estimate.estimated_cost ?? 0),
        currency: String(payload.usage_estimate.currency || prev.currency || "CNY"),
        total_calls: Number(prev.total_calls ?? 0) + Number(payload.usage_estimate.calls ?? 0),
        total_tokens: Number(prev.total_tokens ?? 0) + Number(payload.usage_estimate.total_tokens ?? 0),
      }));
    }
  }, [stateFile, syncStage2Plan, ttsScript]);

  const executeCli = useCallback(async (actionName, command, args, options = {}) => {
    const startedAt = Date.now();
    if (!window.openvshot?.runCli) {
      setResult({
        ok: false,
        code: -1,
        stdout: "",
        stderr: "未检测到 Electron 预加载桥接，请使用 npm run dev 启动桌面模式。",
      });
      appendDebug({ level: "error", action: actionName, command, args, message: "未检测到 Electron 预加载桥接" });
      return;
    }
    appendDebug({ level: "info", action: actionName, command, args, message: "开始执行" });
    setRunning(true);
    setCurrentAction(actionName);
    try {
      const response = await window.openvshot.runCli({
        command,
        args,
        jsonMode: true,
        timeoutMs: 180000,
      });
      setResult(response);
      const payload = parsePayload(response.stdout);
      if (response.ok && payload && payload.ok) {
        syncFromStatePayload(payload);
        if (!options.silentSuccess) {
          setUiNotice({ type: "success", text: `${actionName}成功` });
        }
        appendDebug({
          level: "success",
          action: actionName,
          command,
          args,
          elapsedMs: Date.now() - startedAt,
          code: response.code,
          message: "执行成功",
        });
        return payload;
      }
      const errorSummary = summarizeError(response, payload);
      setActiveMenu("logs");
      setUiNotice({ type: "error", text: `${actionName}失败：${errorSummary}` });
      appendDebug({
        level: "error",
        action: actionName,
        command,
        args,
        elapsedMs: Date.now() - startedAt,
        code: response.code,
        stderr: response.stderr,
        stdout: response.stdout,
        payload,
        message: `执行失败：${errorSummary}`,
      });
      if (payload && payload.ok === false) {
        return payload;
      }
      return payload;
    } catch (error) {
      setResult({
        ok: false,
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
      setActiveMenu("logs");
      setUiNotice({ type: "error", text: `${actionName}异常：${error instanceof Error ? error.message : String(error)}` });
      appendDebug({
        level: "error",
        action: actionName,
        command,
        args,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      setRunning(false);
      setCurrentAction("");
    }
  }, [appendDebug, syncFromStatePayload]);

  const executeCliConcurrent = useCallback(async (actionName, command, args, options = {}) => {
    const startedAt = Date.now();
    if (!window.openvshot?.runCli) {
      setUiNotice({ type: "error", text: "未检测到桌面桥接，请重启应用" });
      return null;
    }
    appendDebug({ level: "info", action: actionName, command, args, message: "开始执行" });
    try {
      const response = await window.openvshot.runCli({
        command,
        args,
        jsonMode: true,
        timeoutMs: 180000,
      });
      setResult(response);
      const payload = parsePayload(response.stdout);
      if (response.ok && payload && payload.ok) {
        syncFromStatePayload(payload);
        if (!options.silentSuccess) {
          setUiNotice({ type: "success", text: `${actionName}成功` });
        }
        appendDebug({ level: "success", action: actionName, command, args, elapsedMs: Date.now() - startedAt, code: response.code, message: "执行成功" });
        return payload;
      }
      const errorSummary = summarizeError(response, payload);
      setUiNotice({ type: "error", text: `${actionName}失败：${errorSummary}` });
      appendDebug({ level: "error", action: actionName, command, args, elapsedMs: Date.now() - startedAt, code: response.code, stderr: response.stderr, stdout: response.stdout, payload, message: `执行失败：${errorSummary}` });
      return payload;
    } catch (error) {
      setUiNotice({ type: "error", text: `${actionName}异常：${error instanceof Error ? error.message : String(error)}` });
      appendDebug({ level: "error", action: actionName, command, args, elapsedMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }, [appendDebug, syncFromStatePayload]);

  const runCliQuiet = useCallback(async (command, args = []) => {
    if (!window.openvshot?.runCli) {
      return null;
    }
    const response = await window.openvshot.runCli({
      command,
      args,
      jsonMode: true,
      timeoutMs: 120000,
    });
    const payload = parsePayload(response.stdout);
    if (response.ok && payload?.ok) {
      syncFromStatePayload(payload);
      return payload;
    }
    return payload;
  }, [syncFromStatePayload]);

  const requestAiSuggestion = useCallback(
    async ({ kind, text, context = "", onApply, successText = "已填入AI建议" }) => {
      const sourceText = String(text || "").trim();
      if (!sourceText) {
        setUiNotice({ type: "info", text: "请先输入一些内容，再使用AI建议" });
        return null;
      }
      const payload = await executeCliConcurrent(
        "AI建议",
        "prompt-suggest",
        withStateFile(["--kind", String(kind || "generic"), "--text", sourceText, "--context", String(context || "")]),
        { silentSuccess: true },
      );
      const suggestion = String(payload?.suggestion || "").trim();
      if (!suggestion) {
        setUiNotice({ type: "error", text: "AI建议生成失败，请重试" });
        return null;
      }
      if (typeof onApply === "function") {
        onApply(suggestion);
      }
      setUiNotice({ type: "success", text: successText });
      return suggestion;
    },
    [executeCliConcurrent, withStateFile],
  );

  useEffect(() => {
    if (!uiNotice.text) {
      return;
    }
    const timer = setTimeout(() => setUiNotice({ type: "info", text: "" }), 4000);
    return () => clearTimeout(timer);
  }, [uiNotice]);

  useEffect(() => {
    if (activeMenu === "project") {
      const hasActiveProject = projectTitle !== "未命名项目" || stateFile.trim().length > 0;
      setProjectModalTab(hasActiveProject ? "open" : "create");
      setShowProjectModal(true);
    }
  }, [activeMenu, projectTitle, stateFile]);

  useEffect(() => {
    if (showProjectModal) {
      const hasActiveProject = projectTitle !== "未命名项目" || stateFile.trim().length > 0;
      setProjectModalTab(hasActiveProject ? "open" : "create");
    }
  }, [projectTitle, showProjectModal, stateFile]);

  function getStepDone(stepKey) {
    const currentIndex = workflowSteps.findIndex((step) => step.stages.includes(projectStage));
    const stepIndex = workflowSteps.findIndex((step) => step.key === stepKey);
    return currentIndex >= 0 && stepIndex >= 0 && stepIndex <= currentIndex;
  }

  const hasProject = projectTitle !== "未命名项目" || stateFile.trim().length > 0;
  const canCreateNextEpisode = currentProjectType === "series" && stateFile.trim().length > 0;
  const normalizedSceneCount = Math.max(1, Math.min(8, Number(scriptSceneCount) || 0));
  const step1StoryText = String(story || "").trim();
  const step1LineCount = step1StoryText.split(/\r?\n/).filter((line) => String(line || "").trim()).length;
  const step1MinChars = Math.max(120, scriptKind === "series" ? 180 : 120, normalizedSceneCount * 55);
  const step1MinLines = Math.min(8, Math.max(2, Math.ceil(normalizedSceneCount * 0.8)));
  const step1CharsReady = step1StoryText.length >= step1MinChars;
  const step1LinesReady = step1LineCount >= step1MinLines;
  const step1StoryReady = step1CharsReady && step1LinesReady;
  const step1SceneReady = normalizedSceneCount >= 1 && normalizedSceneCount <= 8;
  const step1EpisodeReady = scriptKind !== "series" || Math.max(1, Number(seriesCurrentEpisode) || 0) >= 1;
  const step1BaseReady = step1StoryReady && step1SceneReady && step1EpisodeReady;
  const step1CharsProgress = Math.max(0, Math.min(100, Math.round((step1StoryText.length / Math.max(1, step1MinChars)) * 100)));
  const step1LinesProgress = Math.max(0, Math.min(100, Math.round((step1LineCount / Math.max(1, step1MinLines)) * 100)));
  const step1NeedChars = Math.max(0, step1MinChars - step1StoryText.length);
  const step1NeedLines = Math.max(0, step1MinLines - step1LineCount);
  const step1AdviceText = step1BaseReady
    ? "已达到进入第二步条件，可以继续。"
    : `建议补充：${step1NeedChars > 0 ? `再补 ${step1NeedChars} 字` : "字数已达标"}，${step1NeedLines > 0 ? `再分 ${step1NeedLines} 段` : "分段已达标"}。`;
  const step1GateSignals = [
    {
      key: "quality",
      label: "结构门控",
      enabled: step1QualityGateEnabled,
      report: step1QualityReport,
      metric: step1QualityReport ? `总分 ${Number(step1QualityReport.total || 0)}` : "",
    },
    {
      key: "shortvideo",
      label: "运营门控",
      enabled: step1ShortAuditGateEnabled,
      report: step1ShortAuditReport,
      metric: step1ShortAuditReport ? `总分 ${Number(step1ShortAuditReport.total || 0)}` : "",
    },
    {
      key: "safety",
      label: "安全门控",
      enabled: step1SafetyGateEnabled,
      report: step1SafetyReport,
      metric: step1SafetyReport ? `风险 ${String(step1SafetyReport.risk_level || "unknown")}` : "",
    },
  ];
  const step1GatePassCount = step1GateSignals.filter((item) => item.enabled && item.report && item.report.pass).length;
  const step1GateEnabledCount = step1GateSignals.filter((item) => item.enabled).length;
  const step1BaseBlockers = [];
  if (!step1CharsReady) {
    step1BaseBlockers.push({ key: "base_chars", label: "剧本字数未达标", actionText: "一键补全剧本" });
  }
  if (!step1LinesReady) {
    step1BaseBlockers.push({ key: "base_lines", label: "剧本分段未达标", actionText: "一键补全剧本" });
  }
  if (!step1SceneReady) {
    step1BaseBlockers.push({ key: "base_scene_count", label: "场景数未确认", actionText: "一键补全剧本" });
  }
  if (!step1EpisodeReady) {
    step1BaseBlockers.push({ key: "base_episode", label: "当前集数未设置", actionText: "设置当前集数" });
  }
  const step1GateBlockers = step1GateSignals
    .filter((item) => item.enabled && (!item.report || !item.report.pass))
    .map((item) => ({
      key: `${item.key}_${!item.report ? "pending" : "failed"}`,
      label: `${item.label}${!item.report ? "未检测" : "未通过"}`,
      actionText: `${item.label}立即处理`,
    }));
  const step1FinishBlockers = [...step1BaseBlockers, ...step1GateBlockers];
  const step1FinishDisabled = running || step1FinishBlockers.length > 0;
  const step1PrimaryBlocker = step1FinishBlockers[0] || null;
  const step1DurationSec = Math.max(5, Math.min(180, Number(step1ShortAuditDuration) || 30));
  const step1PlatformBaseTemplateText =
    step1ShortAuditPlatform === "shipinhao"
      ? `平台模板：视频号；目标时长约${step1DurationSec}秒。要求信息可信、叙事稳定、字幕密度中等，结尾给出明确行动建议。`
      : step1ShortAuditPlatform === "bilibili"
        ? `平台模板：B站；目标时长约${step1DurationSec}秒。要求叙事完整、梗点有铺垫回收，节奏先抑后扬，结尾保留讨论空间。`
        : `平台模板：抖音；目标时长约${step1DurationSec}秒。要求前三秒强钩子、快节奏推进、字幕高密度，结尾强CTA。`;
  const step1ScriptKindTemplateText = scriptKind === "series"
    ? "当前脚本类型：连续剧短剧。请强化单集目标、集尾悬念和下一集引子，避免一集讲完所有信息。"
    : "当前脚本类型：单集短片。请保证起承转合完整，结尾完成一次明确回扣。";
  const step1PlatformTemplateText = `${step1PlatformBaseTemplateText} ${step1ScriptKindTemplateText}`;

  const hasModelSetup =
    activeVideoProvider === "fal"
      ? String(falVideoModel || "").trim().length > 0 && String(falImageModel || "").trim().length > 0 && (String(falApiKey || "").trim().length > 0 || String(falSavedApiKeyMasked || "").trim().length > 0)
      : String(selectedModels.text || "").trim().length > 0 && String(selectedModels.video || "").trim().length > 0;
  const falImageReady = String(falImageModel || "").trim().length > 0;
  const falModeReady = String(falVideoModel || "").trim().length > 0 && (String(falApiKey || "").trim().length > 0 || String(falSavedApiKeyMasked || "").trim().length > 0);
  const activeVideoModelId = String(activeVideoProvider === "fal" ? falVideoModel : selectedModels.video || "").trim();
  const isSeedanceModel = /seedance/i.test(activeVideoModelId);
  const providerReadyText = activeVideoProvider === "fal"
    ? `密钥 ${String(falSavedApiKeyMasked || falApiKey || "").trim() ? "已就绪" : "未配置"} / 视频模型 ${String(falVideoModel || "").trim() ? "已选" : "未选"} / 图片模型 ${String(falImageModel || "").trim() ? "已选" : "未选"}`
    : `火山文本 ${String(selectedModels.text || "").trim() ? "已选" : "未选"} / 火山视频 ${String(selectedModels.video || "").trim() ? "已选" : "未选"}`;
  const projectModalStatusCards = [
    { key: "provider", label: "当前模式", value: activeVideoProvider === "fal" ? "FAL 模式" : "火山模式" },
    { key: "project", label: "当前项目", value: hasProject ? projectTitle : "未创建项目" },
    { key: "stage", label: "当前阶段", value: projectStage || "idle" },
    { key: "ready", label: "模型就绪", value: hasModelSetup ? "已就绪" : "未完成" },
  ];
  const step1StatusCards = [
    { key: "kind", label: "剧本类型", value: scriptKind === "series" ? "连续剧短剧" : "单集短片" },
    { key: "scene", label: "目标场景数", value: String(normalizedSceneCount) },
    { key: "episode", label: "当前集数", value: scriptKind === "series" ? String(Math.max(1, Number(seriesCurrentEpisode) || 1)) : "单集" },
    { key: "ready", label: "进入下一步", value: step1FinishDisabled ? "仍有卡点" : "可进入" },
  ];
  const step2StatusCards = [
    { key: "characters", label: "角色卡片", value: String(characterList.length) },
    { key: "scenes", label: "场景卡片", value: String(sceneList.length) },
    { key: "storyboards", label: "分镜文本", value: String(storyboardList.length) },
    { key: "shotTarget", label: "镜头上限", value: String(Math.max(0, Number(shotTargetCount) || 0) || "不限") },
  ];
  const step3StatusCards = [
    { key: "characters", label: "角色数", value: String(characterList.length) },
    { key: "scenes", label: "场景数", value: String(sceneList.length) },
    { key: "storyboards", label: "分镜文本", value: String(storyboardList.length) },
    { key: "shots", label: "镜头数", value: String(shotsList.length) },
  ];
  const providerPromptConstraint =
    isSeedanceModel
      ? "约束：按主体/动作/镜头/风格/画质后缀五模块组织；只保留一个主动作；不要写否定提示词；有参考图时优先锁定第一张；单镜头时长建议不超过 15 秒。"
      : activeVideoProvider === "fal"
      ? "约束：保持角色一致、镜头连续、无水印无额外字幕、动作自然不过快、禁止多角色脸部错位。"
      : "约束：保持角色一致、镜头连续、无水印无额外字幕、动作自然、避免过度运镜和闪烁。";
  const seedanceUseImageRefs = activeFaces.length > 0 || activeScenes.length > 0;
  const seedancePromptChecks = isSeedanceModel
    ? shotsList.map((shot, index) => ({
      shotId: String(shot?.shot_id || `S${String(index + 1).padStart(2, "0")}`),
      ...validateSeedancePrompt(String(shot?.visual_prompt || ""), seedanceUseImageRefs),
    }))
    : [];
  const seedancePromptOkCount = seedancePromptChecks.filter((item) => item.ok).length;
  const seedancePromptWarnCount = seedancePromptChecks.filter((item) => !item.ok).length;
  const continuityCharacterNames = characterList.map((item, index) => String(item?.name || "").trim() || `角色${index + 1}`).filter(Boolean);
  const shotContinuityChecks = shotsList
    .slice(1)
    .map((shot, index) => {
      const previousShot = buildShotContinuitySnapshot(shotsList[index], index, continuityCharacterNames);
      const currentShot = buildShotContinuitySnapshot(shot, index + 1, continuityCharacterNames);
      return {
        fromShotId: previousShot.shotId,
        toShotId: currentShot.shotId,
        warnings: compareShotContinuity(previousShot, currentShot),
      };
    })
    .filter((item) => item.warnings.length > 0);
  const effectiveShotInstruction = `${String(shotInstruction || "").trim() || "请优化镜头"} ${providerPromptConstraint}`.trim();
  const normalizedRootPreview = projectRoot.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const normalizedProjectNamePreview = (projectName.trim() || "my-short-project").replace(/[\\/]/g, "_");
  const projectStatePathPreview = normalizedRootPreview
    ? `${normalizedRootPreview}/${normalizedProjectNamePreview}/.openvshot/state.json`
    : stateFile.trim() || "选择项目目录后自动生成";
  const parsedSummary = parsePayload(scriptResultPreview);
  const episodeSummaryCards = toEpisodeSummaryCards(parsedSummary);

  const fetchVolcModels = useCallback(async ({ saveCredentials, allowStoredKey = false }) => {
    const apiKeyValue = initApiKey.trim();
    if (!apiKeyValue && !allowStoredKey && !savedApiKeyMasked.trim()) {
      setInitStatus("请先填写 ARK_API_KEY 再测试连接");
      return null;
    }
    const args = [];
    if (apiKeyValue && apiKeyValue !== savedApiKeyMasked.trim()) {
      args.push("--ark-api-key", apiKeyValue);
    }
    if (initBaseUrl.trim()) {
      args.push("--ark-base-url", initBaseUrl.trim());
    }
    args.push("--provider", modelProviderFilter.trim() || "all");
    args.push("--min-params-b", modelMinParamsB.trim() || "0");
    if (saveCredentials) {
      args.push("--save-credentials");
    }
    setInitTesting(true);
    const payload = await executeCli("测试火山连接并获取模型", "volc-models", args);
    setInitTesting(false);
    if (!payload?.ok) {
      setInitStatus(payload?.error ? `失败：${payload.error}` : "失败：无法连接或配置错误");
      return null;
    }
    const groups = payload.grouped_models && typeof payload.grouped_models === "object" ? payload.grouped_models : { text: [], image: [], video: [], audio: [] };
    setInitModels({
      text: Array.isArray(groups.text) ? groups.text : [],
      image: Array.isArray(groups.image) ? groups.image : [],
      video: Array.isArray(groups.video) ? groups.video : [],
      audio: Array.isArray(groups.audio) ? groups.audio : [],
    });
    const providerList = Array.isArray(payload.provider_options) ? payload.provider_options : [];
    setProviderOptions(["all", ...providerList.filter((x) => String(x || "").trim())]);
    const selected = payload.selected_models && typeof payload.selected_models === "object" ? payload.selected_models : {};
    setSelectedModels((prev) => ({
      text: String(selected.text || prev.text || (groups.text?.[0]?.id ?? "")).trim(),
      image: String(selected.image || prev.image || (groups.image?.[0]?.id ?? "")).trim(),
      video: String(selected.video || prev.video || (groups.video?.[0]?.id ?? "")).trim(),
      audio: String(selected.audio || prev.audio || (groups.audio?.[0]?.id ?? "")).trim(),
    }));
    const ttsSettings = payload.tts_settings && typeof payload.tts_settings === "object" ? payload.tts_settings : {};
    if (String(ttsSettings.app_id || "").trim()) {
      setTtsAppId(String(ttsSettings.app_id || "").trim());
    }
    if (String(ttsSettings.voice_type || "").trim()) {
      setTtsVoiceType(String(ttsSettings.voice_type || "").trim());
    }
    if (String(ttsSettings.base_url || "").trim()) {
      setTtsBaseUrl(String(ttsSettings.base_url || "").trim());
    }
    const base = String(payload?.connection?.base_url || "").trim();
    if (base) {
      setInitBaseUrl(base);
    }
    const masked = String(payload?.connection?.api_key_masked || "").trim();
    if (masked) {
      setSavedApiKeyMasked(masked);
    }
    setInitStatus("连接成功，模型已刷新");
    return payload;
  }, [executeCli, initApiKey, initBaseUrl, modelMinParamsB, modelProviderFilter, savedApiKeyMasked]);

  const refreshFalModelOptions = useCallback(async () => {
    const keyValue = String(falApiKey || "").trim();
    if (!keyValue && !String(falSavedApiKeyMasked || "").trim()) {
      setInitStatus("请先填写 FAL_API_KEY 再刷新 FAL 模型");
      return null;
    }
    setFalModelsLoading(true);
    const commonArgs = [];
    if (keyValue && keyValue !== String(falSavedApiKeyMasked || "").trim()) {
      commonArgs.push("--fal-api-key", keyValue);
    }
    const videoPayload = await executeCli(
      "刷新 FAL 视频模型列表",
      "fal-workflow-list",
      ["--source", "api", "--query", "video text-to-video", "--max-pages", "5", ...commonArgs, ...buildRetryArgs()],
      { silentSuccess: true },
    );
    const imagePayload = await executeCli(
      "刷新 FAL 图片模型列表",
      "fal-workflow-list",
      ["--source", "api", "--query", "image text-to-image", "--max-pages", "5", ...commonArgs, ...buildRetryArgs()],
      { silentSuccess: true },
    );
    setFalModelsLoading(false);
    if (!videoPayload?.ok && !imagePayload?.ok) {
      const errorText = String(videoPayload?.error || imagePayload?.error || "").trim();
      setInitStatus(errorText ? `FAL 模型刷新失败：${errorText}` : "FAL 模型刷新失败");
      return null;
    }
    const videoEndpoints = Array.isArray(videoPayload?.endpoints) ? videoPayload.endpoints.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const imageEndpoints = Array.isArray(imagePayload?.endpoints) ? imagePayload.endpoints.map((item) => String(item || "").trim()).filter(Boolean) : [];
    setFalModelOptions(videoEndpoints);
    setFalImageModelOptions(imageEndpoints);
    if (videoEndpoints.length > 0 && !String(falVideoModel || "").trim()) {
      setFalVideoModel(videoEndpoints[0]);
    }
    if (imageEndpoints.length > 0 && !String(falImageModel || "").trim()) {
      setFalImageModel(imageEndpoints[0]);
    }
    setInitStatus(`FAL 模型已刷新（视频 ${videoEndpoints.length}，图片 ${imageEndpoints.length}）`);
    return { ok: true, video_count: videoEndpoints.length, image_count: imageEndpoints.length };
  }, [buildRetryArgs, executeCli, falApiKey, falImageModel, falSavedApiKeyMasked, falVideoModel]);

  const saveModelSettings = useCallback(async () => {
    const args = [];
    if (initApiKey.trim() && initApiKey.trim() !== savedApiKeyMasked.trim()) {
      args.push("--ark-api-key", initApiKey.trim());
    }
    if (initBaseUrl.trim()) {
      args.push("--ark-base-url", initBaseUrl.trim());
    }
    if (falApiKey.trim() && falApiKey.trim() !== String(falSavedApiKeyMasked || "").trim()) {
      args.push("--fal-api-key", falApiKey.trim());
    }
    args.push("--video-provider", activeVideoProvider === "fal" ? "fal" : "ark");
    if (selectedModels.text.trim()) {
      args.push("--text-model", selectedModels.text.trim());
    }
    if (selectedModels.image.trim()) {
      args.push("--image-model", selectedModels.image.trim());
    }
    if (selectedModels.audio.trim()) {
      args.push("--audio-model", selectedModels.audio.trim());
    }
    if (ttsAppId.trim()) {
      args.push("--tts-app-id", ttsAppId.trim());
    }
    if (ttsAccessToken.trim()) {
      args.push("--tts-access-token", ttsAccessToken.trim());
    }
    if (ttsVoiceType.trim()) {
      args.push("--tts-voice-type", ttsVoiceType.trim());
    }
    if (ttsBaseUrl.trim()) {
      args.push("--tts-base-url", ttsBaseUrl.trim());
    }
    if (activeVideoProvider === "fal") {
      if (falVideoModel.trim()) {
        args.push("--fal-video-model", falVideoModel.trim());
      }
      if (falImageModel.trim()) {
        args.push("--fal-image-model", falImageModel.trim());
      }
    } else if (selectedModels.video.trim()) {
      args.push("--video-model", selectedModels.video.trim());
    }
    const payload = await executeCli("保存模型配置", "config-set", args);
    if (payload?.ok) {
      setInitStatus("配置已保存");
      const arkMasked = String(payload?.saved?.ARK_API_KEY || "").trim();
      if (arkMasked) {
        setSavedApiKeyMasked(arkMasked);
      }
      const falMasked = String(payload?.saved?.FAL_API_KEY || "").trim();
      if (falMasked) {
        setFalSavedApiKeyMasked(falMasked);
        if (falApiKey.trim()) {
          setFalApiKey("");
        }
      }
      const savedTtsAppId = String(payload?.saved?.VOLC_TTS_APP_ID || "").trim();
      if (savedTtsAppId) {
        setTtsAppId(savedTtsAppId);
      }
      const savedTtsVoiceType = String(payload?.saved?.VOLC_TTS_VOICE_TYPE || "").trim();
      if (savedTtsVoiceType) {
        setTtsVoiceType(savedTtsVoiceType);
      }
      const savedTtsBaseUrl = String(payload?.saved?.VOLC_TTS_BASE_URL || "").trim();
      if (savedTtsBaseUrl) {
        setTtsBaseUrl(savedTtsBaseUrl);
      }
      const savedTtsTokenMasked = String(payload?.saved?.VOLC_TTS_ACCESS_TOKEN || "").trim();
      if (savedTtsTokenMasked && ttsAccessToken.trim()) {
        setTtsAccessToken("");
      }
      localStorage.setItem("openvshot_init_seen", "1");
      setShowInitModal(false);
      if (stateFile.trim() || hasProject || projectRoot.trim()) {
        await executeCli("读取项目状态", "session-state", withStateFile([]));
        setActiveMenu("step1");
      } else {
        setActiveMenu("project");
      }
      setUiNotice({ type: "success", text: `初始化设置已保存（视频提供商：${activeVideoProvider === "fal" ? "FAL" : "火山"}）` });
    } else {
      setInitStatus(payload?.error ? `保存失败：${payload.error}` : "保存失败");
    }
  }, [activeVideoProvider, executeCli, falApiKey, falImageModel, falSavedApiKeyMasked, falVideoModel, hasProject, initApiKey, initBaseUrl, projectRoot, savedApiKeyMasked, selectedModels.audio, selectedModels.image, selectedModels.text, selectedModels.video, stateFile, ttsAccessToken, ttsAppId, ttsBaseUrl, ttsVoiceType, withStateFile]);

  function modelOptionLabel(row) {
    return String(row?.id || "");
  }

  async function pickProjectDirectory() {
    if (!window.openvshot?.pickDirectory) {
      setResult({
        ok: false,
        code: -1,
        stdout: "",
        stderr: "当前窗口未加载目录选择能力，请重启桌面端应用后再试。",
      });
      appendDebug({ level: "error", action: "选择项目目录", command: "dialog:pick-directory", message: "未加载目录选择能力" });
      return;
    }
    const result = await window.openvshot.pickDirectory();
    if (result?.canceled) {
      appendDebug({ level: "info", action: "选择项目目录", command: "dialog:pick-directory", message: "用户取消选择" });
      return;
    }
    const selectedPath = String(result?.path || "").trim();
    if (selectedPath) {
      setProjectRoot(selectedPath);
      appendDebug({ level: "success", action: "选择项目目录", command: "dialog:pick-directory", message: selectedPath });
    }
  }

  async function openDevtools() {
    if (!window.openvshot?.openDevtools) {
      setUiNotice({ type: "error", text: "当前窗口不支持打开开发者工具，请重启桌面端" });
      return;
    }
    const res = await window.openvshot.openDevtools();
    if (!res?.ok) {
      setUiNotice({ type: "error", text: res?.message || "打开开发者工具失败" });
      return;
    }
    setUiNotice({ type: "success", text: "已打开开发者工具窗口" });
  }

  const closeProjectModal = useCallback(() => {
    setShowProjectModal(false);
    if (activeMenu === "project") {
      setActiveMenu("step1");
    }
  }, [activeMenu]);

  const deleteProject = useCallback(async (item) => {
    const targetStateFile = String(item?.state_file || "").trim();
    const targetName = String(item?.name || "").trim() || "未命名项目";
    if (!targetStateFile || running) {
      return;
    }
    setProjectDeleteCandidate({ stateFile: targetStateFile, name: targetName });
  }, [running]);

  const confirmDeleteProject = useCallback(async () => {
    const targetStateFile = String(projectDeleteCandidate.stateFile || "").trim();
    if (!targetStateFile || running) {
      return;
    }
    setProjectDeleteCandidate({ stateFile: "", name: "" });
    setDeletingProjectStateFile(targetStateFile);
    const payload = await executeCli("删除项目", "project-delete", ["--state-file", targetStateFile, "--remove-files"]);
    setDeletingProjectStateFile("");
    if (!payload?.ok) {
      return;
    }
    const listPayload = await runCliQuiet("project-list", []);
    if (Array.isArray(listPayload?.projects)) {
      setProjectList(listPayload.projects);
    }
    if (stateFile.trim() === targetStateFile) {
      setStateFile("");
      setProjectTitle("未命名项目");
      setProjectStage("idle");
      setProjectNextAction("");
      setActiveMenu("project");
      setProjectModalTab("create");
      setShowProjectModal(true);
    }
  }, [executeCli, projectDeleteCandidate.stateFile, runCliQuiet, running, stateFile]);


  async function streamScriptToUi(scriptText, assistantId) {
    const full = String(scriptText || "");
    if (!full.trim()) {
      return;
    }
    setStep1Streaming(true);
    await new Promise((resolve) => {
      let index = 0;
      const step = Math.max(12, Math.floor(full.length / 120));
      const timer = setInterval(() => {
        index = Math.min(full.length, index + step);
        const partial = full.slice(0, index);
        setStory(partial);
        setStep1Messages((prev) => prev.map((item) => (item.id === assistantId ? { ...item, text: partial } : item)));
        if (index >= full.length) {
          clearInterval(timer);
          resolve(null);
        }
      }, 16);
    });
    setStep1Streaming(false);
  }

  async function submitStep1Chat(options = {}) {
    const userInput = String(options?.overrideInput ?? step1ChatInput).trim();
    if (!userInput) {
      setUiNotice({ type: "error", text: "请先输入你的剧本需求或修改意见" });
      return false;
    }
    const userMsg = { id: `${Date.now()}-u`, role: "user", text: userInput };
    const assistantMsg = { id: `${Date.now()}-a`, role: "assistant", text: "正在生成，请稍候..." };
    setStep1Messages((prev) => [...prev, userMsg, assistantMsg]);
    if (!options?.overrideInput) {
      setStep1ChatInput("");
    }
    const sceneCount = Math.max(1, Math.min(8, Number(scriptSceneCount) || 3));
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const totalEpisodes = Math.max(1, Number(seriesTotalEpisodes) || 1);
    const currentEpisode = Math.max(1, Math.min(totalEpisodes, Number(options?.overrideEpisode ?? seriesCurrentEpisode) || 1));
    const kindEffective = options?.overrideEpisode ? "series" : scriptKind;
    if (options?.overrideEpisode) {
      setSeriesCurrentEpisode(String(currentEpisode));
      setScriptKind("series");
    }
    if (kindEffective === "series") {
      setSeriesSplitConfirmed(false);
    }
    const typeInstruction =
      kindEffective === "series"
        ? `剧本类型：连续剧短剧。\n请先输出分集梗概JSON数组（字段：episode,summary），总集数 ${totalEpisodes}。\n然后只输出第 ${currentEpisode} 集的完整剧本内容，场景控制在 ${sceneCount} 场左右。`
        : `剧本类型：单集短片。\n请直接输出完整剧本，场景控制在 ${sceneCount} 场左右。`;
    const platformInstruction = step1PlatformTemplateText;
    const hasDraft = !options?.forceFresh && String(story || "").trim().length > 0;
    const promptText = hasDraft
      ? `${story}\n\n请根据以下修改意见改写完整剧本：${userInput}\n并满足：\n${typeInstruction}\n${platformInstruction}`
      : `${userInput}\n\n请按以下要求创作：\n${typeInstruction}\n${platformInstruction}`;
    const payload = await executeCli(
      hasDraft ? "剧本改写" : "生成剧本初稿",
      "script-draft",
      ["--title", titleValue, "--text", promptText, "--scene-count", String(sceneCount)],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      setStep1Messages((prev) => prev.map((item) => (item.id === assistantMsg.id ? { ...item, text: payload?.error || "生成失败，请重试。" } : item)));
      return false;
    }
    const scriptText = String(payload?.script_text || "").trim();
    const summary = String(payload?.story_summary || "").trim();
    if (summary) {
      if (kindEffective === "series") {
        setStep1PendingSummary(`连续剧模式：第 ${currentEpisode}/${totalEpisodes} 集\n${summary}`);
      } else {
        setStep1PendingSummary(summary);
      }
    }
    setScriptResultPreview("待确认剧本后生成梗概");
    if (scriptText) {
      await streamScriptToUi(scriptText, assistantMsg.id);
      setUiNotice({ type: "success", text: "剧本已更新，请确认后进入第二步" });
      return true;
    }
    setStep1Messages((prev) => prev.map((item) => (item.id === assistantMsg.id ? { ...item, text: "未返回剧本文本，请重试。" } : item)));
    return false;
  }

  async function regenerateEpisodeFromCard(row) {
    const episodeNo = Math.max(1, Number(String(row?.episode || "").replace(/[^\d]/g, "")) || 1);
    setActiveMenu("step1");
    await submitStep1Chat({
      overrideEpisode: episodeNo,
      forceFresh: true,
      overrideInput: `请根据以下第${episodeNo}集梗概重写该集完整剧本，并确保节奏紧凑、转场自然：\n${String(row?.summary || "").trim()}`,
    });
  }

  async function splitSeriesByEpisodeCount() {
    if (scriptKind !== "series") {
      return;
    }
    const baseStory = String(story || "").trim();
    if (!baseStory) {
      setUiNotice({ type: "error", text: "请先生成完整剧本，再执行分集" });
      return;
    }
    const totalEpisodes = Math.max(1, Number(seriesTotalEpisodes) || 1);
    const currentEpisode = Math.max(1, Math.min(totalEpisodes, Number(seriesCurrentEpisode) || 1));
    const ok = await submitStep1Chat({
      forceFresh: true,
      overrideEpisode: currentEpisode,
      overrideInput: `请基于以下完整剧本进行分集，总集数为${totalEpisodes}集。先给出每集梗概，再输出第${currentEpisode}集完整剧本：\n${baseStory}`,
    });
    if (ok) {
      setSeriesSplitConfirmed(true);
    }
  }

  async function analyzeManualStorySummary(options = {}) {
    const scriptText = String(story || "").trim();
    if (!scriptText) {
      setUiNotice({ type: "error", text: "请先粘贴完整剧本，再解析故事梗概" });
      return "";
    }
    const sceneCount = Math.max(1, Math.min(8, Number(scriptSceneCount) || 3));
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const promptText = `请基于以下完整剧本提炼故事梗概。\n要求：仅输出梗概内容，不要改写剧本正文，不要输出分镜表。\n\n剧本：\n${scriptText}`;
    const payload = await executeCli(
      "AI解析故事梗概",
      "script-draft",
      ["--title", titleValue, "--text", promptText, "--scene-count", String(sceneCount)],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      return "";
    }
    const summary = String(payload?.story_summary || "").trim() || String(payload?.script_text || "").trim().slice(0, 240);
    if (!summary) {
      setUiNotice({ type: "error", text: "未解析到有效梗概，请调整剧本后重试" });
      return "";
    }
    setStep1ManualSummary(summary);
    setStep1PendingSummary(summary);
    setScriptResultPreview(summary);
    if (!options?.silentNotice) {
      setUiNotice({ type: "success", text: "已解析并更新故事梗概" });
    }
    return summary;
  }

  async function runStep1QualityCheck(sourceStory = "", options = {}) {
    const scriptText = String(sourceStory || story || "").trim();
    if (!scriptText) {
      if (!options?.silentNotice) {
        setUiNotice({ type: "error", text: "请先准备完整剧本，再进行结构体检" });
      }
      return null;
    }
    const sceneCount = Math.max(1, Math.min(8, Number(scriptSceneCount) || 3));
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const payload = await executeCli(
      "剧本结构体检",
      "script-quality",
      ["--title", titleValue, "--text", scriptText, "--scene-count", String(sceneCount)],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      return null;
    }
    const card = payload?.scorecard && typeof payload.scorecard === "object" ? payload.scorecard : null;
    if (card) {
      setStep1QualityReport(card);
      if (!options?.silentNotice) {
        setUiNotice({
          type: card.pass ? "success" : "error",
          text: card.pass ? `结构体检通过（总分 ${card.total || 0}）` : `结构体检未通过（总分 ${card.total || 0}）`,
        });
      }
      return card;
    }
    return null;
  }

  async function runStep1ShortvideoAudit(sourceStory = "", options = {}) {
    const scriptText = String(sourceStory || story || "").trim();
    if (!scriptText) {
      if (!options?.silentNotice) {
        setUiNotice({ type: "error", text: "请先准备完整剧本，再进行短视频体检" });
      }
      return null;
    }
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const durationSec = Math.max(5, Math.min(180, Number(step1ShortAuditDuration) || 30));
    const platformValue = String(step1ShortAuditPlatform || "douyin").trim() || "douyin";
    const payload = await executeCli(
      "短视频运营体检",
      "script-shortvideo-audit",
      ["--title", titleValue, "--text", scriptText, "--platform", platformValue, "--duration-sec", String(durationSec)],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      return null;
    }
    const report = payload?.audit && typeof payload.audit === "object" ? payload.audit : null;
    if (report) {
      setStep1ShortAuditReport(report);
      if (!options?.silentNotice) {
        setUiNotice({
          type: report.pass ? "success" : "error",
          text: report.pass ? `短视频体检通过（总分 ${report.total || 0}）` : `短视频体检未通过（总分 ${report.total || 0}）`,
        });
      }
      return report;
    }
    return null;
  }

  async function runStep1SafetyAudit(sourceStory = "", options = {}) {
    const scriptText = String(sourceStory || story || "").trim();
    if (!scriptText) {
      if (!options?.silentNotice) {
        setUiNotice({ type: "error", text: "请先准备完整剧本，再进行安全审查" });
      }
      return null;
    }
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const payload = await executeCli(
      "版权与敏感审查",
      "script-safety-audit",
      ["--title", titleValue, "--text", scriptText],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      return null;
    }
    const report = payload?.safety && typeof payload.safety === "object" ? payload.safety : null;
    if (report) {
      setStep1SafetyReport(report);
      if (!options?.silentNotice) {
        setUiNotice({
          type: report.pass ? "success" : "error",
          text: report.pass ? `安全审查通过（风险等级 ${report.risk_level || "low"}）` : `安全审查未通过（风险等级 ${report.risk_level || "high"}）`,
        });
      }
      return report;
    }
    return null;
  }

  async function expandManualStoryToScript() {
    const sourceText = String(story || "").trim();
    if (!sourceText) {
      setUiNotice({ type: "error", text: "请先粘贴剧情或剧本内容" });
      return "";
    }
    const sceneCount = Math.max(1, Math.min(8, Number(scriptSceneCount) || 3));
    const titleValue = chatTitle.trim() || projectTitle.trim() || "短片";
    const promptText = `请将以下内容整理为完整可拍摄剧本。\n要求：保留核心剧情，不要输出表格，不要输出分镜参数，每场有动作与对白。\n并满足：${step1PlatformTemplateText}\n\n内容：\n${sourceText}`;
    const payload = await executeCli(
      "AI扩写完整剧本",
      "script-draft",
      ["--title", titleValue, "--text", promptText, "--scene-count", String(sceneCount)],
      { silentSuccess: true },
    );
    if (!payload?.ok) {
      return "";
    }
    const expanded = String(payload?.script_text || "").trim();
    if (!expanded) {
      setUiNotice({ type: "error", text: "AI未返回完整剧本，请调整内容后重试" });
      return "";
    }
    setStory(expanded);
    const summary = String(payload?.story_summary || "").trim();
    if (summary) {
      setStep1ManualSummary(summary);
      setStep1PendingSummary(summary);
      setScriptResultPreview(summary);
    }
    setUiNotice({ type: "success", text: "已扩写为完整剧本，可直接进入第二步" });
    return expanded;
  }

  async function autoCompleteStep1Ready() {
    if (running || step1Streaming) {
      return;
    }
    let currentStory = String(story || "").trim();
    if (!currentStory && step1ScriptMode === "ai") {
      const seedInput = step1ChatInput.trim() || `${chatTitle.trim() || "短片"}，请生成一个冲突明确、可拍摄、场景数约${normalizedSceneCount}的完整剧本。`;
      const ok = await submitStep1Chat({ overrideInput: seedInput });
      if (!ok) {
        return;
      }
      const latest = await runCliQuiet("session-state", withStateFile([]));
      currentStory = String(latest?.state?.story || story || "").trim();
    }
    if (!currentStory) {
      setUiNotice({ type: "error", text: "请先输入故事想法或粘贴文本，再自动补全" });
      return;
    }
    const expanded = await expandManualStoryToScript();
    if (!expanded) {
      return;
    }
    if (!step1ManualSummary.trim()) {
      await analyzeManualStorySummary({ silentNotice: true });
    }
    if (step1QualityGateEnabled) {
      await runStep1QualityCheck(expanded, { silentNotice: true });
    }
    if (step1SafetyGateEnabled) {
      await runStep1SafetyAudit(expanded, { silentNotice: true });
    }
    if (step1AutoProceedAfterComplete) {
      await handleFinishStep1({ overrideStoryText: expanded });
      return;
    }
    setUiNotice({ type: "success", text: "已自动补全到可继续状态，请直接进入下一步" });
  }

  async function handleStep1PrimaryBlockerAction() {
    if (running || step1Streaming || !step1PrimaryBlocker) {
      return;
    }
    const blockerKey = String(step1PrimaryBlocker.key || "");
    if (blockerKey.startsWith("base_")) {
      if (blockerKey === "base_episode") {
        setUiNotice({ type: "info", text: "请在第一步填写“当前第几集”，再继续。" });
        return;
      }
      await autoCompleteStep1Ready();
      return;
    }
    if (blockerKey.startsWith("quality_")) {
      await runStep1QualityCheck();
      return;
    }
    if (blockerKey.startsWith("shortvideo_")) {
      await runStep1ShortvideoAudit();
      return;
    }
    if (blockerKey.startsWith("safety_")) {
      await runStep1SafetyAudit();
    }
  }

  async function handleStep1ResolveAllBlockers() {
    if (running || step1Streaming) {
      return;
    }
    if (!step1FinishBlockers.length) {
      setUiNotice({ type: "success", text: "当前没有卡点，可直接进入下一步。" });
      return;
    }
    if (step1FinishBlockers.some((item) => item.key === "base_episode")) {
      setUiNotice({ type: "info", text: "请先填写“当前第几集”，再执行全量处理。" });
      return;
    }
    const taskList = [];
    if (step1FinishBlockers.some((item) => String(item.key || "").startsWith("base_"))) {
      taskList.push("补全剧本");
    }
    if (step1QualityGateEnabled && (!step1QualityReport || !step1QualityReport.pass)) {
      taskList.push("结构体检");
    }
    if (step1ShortAuditGateEnabled && (!step1ShortAuditReport || !step1ShortAuditReport.pass)) {
      taskList.push("运营体检");
    }
    if (step1SafetyGateEnabled && (!step1SafetyReport || !step1SafetyReport.pass)) {
      taskList.push("安全审查");
    }
    setStep1ResolveAllProgress({ running: true, done: 0, total: taskList.length, current: taskList[0] || "处理中" });
    let completedCount = 0;
    try {
      if (taskList.includes("补全剧本")) {
        setStep1ResolveAllProgress((prev) => ({ ...prev, current: "补全剧本" }));
        await autoCompleteStep1Ready();
        completedCount += 1;
        setStep1ResolveAllProgress((prev) => ({ ...prev, done: completedCount }));
      }
      const latest = await runCliQuiet("session-state", withStateFile([]));
      const latestStory = String(latest?.state?.story || story || "").trim();
      if (taskList.includes("结构体检")) {
        setStep1ResolveAllProgress((prev) => ({ ...prev, current: "结构体检" }));
        await runStep1QualityCheck(latestStory, { silentNotice: true });
        completedCount += 1;
        setStep1ResolveAllProgress((prev) => ({ ...prev, done: completedCount }));
      }
      if (taskList.includes("运营体检")) {
        setStep1ResolveAllProgress((prev) => ({ ...prev, current: "运营体检" }));
        await runStep1ShortvideoAudit(latestStory, { silentNotice: true });
        completedCount += 1;
        setStep1ResolveAllProgress((prev) => ({ ...prev, done: completedCount }));
      }
      if (taskList.includes("安全审查")) {
        setStep1ResolveAllProgress((prev) => ({ ...prev, current: "安全审查" }));
        await runStep1SafetyAudit(latestStory, { silentNotice: true });
        completedCount += 1;
        setStep1ResolveAllProgress((prev) => ({ ...prev, done: completedCount }));
      }
    } finally {
      setStep1ResolveAllProgress((prev) => ({ ...prev, running: false, current: prev.total > 0 ? "已完成" : "" }));
    }
    setUiNotice({ type: "info", text: "已执行全量处理，请查看门控状态与卡点提示。" });
  }

  function applyStep1ModePreset(mode) {
    const normalized = mode === "strict" ? "strict" : "creative";
    if (normalized === "strict") {
      setStep1ModePreset("creative");
      setUiNotice({ type: "info", text: "严格模式当前仅作备选，不启用。已保持创意模式。" });
      return;
    }
    setStep1ModePreset("creative");
    setStep1ShowAdvanced(false);
    setStep1QualityGateEnabled(false);
    setStep1ShortAuditGateEnabled(false);
    setStep1SafetyGateEnabled(false);
    setUiNotice({ type: "info", text: "已切换为创意模式：已关闭复杂门控，先专注创作" });
  }

  function handleStep1InputKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (running || step1Streaming) {
      return;
    }
    submitStep1Chat();
  }

  async function handleFinishStep1(options = {}) {
    let storyText = String(options?.overrideStoryText || story || "").trim();
    if (!storyText) {
      setUiNotice({ type: "error", text: "请先填写或生成完整剧本，再进入下一步" });
      return;
    }
    if (step1ScriptMode === "manual") {
      const lineCount = storyText.split(/\r?\n/).filter((line) => String(line || "").trim()).length;
      if (storyText.length < 200 || lineCount < 3) {
        const expanded = await expandManualStoryToScript();
        if (expanded) {
          storyText = expanded;
        }
      }
    }
    const totalEpisodes = Math.max(1, Number(seriesTotalEpisodes) || 1);
    const currentEpisode = Math.max(1, Math.min(totalEpisodes, Number(seriesCurrentEpisode) || 1));
    const titleValue = scriptKind === "series" ? `${chatTitle.trim() || "短剧"}-E${String(currentEpisode).padStart(2, "0")}` : chatTitle.trim() || "短片";
    const remindSplit = scriptKind === "series" && step1ScriptMode === "ai" && !seriesSplitConfirmed;
    const manualSummaryText = step1ScriptMode === "manual"
      ? (step1ManualSummary.trim() || await analyzeManualStorySummary({ silentNotice: true }))
      : "";
    if (step1QualityGateEnabled) {
      const quality = await runStep1QualityCheck(storyText, { silentNotice: true });
      if (!quality || !quality.pass) {
        setUiNotice({ type: "error", text: `剧本结构体检未通过（当前 ${quality?.total || 0} 分），请先优化冲突、反转与钩子` });
        return;
      }
    }
    if (step1ShortAuditGateEnabled) {
      const audit = await runStep1ShortvideoAudit(storyText, { silentNotice: true });
      if (!audit || !audit.pass) {
        setUiNotice({ type: "error", text: `短视频体检未通过（当前 ${audit?.total || 0} 分），请先优化前三秒钩子与CTA` });
        return;
      }
    }
    if (step1SafetyGateEnabled) {
      const safety = await runStep1SafetyAudit(storyText, { silentNotice: true });
      if (!safety || !safety.pass) {
        setUiNotice({ type: "error", text: `安全审查未通过（风险等级 ${safety?.risk_level || "high"}），请先处理版权或敏感风险` });
        return;
      }
    }
    const payload = await executeCli(
      "确认剧本",
      "project-set-story",
      withStateFile([
        "--title",
        titleValue,
        "--story",
        storyText || "未填写剧本",
      ]),
    );
    if (payload?.ok) {
      if (step1ScriptMode === "manual" && manualSummaryText) {
        setStep1PendingSummary(manualSummaryText);
      }
      if (step1PendingSummary.trim()) {
        setScriptResultPreview(step1PendingSummary.trim());
      } else if (step1ScriptMode === "manual" && manualSummaryText) {
        setScriptResultPreview(manualSummaryText);
      }
      setActiveMenu("step2");
      setUiNotice({
        type: "success",
        text: remindSplit
          ? "剧本已确认并进入第二步。建议回到第一步点击“按集数AI分集”后再继续细化。"
          : "剧本已确认，请在第二步分别生成角色、场景和分镜",
      });
      const stage2Counts = await generateAllStage2Parts({ strict: true });
      if (stage2Counts.characters <= 0 || stage2Counts.scenes <= 0 || stage2Counts.storyboard <= 0) {
        setUiNotice({
          type: "error",
          text: `第二步自动提取不完整：角色${stage2Counts.characters}、场景${stage2Counts.scenes}、分镜${stage2Counts.storyboard}。请在第二步点击“从剧本自动提取（可选）”重试或手动补充。`,
        });
      }
    }
  }

  async function generateStage2Part(part, options = {}) {
    const maxShots = Math.max(0, Number(shotTargetCount) || 0);
    const instructionText = String(options?.instructionOverride || "").trim() || stage2Instruction.trim() || "写实电影感，风格统一。";
    const payload = await executeCli(
      `生成${part === "characters" ? "角色" : part === "scenes" ? "场景" : "分镜"}`,
      "stage2-generate-part",
      withStateFile(
        [
          "--part",
          part,
          "--instruction",
          instructionText,
        ].concat(part === "storyboard" && maxShots > 0 ? ["--max-shots", String(maxShots)] : []),
      ),
    );
    if (payload?.ok) {
      setUiNotice({ type: "success", text: `${part === "characters" ? "角色" : part === "scenes" ? "场景" : "分镜"}已生成` });
    }
    return payload;
  }

  async function generateAllStage2Parts(options = {}) {
    await generateStage2Part("characters", options);
    await generateStage2Part("scenes", options);
    await generateStage2Part("storyboard", options);
    const statePayload = await executeCli("校验第二步提取结果", "session-state", withStateFile([]), { silentSuccess: true });
    const root = statePayload?.state || statePayload || {};
    const plan = root?.stage2_plan && typeof root.stage2_plan === "object" ? root.stage2_plan : {};
    let counts = {
      characters: Array.isArray(plan.characters) ? plan.characters.length : 0,
      scenes: Array.isArray(plan.scenes) ? plan.scenes.length : 0,
      storyboard: Array.isArray(plan.storyboard_text) ? plan.storyboard_text.length : 0,
    };
    const missing = [
      counts.characters <= 0 ? "characters" : "",
      counts.scenes <= 0 ? "scenes" : "",
      counts.storyboard <= 0 ? "storyboard" : "",
    ].filter(Boolean);
    if (options?.strict && missing.length > 0) {
      const fallbackInstruction = `${stage2Instruction.trim() || "写实电影感，风格统一。"}。必须输出可用JSON数组，至少包含1条数据，字段必须完整且可用于后续素材生成。`;
      for (const part of missing) {
        await generateStage2Part(part, { instructionOverride: fallbackInstruction });
      }
      const retryStatePayload = await executeCli("二次校验第二步提取结果", "session-state", withStateFile([]), { silentSuccess: true });
      const retryRoot = retryStatePayload?.state || retryStatePayload || {};
      const retryPlan = retryRoot?.stage2_plan && typeof retryRoot.stage2_plan === "object" ? retryRoot.stage2_plan : {};
      counts = {
        characters: Array.isArray(retryPlan.characters) ? retryPlan.characters.length : 0,
        scenes: Array.isArray(retryPlan.scenes) ? retryPlan.scenes.length : 0,
        storyboard: Array.isArray(retryPlan.storyboard_text) ? retryPlan.storyboard_text.length : 0,
      };
    }
    return counts;
  }

  function buildStage2Plan() {
    return {
      characters: characterList.map((item, index) => ({
        name: String(item?.name || "").trim() || `角色${index + 1}`,
        description: String(item?.description || "").trim(),
        prompt: String(item?.prompt || "").trim(),
      })),
      scenes: sceneList.map((item, index) => ({
        name: String(item?.name || "").trim() || `场景${index + 1}`,
        description: String(item?.description || "").trim(),
        prompt: String(item?.prompt || "").trim(),
      })),
      storyboard_text: storyboardList.map((item, index) => ({
        shot_id: String(item?.shot_id || "").trim() || `S${String(index + 1).padStart(2, "0")}`,
        duration_sec: Number(item?.duration_sec) > 0 ? Number(item.duration_sec) : 5,
        subtitle: String(item?.subtitle || "").trim(),
        visual_hint: String(item?.visual_hint || "").trim(),
      })),
    };
  }

  async function saveStage2Plan() {
    const payload = await executeCli(
      "保存第二步计划",
      "stage2-set-plan",
      withStateFile(["--plan-json", JSON.stringify(buildStage2Plan())]),
      { silentSuccess: true },
    );
    return payload;
  }

  function buildEditableShotsPayload() {
    return shotsList.map((item, index) => ({
      shot_id: String(item?.shot_id || "").trim() || `S${String(index + 1).padStart(2, "0")}`,
      duration_sec: Math.max(1, Number(item?.duration_sec) || 5),
      subtitle: String(item?.subtitle || "").trim(),
      visual_prompt: String(item?.visual_prompt || "").trim(),
    }));
  }

  async function saveShotsDraft(options = {}) {
    if (!shotsList.length) {
      return { ok: true };
    }
    const payload = await executeCli(
      "保存镜头修改",
      "stage2-set-shots",
      withStateFile(["--shots-json", JSON.stringify(buildEditableShotsPayload())]),
      { silentSuccess: Boolean(options.silentSuccess) },
    );
    if (payload?.ok) {
      setShotsDirty(false);
    }
    return payload;
  }

  async function ensureShotsSaved() {
    if (!shotsDirty) {
      return true;
    }
    const saved = await saveShotsDraft({ silentSuccess: true });
    return Boolean(saved?.ok);
  }

  function updateShotField(index, key, value) {
    setShotsList((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    setShotsDirty(true);
  }

  function updateSeedanceShotPart(index, key, value) {
    setShotsList((prev) =>
      prev.map((row, i) => {
        if (i !== index) {
          return row;
        }
        const nextParts = {
          ...parseSeedancePromptParts(String(row?.visual_prompt || "")),
          [key]: value,
        };
        return {
          ...row,
          visual_prompt: composeSeedancePromptParts(nextParts),
        };
      }),
    );
    setShotsDirty(true);
  }

  function applySeedancePromptTemplate(index) {
    setShotsList((prev) =>
      prev.map((row, i) => {
        if (i !== index) {
          return row;
        }
        const currentParts = parseSeedancePromptParts(String(row?.visual_prompt || ""));
        const templateParts = buildSeedanceTemplateParts(row, artStyle);
        return {
          ...row,
          visual_prompt: composeSeedancePromptParts({
            subject: currentParts.subject || templateParts.subject,
            action: currentParts.action || templateParts.action,
            camera: currentParts.camera || templateParts.camera,
            style: currentParts.style || templateParts.style,
            quality: currentParts.quality || templateParts.quality,
          }),
        };
      }),
    );
    setShotsDirty(true);
  }

  function applySeedancePromptTemplateToAll() {
    setShotsList((prev) =>
      prev.map((row) => {
        const currentParts = parseSeedancePromptParts(String(row?.visual_prompt || ""));
        const templateParts = buildSeedanceTemplateParts(row, artStyle);
        return {
          ...row,
          visual_prompt: composeSeedancePromptParts({
            subject: currentParts.subject || templateParts.subject,
            action: currentParts.action || templateParts.action,
            camera: currentParts.camera || templateParts.camera,
            style: currentParts.style || templateParts.style,
            quality: currentParts.quality || templateParts.quality,
          }),
        };
      }),
    );
    setShotsDirty(true);
  }

  function autoFixSeedancePrompt(index) {
    setShotsList((prev) =>
      prev.map((row, i) => {
        if (i !== index) {
          return row;
        }
        return {
          ...row,
          visual_prompt: autoFixSeedancePromptForShot(row, artStyle, seedanceUseImageRefs),
        };
      }),
    );
    setShotsDirty(true);
    setUiNotice({ type: "success", text: "已修复当前镜头的 Seedance 提示词问题。" });
  }

  function autoFixSeedancePromptToAll() {
    setShotsList((prev) =>
      prev.map((row) => ({
        ...row,
        visual_prompt: autoFixSeedancePromptForShot(row, artStyle, seedanceUseImageRefs),
      })),
    );
    setShotsDirty(true);
    setUiNotice({ type: "success", text: "已批量修复全部镜头的 Seedance 提示词问题。" });
  }

  async function proceedToStep3() {
    const saved = await saveStage2Plan();
    if (!saved?.ok) {
      return;
    }
    setActiveMenu("step3");
  }

  async function generateSingleAsset(kind, name) {
    const jobKey = `${kind}:${name}`;
    if (assetJobKeys.includes(jobKey)) {
      return;
    }
    setAssetJobKeys((prev) => [...prev, jobKey]);
    const saved = await saveStage2Plan();
    if (!saved?.ok) {
      setAssetJobKeys((prev) => prev.filter((key) => key !== jobKey));
      return;
    }
    setUiNotice({ type: "info", text: `${kind === "face" ? "角色" : "场景"}「${name}」开始生成...` });
    if (kind === "face" && faceAnglePackEnabled) {
      const modeQueue = Array.from(new Set([faceMode, "model_sheet", "turnaround", "portrait", "action_pose"]));
      for (const modeValue of modeQueue) {
        const args = withStateFile([
          "--kind",
          kind,
          "--name",
          name,
          "--size",
          assetImageSize.trim() || "1024x1024",
          "--style",
          artStyle.trim() || "写实电影感",
          "--mode",
          modeValue,
        ]);
        if (modeValue === "model_sheet" && strictSheetLayout) {
          args.push("--strict-layout");
        }
        const modeLabel = faceModePresets.find((item) => item.value === modeValue)?.label || modeValue;
        await executeCliConcurrent(
          `生成角色素材（${modeLabel}）`,
          "stage2-generate-item",
          args,
          { silentSuccess: true },
        );
      }
    } else {
      const args = withStateFile([
        "--kind",
        kind,
        "--name",
        name,
        "--size",
        assetImageSize.trim() || "1024x1024",
        "--style",
        artStyle.trim() || "写实电影感",
        "--mode",
        kind === "face" ? faceMode : sceneMode,
      ]);
      if (kind === "face" && faceMode === "model_sheet" && strictSheetLayout) {
        args.push("--strict-layout");
      }
      if (kind === "scene" && !sceneBindCharacterAnchors) {
        args.push("--scene-ignore-character-anchors");
      }
      await executeCliConcurrent(
        kind === "face" ? "生成角色素材" : "生成场景素材",
        "stage2-generate-item",
        args,
        { silentSuccess: true },
      );
    }
    await executeCliConcurrent("刷新第三步状态", "session-state", withStateFile([]), { silentSuccess: true });
    setUiNotice({
      type: "success",
      text: kind === "face" && faceAnglePackEnabled
        ? `角色「${name}」多角度素材生成完成（含设定板/站姿/肖像/动作）`
        : `${kind === "face" ? "角色" : "场景"}「${name}」生成完成`,
    });
    setAssetJobKeys((prev) => prev.filter((key) => key !== jobKey));
  }

  async function importReferenceImage(kind, name) {
    if (!window.openvshot?.pickImageFile) {
      setUiNotice({ type: "error", text: "当前窗口未加载图片选择能力，请重启桌面端后重试" });
      return;
    }
    const picked = await window.openvshot.pickImageFile();
    if (picked?.canceled) {
      return;
    }
    const selectedPath = String(picked?.path || "").trim();
    if (!selectedPath) {
      setUiNotice({ type: "error", text: "未获取到有效图片路径，请重试" });
      return;
    }
    const added = await executeCli(
      kind === "face" ? "导入角色参考图" : "导入场景参考图",
      "asset-add",
      withStateFile(["--kind", kind, "--name", name, "--file", selectedPath]),
      { silentSuccess: true },
    );
    if (!added?.ok) {
      return;
    }
    await executeCli(
      "启用导入参考图版本",
      "asset-activate",
      withStateFile(["--kind", kind, "--name", name, "--version", "latest"]),
      { silentSuccess: true },
    );
    await executeCli("刷新第三步状态", "session-state", withStateFile([]), { silentSuccess: true });
    const fileName = selectedPath.split(/[\\/]/).pop() || "参考图";
    setUiNotice({ type: "success", text: `${kind === "face" ? "角色" : "场景"}「${name}」已导入参考图：${fileName}` });
  }

  async function generateShotsFromStoryboard() {
    if (shotsGenerating) {
      return;
    }
    setShotsGenerating(true);
    const saved = await saveStage2Plan();
    if (!saved?.ok) {
      setShotsGenerating(false);
      return;
    }
    const maxShots = Math.max(0, Number(shotTargetCount) || 0);
    const durationSec = Math.max(0, Number(shotDurationSec) || 0);
    const normalizedDurationSec = isSeedanceModel && durationSec > 15 ? 15 : durationSec;
    setUiNotice({ type: "info", text: "正在根据分镜文本生成镜头..." });
    const payload = await executeCliConcurrent(
      "根据分镜生成镜头",
      "stage2-generate-shots",
      withStateFile(
        ["--style", artStyle.trim() || "写实电影感"]
          .concat(maxShots > 0 ? ["--max-shots", String(maxShots)] : [])
          .concat(normalizedDurationSec > 0 ? ["--duration-sec", String(normalizedDurationSec)] : []),
      ),
      {
        silentSuccess: true,
      },
    );
    if (payload?.ok) {
      const count = Array.isArray(payload?.shots) ? payload.shots.length : 0;
      setUiNotice({ type: "success", text: `镜头生成完成（${count} 条），可逐条渲染` });
    }
    setShotsGenerating(false);
  }

  function resolveAssetPreviewSrc(item) {
    const localFile = String(item?.file || "").trim();
    if (localFile) {
      return `file:///${localFile.replace(/\\/g, "/")}`;
    }
    const remoteUrl = String(item?.remote_url || "").trim();
    if (remoteUrl) {
      return remoteUrl;
    }
    return "";
  }

  const openLocalVideoPreview = useCallback(async (localPath, title) => {
    const pathText = String(localPath || "").trim();
    if (!pathText) {
      return false;
    }
    if (window.openvshot?.readFileAsDataUrl) {
      const payload = await window.openvshot.readFileAsDataUrl(pathText);
      if (payload?.ok && String(payload?.dataUrl || "").trim()) {
        setVideoPreview({ src: String(payload.dataUrl), title: title || "视频预览" });
        return true;
      }
    }
    const fallbackSrc = /^https?:\/\//i.test(pathText) || /^file:\/\//i.test(pathText) ? pathText : `file:///${pathText.replace(/\\/g, "/")}`;
    if (fallbackSrc) {
      setVideoPreview({ src: fallbackSrc, title: title || "视频预览" });
      return true;
    }
    return false;
  }, []);

  function openAssetCompare(item, name) {
    const currentSrc = resolveAssetPreviewSrc(item);
    const previousSrc = resolveAssetPreviewSrc({
      remote_url: item?.previous_remote_url,
      file: item?.previous_file,
    });
    if (!currentSrc || !previousSrc) {
      return;
    }
    setAssetCompare({ leftSrc: currentSrc, rightSrc: previousSrc, title: `${name} 版本对比` });
  }

  async function refreshStep3() {
    await executeCli("刷新第三步状态", "session-state", withStateFile([]));
    await executeCli("刷新渲染任务（本地）", "tasks-list", withStateFile([...buildRetryArgs()]), { silentSuccess: true });
  }

  const refreshStep4 = useCallback(async () => {
    await executeCli("刷新第四步状态", "session-state", withStateFile([]));
    await executeCli("刷新第四步任务（本地）", "tasks-list", withStateFile([...buildRetryArgs()]), { silentSuccess: true });
  }, [buildRetryArgs, executeCli, withStateFile]);

  const syncStep4FromCloud = useCallback(async () => {
    setUiNotice({ type: "info", text: "开始一次性云端同步并下载，完成前请勿重复点击。" });
    await executeCli(
      "一次性云端同步并下载",
      "tasks-list",
      withStateFile(["--refresh", "--poll", "--interval", "3", "--timeout", "3600", ...buildRetryArgs(), "--download-dir", downloadDir.trim() || "videos"]),
    );
    setUiNotice({ type: "success", text: "云端同步已结束，请直接播放本地文件或开始合成。" });
  }, [buildRetryArgs, downloadDir, executeCli, withStateFile]);

  const shotsTotal = shotsList.length;
  const renderedCount = renderResults.filter((item) => String(item?.video_url || "").trim()).length;
  const approvedCount = approvedShots.length;
  const progressRendered = shotsTotal > 0 ? Math.round((renderedCount / shotsTotal) * 100) : 0;
  const progressApproved = shotsTotal > 0 ? Math.round((approvedCount / shotsTotal) * 100) : 0;
  const failedTasks = renderTaskRows.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return status.includes("failed") || status.includes("error");
  });
  const pendingTasks = renderTaskRows.filter((item) => !String(item?.video_url || "").trim());
  const completedTasks = renderTaskRows.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    const hasVideo = String(item?.video_url || "").trim().length > 0;
    return hasVideo || status.includes("success") || status.includes("completed") || status.includes("done");
  });
  const step4StatusCards = [
    { key: "total", label: "总镜头", value: String(shotsTotal) },
    { key: "rendered", label: "已渲染", value: `${renderedCount} (${progressRendered}%)` },
    { key: "approved", label: "已批准", value: `${approvedCount} (${progressApproved}%)` },
    { key: "failed", label: "失败任务", value: String(failedTasks.length) },
  ];
  const currentFirstRunGuide = firstRunGuideSteps[Math.max(0, Math.min(firstRunGuideStep, firstRunGuideSteps.length - 1))] || null;
  const guideHighlightClass = useCallback((key) => (
    showFirstRunGuide && currentFirstRunGuide?.key === key ? "relative z-[72] ring-4 ring-amber-300 shadow-2xl" : ""
  ), [currentFirstRunGuide?.key, showFirstRunGuide]);
  const openGuideTarget = useCallback((key) => {
    if (key === "project") {
      setActiveMenu("project");
      setProjectModalTab(hasProject ? "open" : "create");
      setShowProjectModal(true);
      setShowSettingsModal(false);
      return;
    }
    if (key === "settings") {
      setShowProjectModal(false);
      setShowSettingsModal(true);
      return;
    }
    if (key === "nav" || key === "workspace") {
      setShowProjectModal(false);
      setShowSettingsModal(false);
      setActiveMenu(hasProject ? "step1" : "project");
    }
  }, [hasProject]);
  const handleGuideTargetClick = useCallback((key, action) => {
    if (showFirstRunGuide && currentFirstRunGuide?.key === key) {
      action?.();
      setTimeout(() => {
        setFirstRunGuideStep((prev) => {
          if (prev >= firstRunGuideSteps.length - 1) {
            localStorage.setItem("openvshot_first_run_guide_seen", "1");
            setShowFirstRunGuide(false);
            return prev;
          }
          return prev + 1;
        });
      }, 0);
      return;
    }
    action?.();
  }, [currentFirstRunGuide?.key, firstRunGuideSteps.length, showFirstRunGuide]);
  const activeFaceVersionMap = new Map(
    activeFaces.map((item) => [String(item?.name || "").trim(), String(item?.version || "").trim()]).filter((row) => row[0]),
  );
  const activeSceneVersionMap = new Map(
    activeScenes.map((item) => [String(item?.name || "").trim(), String(item?.version || "").trim()]).filter((row) => row[0]),
  );
  const activeFaceItemMap = new Map(activeFaces.map((item) => [String(item?.name || "").trim(), item]).filter((row) => row[0]));
  const activeSceneItemMap = new Map(activeScenes.map((item) => [String(item?.name || "").trim(), item]).filter((row) => row[0]));
  const faceRegistryMap = assetRegistry?.face && typeof assetRegistry.face === "object" ? assetRegistry.face : {};
  const sceneRegistryMap = assetRegistry?.scene && typeof assetRegistry.scene === "object" ? assetRegistry.scene : {};
  const getAssetVersions = (kind, name) => {
    const mapValue = kind === "face" ? faceRegistryMap : sceneRegistryMap;
    const registryItem = mapValue?.[name];
    const list = Array.isArray(registryItem?.versions) ? registryItem.versions : [];
    return [...list].sort((left, right) => Number(right?.version || 0) - Number(left?.version || 0));
  };
  const effectiveRenderRatio = ratioFromSize(videoSize) || (renderRatio.trim() || "9:16");

  function getTaskCategory(task) {
    const status = String(task?.status || "").toLowerCase();
    const hasVideo = String(task?.video_url || "").trim().length > 0;
    if (status.includes("failed") || status.includes("error")) {
      return "failed";
    }
    if (hasVideo || status.includes("success") || status.includes("completed") || status.includes("done")) {
      return "completed";
    }
    return "pending";
  }

  function getTaskUpdatedAtText(task) {
    const raw =
      task?.updated_at ||
      task?.finished_at ||
      task?.completed_at ||
      task?.created_at ||
      task?.create_time ||
      task?.update_time ||
      "";
    return String(raw || "").trim() || "未知";
  }

  function getTaskUpdatedAtMs(task) {
    const value = getTaskUpdatedAtText(task);
    if (value === "未知") {
      return 0;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    return 0;
  }

  function getTaskRelativeTimeText(task) {
    const ts = getTaskUpdatedAtMs(task);
    if (!ts) {
      return "未知";
    }
    const diffMs = Date.now() - ts;
    if (diffMs < 60 * 1000) {
      return "刚刚";
    }
    if (diffMs < 60 * 60 * 1000) {
      return `${Math.max(1, Math.floor(diffMs / (60 * 1000)))}分钟前`;
    }
    if (diffMs < 24 * 60 * 60 * 1000) {
      return `${Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)))}小时前`;
    }
    return `${Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)))}天前`;
  }

  function getShotNumeric(task) {
    const shotId = String(task?.shot_id || "");
    const match = shotId.match(/\d+/);
    if (!match) {
      return Number.MAX_SAFE_INTEGER;
    }
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function getTaskPriorityRank(task) {
    const category = getTaskCategory(task);
    if (category === "failed") {
      return 0;
    }
    if (category === "pending") {
      return 1;
    }
    return 2;
  }

  const getTaskKey = useCallback((task) => {
    const taskId = String(task?.task_id || "").trim();
    const shotId = String(task?.shot_id || "").trim();
    const updated = getTaskUpdatedAtText(task);
    const status = String(task?.status || "").trim();
    if (taskId) {
      return `tid:${taskId}`;
    }
    return `sid:${shotId}|upd:${updated}|st:${status}`;
  }, []);

  const filteredTaskRows = renderTaskRows
    .filter((task) => {
      const shotId = String(task?.shot_id || "").toLowerCase();
      const taskId = String(task?.task_id || "").toLowerCase();
      const keyword = taskSearchKeyword.trim().toLowerCase();
      const keywordMatched = !keyword || shotId.includes(keyword) || taskId.includes(keyword);
      if (!keywordMatched) {
        return false;
      }
      if (taskFilter === "all") {
        return true;
      }
      return getTaskCategory(task) === taskFilter;
    })
    .sort((a, b) => {
      if (taskSortMode === "updated") {
        return getTaskUpdatedAtMs(b) - getTaskUpdatedAtMs(a);
      }
      if (taskSortMode === "shot_asc") {
        const shotDiff = getShotNumeric(a) - getShotNumeric(b);
        if (shotDiff !== 0) {
          return shotDiff;
        }
        return getTaskUpdatedAtMs(b) - getTaskUpdatedAtMs(a);
      }
      if (taskSortMode === "shot_desc") {
        const shotDiff = getShotNumeric(b) - getShotNumeric(a);
        if (shotDiff !== 0) {
          return shotDiff;
        }
        return getTaskUpdatedAtMs(b) - getTaskUpdatedAtMs(a);
      }
      const rankDiff = getTaskPriorityRank(a) - getTaskPriorityRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return getTaskUpdatedAtMs(b) - getTaskUpdatedAtMs(a);
    });
  const pageSizeValue = Number(taskPageSize);
  const safePageSize = Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? Math.floor(pageSizeValue) : 10;
  const taskTotalPages = Math.max(1, Math.ceil(filteredTaskRows.length / safePageSize));
  const safeTaskPage = Math.min(Math.max(1, taskPage), taskTotalPages);
  const pagedTaskRows = filteredTaskRows.slice((safeTaskPage - 1) * safePageSize, safeTaskPage * safePageSize);
  const pagedTaskKeys = pagedTaskRows.map((task) => getTaskKey(task));
  const filteredTaskKeys = filteredTaskRows.map((task) => getTaskKey(task));

  useEffect(() => {
    const shotId = String(pendingLocateShotId || "").trim();
    if (activeMenu !== "step4" || !shotId) {
      return;
    }
    const rowIndex = filteredTaskRows.findIndex((task) => String(task?.shot_id || "").trim() === shotId);
    if (rowIndex < 0) {
      if (pendingLocateRefreshRef.current !== shotId) {
        pendingLocateRefreshRef.current = shotId;
        refreshStep4();
        return;
      }
      pendingLocateRefreshRef.current = "";
      setUiNotice({ type: "error", text: `未在当前任务列表找到镜头：${shotId}` });
      setPendingLocateShotId("");
      return;
    }
    pendingLocateRefreshRef.current = "";
    const targetPage = Math.floor(rowIndex / safePageSize) + 1;
    if (taskPage !== targetPage) {
      setTaskPage(targetPage);
      return;
    }
    const targetTask = filteredTaskRows[rowIndex];
    const targetKey = getTaskKey(targetTask);
    setExpandedTaskKey(targetKey);
    setLocatedTaskKey(targetKey);
    const rowDomId = `task-row-${encodeURIComponent(targetKey)}`;
    const timer = setTimeout(() => {
      const node = document.getElementById(rowDomId);
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setPendingLocateShotId("");
    }, 80);
    const clearTimer = setTimeout(() => {
      setLocatedTaskKey((prev) => (prev === targetKey ? "" : prev));
    }, 2200);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [activeMenu, filteredTaskRows, getTaskKey, pendingLocateShotId, refreshStep4, safePageSize, taskPage]);

  async function retryRenderTask(task) {
    const shotId = String(task?.shot_id || "");
    if (!shotId) {
      return;
    }
    await executeCli(
      "单任务重试",
      "render-shot",
      withStateFile([
        "--shot-id",
        shotId,
        "--ratio",
        renderRatio.trim() || "9:16",
        "--poll",
        "--approve",
        ...buildRetryArgs(),
        "--download-dir",
        downloadDir.trim() || "videos",
      ]),
    );
  }

  async function playRenderTask(task) {
    const shotId = String(task?.shot_id || "").trim();
    if (!shotId) {
      return;
    }
    const hasLocal = String(task?.local_file || "").trim().length > 0;
    if (hasLocal) {
      const opened = await openLocalVideoPreview(String(task?.local_file || ""), `${shotId} 预览`);
      if (opened) {
        return;
      }
    }
    const downloadError = String(task?.download_error || "").trim();
    setUiNotice({ type: "error", text: downloadError || `镜头 ${shotId} 尚未下载到本地，请先点“一次性云端同步并下载”。` });
  }

  async function playFinalVideo() {
    const opened = await openLocalVideoPreview(finalVideo, "最终视频预览");
    if (!opened) {
      setUiNotice({ type: "error", text: "最终视频尚未就绪或本地文件不存在" });
    }
  }

  async function executeCliDirect(command, args) {
    if (!window.openvshot?.runCli) {
      const message = "未检测到 Electron 预加载桥接，请使用 npm run dev 启动桌面模式。";
      setResult({ ok: false, code: -1, stdout: "", stderr: message });
      throw new Error(message);
    }
    const response = await window.openvshot.runCli({
      command,
      args,
      jsonMode: true,
    });
    const payload = parsePayload(response.stdout);
    if (payload && payload.ok) {
      syncFromStatePayload(payload);
      return { ok: true, payload, response };
    }
    return { ok: false, payload, response };
  }

  async function retryShotIdsWithConcurrency(shotIds, actionName) {
    const uniqueShotIds = Array.from(new Set(shotIds.map((item) => String(item || "").trim()).filter(Boolean)));
    if (uniqueShotIds.length === 0) {
      return;
    }
    const numeric = Number(retryConcurrency);
    const concurrency = Number.isFinite(numeric) && numeric > 0 ? Math.min(10, Math.floor(numeric)) : 3;
    let cursor = 0;
    let done = 0;
    let success = 0;
    let failed = 0;
    retryCancelRef.current = false;
    retryPauseRef.current = false;
    setRetryBatchPaused(false);
    setRetryCancelRequested(false);
    setRetryBatchRunning(true);
    setRetryBatchProgress({ total: uniqueShotIds.length, done: 0, success: 0, failed: 0, current: "" });
    const worker = async () => {
      while (true) {
        if (retryCancelRef.current) {
          return;
        }
        while (retryPauseRef.current && !retryCancelRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (retryCancelRef.current) {
          return;
        }
        if (cursor >= uniqueShotIds.length) {
          return;
        }
        const index = cursor;
        cursor += 1;
        const shotId = uniqueShotIds[index];
        setRetryBatchProgress((prev) => ({ ...prev, current: shotId }));
        try {
          const resultRow = await executeCliDirect(
            "render-shot",
            withStateFile([
              "--shot-id",
              shotId,
              "--ratio",
              renderRatio.trim() || "9:16",
              "--poll",
              "--approve",
              ...buildRetryArgs(),
              "--download-dir",
              downloadDir.trim() || "videos",
            ]),
          );
          if (resultRow.ok) {
            success += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
        done += 1;
        setRetryBatchProgress({ total: uniqueShotIds.length, done, success, failed, current: shotId });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, uniqueShotIds.length) }, () => worker()));
    setRetryBatchRunning(false);
    const canceled = retryCancelRef.current;
    retryCancelRef.current = false;
    retryPauseRef.current = false;
    setRetryBatchPaused(false);
    setRetryCancelRequested(false);
    setRetryBatchProgress((prev) => ({ ...prev, current: "" }));
    await refreshStep4();
    setResult({
      ok: failed === 0 && !canceled,
      code: failed === 0 && !canceled ? 0 : 1,
      stdout: JSON.stringify(
        {
          ok: failed === 0 && !canceled,
          action: actionName,
          canceled,
          total: uniqueShotIds.length,
          done,
          success,
          failed,
        },
        null,
        2,
      ),
      stderr: canceled ? "批量重试已取消" : failed === 0 ? "" : `${failed} 个任务重试失败`,
    });
  }

  const loadJournalReport = useCallback(async () => {
    const args = [];
    const tailText = String(journalTail || "").trim();
    const eventText = String(journalEvent || "").trim();
    const formatText = String(journalFormat || "markdown").trim() || "markdown";
    if (tailText) {
      args.push("--tail", tailText);
    }
    if (eventText) {
      args.push("--event", eventText);
    }
    args.push("--format", formatText);
    const payload = await executeCli("读取诊断报表", "journal-report", args);
    if (payload?.ok) {
      setJournalReportPayload(payload);
    }
  }, [executeCli, journalEvent, journalFormat, journalTail]);

  const renderJournalReportPanel = useCallback(
    () => (
      <div className="grid gap-2 rounded-md border border-slate-200 p-3">
        <h3 className="text-sm font-semibold">Journal 报表</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <Input value={journalTail} onChange={(event) => setJournalTail(event.target.value)} placeholder="统计行数（tail）" />
          <Input value={journalEvent} onChange={(event) => setJournalEvent(event.target.value)} placeholder="事件过滤，如 fal_workflow_call" />
          <Input value={journalFormat} onChange={(event) => setJournalFormat(event.target.value)} placeholder="输出格式 json/markdown" />
          <Button variant="secondary" onClick={loadJournalReport} disabled={running}>
            刷新报表
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setJournalFormat("markdown")} disabled={running}>格式：Markdown</Button>
          <Button size="sm" variant="outline" onClick={() => setJournalFormat("json")} disabled={running}>格式：JSON</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {journalEventPresetOptions.map((item) => (
            <Button
              key={`journal-event-${item.value}`}
              size="sm"
              variant={String(journalEvent || "").trim() === item.value ? "default" : "outline"}
              onClick={() => setJournalEvent(item.value)}
              disabled={running}
            >
              事件：{item.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setJournalEvent("")} disabled={running || !String(journalEvent || "").trim()}>
            清空事件过滤
          </Button>
        </div>
        {journalReportPayload ? (
          <pre className="max-h-72 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800">
            {String(journalReportPayload.markdown || JSON.stringify(journalReportPayload, null, 2))}
          </pre>
        ) : (
          <p className="text-xs text-slate-500">尚未加载报表，点击“刷新报表”读取日志聚合。</p>
        )}
      </div>
    ),
    [journalEvent, journalFormat, journalReportPayload, journalTail, loadJournalReport, running],
  );

  const runFalQuickAction = useCallback(async (kind) => {
    if (kind === "workflow-list") {
      setJournalEvent("fal_workflow_list");
      const keywordParts = Array.from(
        new Set(
          (Array.isArray(falWorkflowKeywords) ? falWorkflowKeywords : [])
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      );
      const manualQuery = String(falWorkflowQuery || "").trim();
      const combinedQuery = [manualQuery, ...keywordParts].filter(Boolean).join(" ").trim() || "workflow";
      const payload = await executeCli(
        "查询 Fal 工作流",
        "fal-workflow-list",
        ["--source", "api", "--query", combinedQuery, "--max-pages", "3", ...buildRetryArgs()],
      );
      if (payload?.ok) {
        setFalPanelPayload(payload);
      }
      return;
    }
    if (kind === "shortdrama-auto") {
      setJournalEvent("fal_shortdrama_auto");
      const payload = await executeCli(
        "Fal 短剧自动选型",
        "fal-shortdrama-auto",
        ["--preset", String(falAutoPreset || "shortdrama-quality").trim() || "shortdrama-quality", "--max-pages", "3", ...buildRetryArgs()],
      );
      if (payload?.ok) {
        const selectedEndpoint = String(payload?.selected_endpoint || "").trim();
        if (selectedEndpoint) {
          setFalVideoModel(selectedEndpoint);
        }
        setFalPanelPayload(payload);
      }
    }
  }, [buildRetryArgs, executeCli, falAutoPreset, falWorkflowKeywords, falWorkflowQuery]);

  const applyFalVideoModel = useCallback(async (endpointId) => {
    const endpoint = String(endpointId || "").trim();
    if (!endpoint) {
      return false;
    }
    setFalApplyingModel(endpoint);
    let payload = null;
    try {
      payload = await executeCli("设置 Fal 视频模型", "config-set", ["--video-provider", "fal", "--fal-video-model", endpoint]);
    } finally {
      setFalApplyingModel("");
    }
    if (payload?.ok) {
      setActiveVideoProvider("fal");
      setFalVideoModel(endpoint);
      setUiNotice({ type: "success", text: `已设置 Fal 模型：${endpoint}` });
      await executeCli("读取项目状态", "session-state", withStateFile([]), { silentSuccess: true });
      return true;
    }
    setUiNotice({ type: "error", text: payload?.error ? `设置 Fal 模型失败：${payload.error}` : "设置 Fal 模型失败" });
    return false;
  }, [executeCli, withStateFile]);

  const applyFalVideoModelAndSmokeRender = useCallback(async (endpointId) => {
    const endpoint = String(endpointId || "").trim();
    if (!endpoint) {
      return;
    }
    const success = await applyFalVideoModel(endpoint);
    if (!success) {
      return;
    }
    const preferredShotId = String(falSmokeShotId || "").trim();
    const firstShotId = String(shotsList?.[0]?.shot_id || "").trim();
    const targetShotId = preferredShotId || firstShotId;
    if (!targetShotId) {
      setUiNotice({ type: "error", text: "未找到可用于试渲染的镜头（shots 为空）" });
      return;
    }
    setFalSmokeResult(null);
    setFalSmokeRenderingModel(endpoint);
    try {
      const payload = await executeCli(
        `试渲染镜头 ${targetShotId}`,
        "render-shot",
        withStateFile([
          "--shot-id",
          targetShotId,
          "--ratio",
          renderRatio.trim() || "9:16",
          "--poll",
          "--approve",
          ...buildRetryArgs(),
          "--download-dir",
          downloadDir.trim() || "videos",
        ]),
      );
      if (payload?.ok) {
        const resultObj = payload.result && typeof payload.result === "object" ? payload.result : {};
        const smokeVideoUrl = String(resultObj.video_url || "");
        const smokeLocalFile = String(resultObj.local_file || "");
        setFalSmokeResult({
          shotId: targetShotId,
          endpoint,
          status: String(resultObj.status || ""),
          videoUrl: smokeVideoUrl,
          localFile: smokeLocalFile,
        });
        setUiNotice({ type: "success", text: `试渲染完成：${targetShotId}` });
        await refreshStep4();
      } else {
        setFalSmokeResult({
          shotId: targetShotId,
          endpoint,
          status: "failed",
          videoUrl: "",
          localFile: "",
        });
        setUiNotice({ type: "error", text: payload?.error ? `试渲染失败：${payload.error}` : "试渲染失败" });
      }
    } finally {
      setFalSmokeRenderingModel("");
    }
  }, [applyFalVideoModel, buildRetryArgs, downloadDir, executeCli, falSmokeShotId, refreshStep4, renderRatio, shotsList, withStateFile]);

  const renderFalPanelResult = useCallback(() => {
    if (!falPanelPayload || typeof falPanelPayload !== "object") {
      return <p className="text-xs text-slate-500">这里会显示 Fal 快捷命令结果，便于快速检查模型与重试策略是否生效。</p>;
    }
    const payload = falPanelPayload;
    const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
    const retryProfile = String(payload.retry_profile || filters.retry_profile || "").trim();
    const retryFallback = Boolean(payload.retry_fallback_applied || filters.retry_fallback_applied);
    const selectedEndpoint = String(payload.selected_endpoint || "").trim();
    const reason = String(payload.reason || "").trim();
    const candidatesCount = Number(payload.candidates_count || 0);
    const workflowCount = Number(payload.count || 0);
    const source = String(payload.source || "").trim();
    const rankedCandidates = Array.isArray(payload.ranked_candidates) ? payload.ranked_candidates : [];
    const topCandidates = rankedCandidates
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        return String(item.endpoint_id || "").trim();
      })
      .filter(Boolean)
      .slice(0, 3);
    const rows = [
      { key: "source", label: "来源", value: source || "-" },
      { key: "retryProfile", label: "重试档位", value: retryProfile || "-" },
      { key: "retryFallback", label: "是否触发回退", value: retryFallback ? "是" : "否" },
      { key: "workflowCount", label: "工作流数量", value: workflowCount > 0 ? String(workflowCount) : "-" },
      { key: "candidatesCount", label: "候选模型数", value: candidatesCount > 0 ? String(candidatesCount) : "-" },
      { key: "endpoint", label: "选中模型", value: selectedEndpoint || "-" },
      { key: "reason", label: "选型理由", value: reason || "-" },
    ];
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          {retryProfile ? <Badge variant="secondary">retry: {retryProfile}</Badge> : null}
          {selectedEndpoint ? <Badge variant="secondary">model: {selectedEndpoint}</Badge> : null}
          {source ? <Badge variant="secondary">source: {source}</Badge> : null}
        </div>
        <div className="grid gap-1 rounded-md border border-slate-200 p-2">
          {rows.map((item) => (
            <div key={`fal-result-${item.key}`} className="grid grid-cols-[120px_1fr] gap-2 text-xs">
              <span className="text-slate-500">{item.label}</span>
              <span className="break-all text-slate-700">{item.value}</span>
            </div>
          ))}
        </div>
        {topCandidates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 rounded-md border border-slate-200 px-2 text-xs"
              value={falSmokeShotId}
              onChange={(event) => setFalSmokeShotId(event.target.value)}
              disabled={running || Boolean(falApplyingModel) || Boolean(falSmokeRenderingModel)}
            >
              <option value="">试渲染镜头：自动取第一个</option>
              {shotsList.map((shot, index) => {
                const shotId = String(shot?.shot_id || `S${String(index + 1).padStart(2, "0")}`).trim();
                if (!shotId) {
                  return null;
                }
                return (
                  <option key={`fal-smoke-shot-${shotId}`} value={shotId}>
                    {shotId}
                  </option>
                );
              })}
            </select>
            {topCandidates.map((endpoint) => (
              <div key={`fal-top-candidate-${endpoint}`} className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => applyFalVideoModel(endpoint)}
                  disabled={running || Boolean(falApplyingModel) || Boolean(falSmokeRenderingModel)}
                >
                  {falApplyingModel === endpoint ? "设置中..." : `设为模型：${endpoint}`}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => applyFalVideoModelAndSmokeRender(endpoint)}
                  disabled={running || Boolean(falApplyingModel) || Boolean(falSmokeRenderingModel)}
                >
                  {falSmokeRenderingModel === endpoint ? "试渲染中..." : `设为模型并试渲染：${endpoint}`}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {falSmokeResult ? (
          <div className="grid gap-1 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
            <div>试渲染镜头：{String(falSmokeResult.shotId || "-")}</div>
            <div>模型：{String(falSmokeResult.endpoint || "-")}</div>
            <div>状态：{String(falSmokeResult.status || "-")}</div>
            <div className="break-all">视频：{String(falSmokeResult.videoUrl || "-")}</div>
            <div className="break-all">本地：{String(falSmokeResult.localFile || "-")}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const localFile = String(falSmokeResult.localFile || "").trim();
                  const videoUrl = String(falSmokeResult.videoUrl || "").trim();
                  if (localFile) {
                    await openLocalVideoPreview(localFile, `试渲染预览 ${String(falSmokeResult.shotId || "")}`);
                    return;
                  }
                  if (videoUrl) {
                    setVideoPreview({ src: videoUrl, title: `试渲染预览 ${String(falSmokeResult.shotId || "")}` });
                  }
                }}
                disabled={!String(falSmokeResult.localFile || "").trim() && !String(falSmokeResult.videoUrl || "").trim()}
              >
                预览试渲染结果
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const shotId = String(falSmokeResult.shotId || "").trim();
                  setActiveMenu("step4");
                  setTaskFilter("all");
                  setTaskSearchKeyword(shotId);
                  setPendingLocateShotId(shotId);
                }}
              >
                在任务里定位镜头
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(String(falSmokeResult.videoUrl || ""), "视频地址已复制")}
                disabled={!String(falSmokeResult.videoUrl || "").trim()}
              >
                复制视频地址
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(String(falSmokeResult.localFile || ""), "本地路径已复制")}
                disabled={!String(falSmokeResult.localFile || "").trim()}
              >
                复制本地路径
              </Button>
            </div>
          </div>
        ) : null}
        <pre className="max-h-64 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    );
  }, [applyFalVideoModel, applyFalVideoModelAndSmokeRender, copyToClipboard, falApplyingModel, falPanelPayload, falSmokeRenderingModel, falSmokeResult, falSmokeShotId, openLocalVideoPreview, running, shotsList]);

  async function retryAllFailedTasks() {
    const failedShotIds = Array.from(
      new Set(
        failedTasks
          .map((task) => String(task?.shot_id || "").trim())
          .filter(Boolean),
      ),
    );
    await retryShotIdsWithConcurrency(failedShotIds, "批量重试失败任务");
  }

  async function retrySelectedTasks() {
    const selectedRows = filteredTaskRows.filter((task) => selectedTaskKeys.includes(getTaskKey(task)));
    const shotIds = Array.from(
      new Set(
        selectedRows
          .map((task) => String(task?.shot_id || "").trim())
          .filter(Boolean),
      ),
    );
    await retryShotIdsWithConcurrency(shotIds, "批量重试所选任务");
  }

  async function mergeWithSelectedShots() {
    const selectedRows = filteredTaskRows.filter((task) => selectedTaskKeys.includes(getTaskKey(task)));
    const selectedShotIds = Array.from(
      new Set(
        selectedRows
          .map((task) => String(task?.shot_id || "").trim())
          .filter(Boolean),
      ),
    );
    if (selectedShotIds.length > 0) {
      const approvePayload = await executeCli(
        "写入已选批准镜头",
        "approve-shots",
        withStateFile(["--shot-ids", selectedShotIds.join(","), "--replace"]),
        { silentSuccess: true },
      );
      if (!approvePayload?.ok) {
        return;
      }
    }
    await executeCli(
      "生成最终视频",
      "merge-approved",
      withStateFile(["--download-dir", downloadDir.trim() || "videos", "--output", mergeOutput.trim() || "approved_merged.mp4"]),
    );
  }

  async function generateVoiceover() {
    const args = [];
    if (ttsScript.trim()) {
      args.push("--script", ttsScript.trim());
    }
    if (ttsApprovedOnly) {
      args.push("--approved-only");
    }
    if (ttsOutputFileName.trim()) {
      args.push("--output", ttsOutputFileName.trim());
    }
    if (ttsAppId.trim()) {
      args.push("--tts-app-id", ttsAppId.trim());
    }
    if (ttsAccessToken.trim()) {
      args.push("--tts-access-token", ttsAccessToken.trim());
    }
    if (ttsVoiceType.trim()) {
      args.push("--tts-voice-type", ttsVoiceType.trim());
    }
    if (selectedModels.audio.trim()) {
      args.push("--tts-resource-id", selectedModels.audio.trim());
    }
    if (ttsBaseUrl.trim()) {
      args.push("--tts-base-url", ttsBaseUrl.trim());
    }
    const payload = await executeCli("生成火山配音", "voiceover-generate", withStateFile(args));
    if (payload?.ok) {
      setUiNotice({ type: "success", text: "旁白音频已生成，可继续给最终视频配音。" });
    }
  }

  async function dubFinalVideoWithVoiceover() {
    const args = [];
    if (finalVideo.trim()) {
      args.push("--video-file", finalVideo.trim());
    }
    if (voiceoverInfo.audio_file.trim()) {
      args.push("--audio-file", voiceoverInfo.audio_file.trim());
    }
    if (dubbedOutputFileName.trim()) {
      args.push("--output", dubbedOutputFileName.trim());
    }
    const payload = await executeCli("给最终视频配音", "dub-final-video", withStateFile(args));
    if (payload?.ok) {
      setUiNotice({ type: "success", text: "已生成带配音的最终视频。" });
    }
  }

  async function playDubbedVideo() {
    const target = String(voiceoverInfo.dubbed_video || "").trim();
    const opened = await openLocalVideoPreview(target, "配音最终视频预览");
    if (!opened) {
      setUiNotice({ type: "error", text: "配音最终视频尚未就绪或本地文件不存在" });
    }
  }

  function cancelRetryBatch() {
    if (!retryBatchRunning) {
      return;
    }
    retryCancelRef.current = true;
    setRetryCancelRequested(true);
    setRetryBatchProgress((prev) => ({ ...prev, current: "正在停止..." }));
  }

  function pauseRetryBatch() {
    if (!retryBatchRunning) {
      return;
    }
    retryPauseRef.current = true;
    setRetryBatchPaused(true);
    setRetryBatchProgress((prev) => ({ ...prev, current: "已暂停" }));
  }

  function resumeRetryBatch() {
    if (!retryBatchRunning) {
      return;
    }
    retryPauseRef.current = false;
    setRetryBatchPaused(false);
    setRetryBatchProgress((prev) => ({ ...prev, current: "恢复中..." }));
  }

  function exportFilteredTasksJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      filter: taskFilter,
      keyword: taskSearchKeyword,
      sort_mode: taskSortMode,
      total: filteredTaskRows.length,
      tasks: filteredTaskRows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `render_tasks_${stamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function getTaskStatusStyle(task) {
    const status = String(task?.status || "").toLowerCase();
    const hasVideo = String(task?.video_url || "").trim().length > 0;
    if (status.includes("failed") || status.includes("error")) {
      return "border-rose-300 bg-rose-50 text-rose-700";
    }
    if (hasVideo || status.includes("success") || status.includes("completed") || status.includes("done")) {
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    }
    return "border-amber-300 bg-amber-50 text-amber-700";
  }

  useEffect(() => {
    if (activeMenu !== "step4" || !autoRefreshStep4) {
      return undefined;
    }
    const seconds = Number(autoRefreshSeconds);
    const waitMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10000;
    const timer = setInterval(() => {
      if (!running) {
        refreshStep4();
      }
    }, waitMs);
    return () => clearInterval(timer);
  }, [activeMenu, autoRefreshStep4, autoRefreshSeconds, running, refreshStep4]);

  useEffect(() => {
    setTaskPage(1);
  }, [taskFilter, taskSearchKeyword, taskSortMode, taskPageSize]);

  useEffect(() => {
    if (taskPage > taskTotalPages) {
      setTaskPage(taskTotalPages);
    }
  }, [taskPage, taskTotalPages]);

  useEffect(() => {
    const raw = localStorage.getItem("openvshot_desktop_prefs");
    if (!raw) {
      return;
    }
    const prefs = parsePayload(raw);
    if (prefs && typeof prefs === "object") {
      if (prefs.taskPageSize) {
        setTaskPageSize(String(prefs.taskPageSize));
      }
      if (prefs.retryConcurrency) {
        setRetryConcurrency(String(prefs.retryConcurrency));
      }
      if (prefs.retryProfile) {
        setRetryProfile(String(prefs.retryProfile));
      }
      if (prefs.retryCount !== undefined && prefs.retryCount !== null) {
        setRetryCount(String(prefs.retryCount));
      }
      if (prefs.retryWait !== undefined && prefs.retryWait !== null) {
        setRetryWait(String(prefs.retryWait));
      }
      if (prefs.autoRefreshSeconds) {
        setAutoRefreshSeconds(String(prefs.autoRefreshSeconds));
      }
      if (prefs.journalTail) {
        setJournalTail(String(prefs.journalTail));
      }
      if (prefs.journalEvent !== undefined && prefs.journalEvent !== null) {
        setJournalEvent(String(prefs.journalEvent));
      }
      if (prefs.journalFormat) {
        setJournalFormat(String(prefs.journalFormat));
      }
      if (prefs.falWorkflowQuery !== undefined && prefs.falWorkflowQuery !== null) {
        setFalWorkflowQuery(String(prefs.falWorkflowQuery));
      }
      if (Array.isArray(prefs.falWorkflowKeywords)) {
        setFalWorkflowKeywords(
          prefs.falWorkflowKeywords
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        );
      }
      if (prefs.falAutoPreset !== undefined && prefs.falAutoPreset !== null) {
        setFalAutoPreset(String(prefs.falAutoPreset));
      }
      if (prefs.falKeywordPreset !== undefined && prefs.falKeywordPreset !== null) {
        setFalKeywordPreset(String(prefs.falKeywordPreset));
      }
      if (prefs.activeVideoProvider !== undefined && prefs.activeVideoProvider !== null) {
        const provider = String(prefs.activeVideoProvider).trim().toLowerCase();
        setActiveVideoProvider(provider === "fal" ? "fal" : "ark");
      }
      if (prefs.savedApiKeyMasked !== undefined && prefs.savedApiKeyMasked !== null) {
        setSavedApiKeyMasked(String(prefs.savedApiKeyMasked));
      }
      if (prefs.falSavedApiKeyMasked !== undefined && prefs.falSavedApiKeyMasked !== null) {
        setFalSavedApiKeyMasked(String(prefs.falSavedApiKeyMasked));
      }
      if (prefs.falVideoModel !== undefined && prefs.falVideoModel !== null) {
        setFalVideoModel(String(prefs.falVideoModel));
      }
      if (prefs.falImageModel !== undefined && prefs.falImageModel !== null) {
        setFalImageModel(String(prefs.falImageModel));
      }
      if (prefs.falSmokeShotId !== undefined && prefs.falSmokeShotId !== null) {
        setFalSmokeShotId(String(prefs.falSmokeShotId));
      }
    }
  }, []);

  useEffect(() => {
    const prefs = {
      taskPageSize,
      retryConcurrency,
      retryProfile,
      retryCount,
      retryWait,
      autoRefreshSeconds,
      journalTail,
      journalEvent,
      journalFormat,
      activeVideoProvider,
      savedApiKeyMasked,
      falSavedApiKeyMasked,
      falVideoModel,
      falImageModel,
      falKeywordPreset,
      falWorkflowQuery,
      falWorkflowKeywords,
      falAutoPreset,
      falSmokeShotId,
    };
    localStorage.setItem("openvshot_desktop_prefs", JSON.stringify(prefs));
  }, [taskPageSize, retryConcurrency, retryProfile, retryCount, retryWait, autoRefreshSeconds, journalTail, journalEvent, journalFormat, activeVideoProvider, savedApiKeyMasked, falSavedApiKeyMasked, falVideoModel, falImageModel, falKeywordPreset, falWorkflowQuery, falWorkflowKeywords, falAutoPreset, falSmokeShotId]);

  useEffect(() => {
    if (activeMenu !== "logs") {
      return;
    }
    if (journalReportPayload) {
      return;
    }
    loadJournalReport();
  }, [activeMenu, journalReportPayload, loadJournalReport]);

  useEffect(() => {
    const raw = localStorage.getItem(workspaceDraftKey);
    if (!raw) {
      return;
    }
    const draft = parsePayload(raw);
    if (!draft || typeof draft !== "object") {
      return;
    }
    pendingDraftRef.current = draft;
    const quickMenu = String(draft.activeMenu || "").trim();
    if (quickMenu && quickMenu !== "settings") {
      setActiveMenu(quickMenu);
    }
  }, []);

  useEffect(() => {
    const draft = pendingDraftRef.current;
    if (!stateFile.trim() || draftRestoredRef.current || !draft || typeof draft !== "object") {
      return;
    }
    if (String(draft.stateFile || "").trim() !== stateFile.trim()) {
      draftRestoredRef.current = true;
      return;
    }
    setChatTitle(String(draft.chatTitle || ""));
    setStory(String(draft.story || ""));
    setScriptSceneCount(String(draft.scriptSceneCount || "3"));
    setScriptKind(String(draft.scriptKind || "short"));
    setSeriesTotalEpisodes(String(draft.seriesTotalEpisodes || "8"));
    setSeriesCurrentEpisode(String(draft.seriesCurrentEpisode || "1"));
    setStep1ScriptMode(String(draft.step1ScriptMode || "ai"));
    setStep1ModePreset("creative");
    setStep1AutoProceedAfterComplete(Boolean(draft.step1AutoProceedAfterComplete ?? true));
    setStep1QualityGateEnabled(Boolean(draft.step1QualityGateEnabled ?? false));
    setStep1QualityReport(draft.step1QualityReport && typeof draft.step1QualityReport === "object" ? draft.step1QualityReport : null);
    setStep1ShortAuditGateEnabled(Boolean(draft.step1ShortAuditGateEnabled ?? false));
    setStep1ShortAuditPlatform(String(draft.step1ShortAuditPlatform || "douyin"));
    setStep1ShortAuditDuration(String(draft.step1ShortAuditDuration || "30"));
    setStep1ShortAuditReport(draft.step1ShortAuditReport && typeof draft.step1ShortAuditReport === "object" ? draft.step1ShortAuditReport : null);
    setStep1SafetyGateEnabled(Boolean(draft.step1SafetyGateEnabled ?? false));
    setStep1SafetyReport(draft.step1SafetyReport && typeof draft.step1SafetyReport === "object" ? draft.step1SafetyReport : null);
    setStep1ChatInput(String(draft.step1ChatInput || ""));
    setStep1ManualSummary(String(draft.step1ManualSummary || ""));
    setStep1Messages(Array.isArray(draft.step1Messages) ? draft.step1Messages : []);
    setStep1PendingSummary(String(draft.step1PendingSummary || ""));
    setStage2Instruction(String(draft.stage2Instruction || ""));
    setScriptResultPreview(String(draft.scriptResultPreview || ""));
    setCharacterList(Array.isArray(draft.characterList) ? draft.characterList : []);
    setSceneList(Array.isArray(draft.sceneList) ? draft.sceneList : []);
    setStoryboardList(Array.isArray(draft.storyboardList) ? draft.storyboardList : []);
    setShotTargetCount(String(draft.shotTargetCount || "12"));
    setShotDurationSec(String(draft.shotDurationSec || "5"));
    setShotInstruction(String(draft.shotInstruction || ""));
    setDownloadDir(String(draft.downloadDir || "videos"));
    setMergeOutput(String(draft.mergeOutput || "approved_merged.mp4"));
    setRenderRatio(String(draft.renderRatio || "9:16"));
    setVideoSize(String(draft.videoSize || "1080x1920"));
    setAssetImageSize(String(draft.assetImageSize || "1024x1024"));
    setArtStyle(String(draft.artStyle || "写实电影感"));
    setFaceMode(String(draft.faceMode || "full_body"));
    setSceneMode(String(draft.sceneMode || "master"));
    setFaceAnglePackEnabled(Boolean(draft.faceAnglePackEnabled ?? true));
    setSceneBindCharacterAnchors(Boolean(draft.sceneBindCharacterAnchors ?? true));
    setStrictSheetLayout(Boolean(draft.strictSheetLayout ?? true));
    const draftMenu = String(draft.activeMenu || "").trim();
    if (draftMenu) {
      if (draftMenu === "settings") {
        setShowSettingsModal(true);
        setActiveMenu("project");
      } else {
        setActiveMenu(draftMenu);
      }
    }
    draftRestoredRef.current = true;
    setUiNotice({ type: "success", text: "已恢复上次编辑草稿" });
  }, [stateFile]);

  useEffect(() => {
    if (!stateFile.trim()) {
      return;
    }
    const draft = {
      stateFile: stateFile.trim(),
      activeMenu,
      chatTitle,
      story,
      scriptSceneCount,
      scriptKind,
      seriesTotalEpisodes,
      seriesCurrentEpisode,
      step1ScriptMode,
      step1ModePreset,
      step1ShowAdvanced,
      step1AutoProceedAfterComplete,
      step1QualityGateEnabled,
      step1QualityReport,
      step1ShortAuditGateEnabled,
      step1ShortAuditPlatform,
      step1ShortAuditDuration,
      step1ShortAuditReport,
      step1SafetyGateEnabled,
      step1SafetyReport,
      step1ChatInput,
      step1ManualSummary,
      step1Messages,
      step1PendingSummary,
      stage2Instruction,
      scriptResultPreview,
      characterList,
      sceneList,
      storyboardList,
      shotTargetCount,
      shotDurationSec,
      shotInstruction,
      downloadDir,
      mergeOutput,
      renderRatio,
      videoSize,
      assetImageSize,
      artStyle,
      faceMode,
      sceneMode,
      faceAnglePackEnabled,
      sceneBindCharacterAnchors,
      strictSheetLayout,
    };
    localStorage.setItem(workspaceDraftKey, JSON.stringify(draft));
  }, [
    stateFile,
    activeMenu,
    chatTitle,
    story,
    scriptSceneCount,
    scriptKind,
    seriesTotalEpisodes,
    seriesCurrentEpisode,
    step1ScriptMode,
    step1ModePreset,
    step1ShowAdvanced,
    step1AutoProceedAfterComplete,
    step1QualityGateEnabled,
    step1QualityReport,
    step1ShortAuditGateEnabled,
    step1ShortAuditPlatform,
    step1ShortAuditDuration,
    step1ShortAuditReport,
    step1SafetyGateEnabled,
    step1SafetyReport,
    step1ChatInput,
    step1ManualSummary,
    step1Messages,
    step1PendingSummary,
    stage2Instruction,
    scriptResultPreview,
    characterList,
    sceneList,
    storyboardList,
    shotTargetCount,
    shotDurationSec,
    shotInstruction,
    downloadDir,
    mergeOutput,
    renderRatio,
    videoSize,
    assetImageSize,
    artStyle,
    faceMode,
    sceneMode,
    faceAnglePackEnabled,
    sceneBindCharacterAnchors,
    strictSheetLayout,
  ]);

  useEffect(() => {
    const keySet = new Set(renderTaskRows.map((task) => getTaskKey(task)));
    setSelectedTaskKeys((prev) => prev.filter((key) => keySet.has(key)));
  }, [getTaskKey, renderTaskRows]);

  useEffect(() => {
    const seen = localStorage.getItem("openvshot_init_seen") === "1";
    const guideSeen = localStorage.getItem("openvshot_first_run_guide_seen") === "1";
    runCliQuiet("project-list", []).then((listPayload) => {
      if (Array.isArray(listPayload?.projects)) {
        setProjectList(listPayload.projects);
      }
      const listedState = String(listPayload?.current_state_file || "").trim();
      if (listedState) {
        setStateFile(listedState);
      }
    });
    if (!seen) {
      setShowInitModal(true);
      setShowSettingsModal(true);
      if (!guideSeen) {
        setShowFirstRunGuide(true);
        setFirstRunGuideStep(0);
      }
      return;
    }
    if (!guideSeen) {
      setShowFirstRunGuide(true);
      setFirstRunGuideStep(0);
    }
    (async () => {
      if (activeVideoProvider === "fal") {
        if (!String(falVideoModel || "").trim()) {
          setShowSettingsModal(true);
          return;
        }
        const listPayload = await runCliQuiet("project-list", []);
        if (Array.isArray(listPayload?.projects)) {
          setProjectList(listPayload.projects);
        }
        const lastStateFile = String(listPayload?.current_state_file || "").trim();
        if (!lastStateFile) {
          return;
        }
        setStateFile(lastStateFile);
        await runCliQuiet("project-use", ["--state-file", lastStateFile]);
        const statePayload = await runCliQuiet("session-state", ["--state-file", lastStateFile]);
        const stageValue = String(statePayload?.status?.stage || statePayload?.state?.workflow?.stage || "").trim();
        setActiveMenu(menuFromStage(stageValue));
        return;
      }
      const payload = await fetchVolcModels({ saveCredentials: false, allowStoredKey: true });
      if (!payload?.ok || !String(payload?.selected_models?.text || "").trim() || !String(payload?.selected_models?.video || "").trim()) {
        setShowSettingsModal(true);
        return;
      }
      const listPayload = await runCliQuiet("project-list", []);
      if (Array.isArray(listPayload?.projects)) {
        setProjectList(listPayload.projects);
      }
      const lastStateFile = String(listPayload?.current_state_file || "").trim();
      if (!lastStateFile) {
        return;
      }
      setStateFile(lastStateFile);
      await runCliQuiet("project-use", ["--state-file", lastStateFile]);
      const statePayload = await runCliQuiet("session-state", ["--state-file", lastStateFile]);
      const stageValue = String(statePayload?.status?.stage || statePayload?.state?.workflow?.stage || "").trim();
      setActiveMenu(menuFromStage(stageValue));
    })();
  }, [activeVideoProvider, falVideoModel, fetchVolcModels, runCliQuiet]);

  const closeFirstRunGuide = useCallback(() => {
    localStorage.setItem("openvshot_first_run_guide_seen", "1");
    setShowFirstRunGuide(false);
  }, []);

  const startFirstRunGuide = useCallback(() => {
    setFirstRunGuideStep(0);
    setShowFirstRunGuide(true);
    openGuideTarget("project");
  }, [openGuideTarget]);

  const nextFirstRunGuideStep = useCallback(() => {
    setFirstRunGuideStep((prev) => {
      if (prev >= firstRunGuideSteps.length - 1) {
        localStorage.setItem("openvshot_first_run_guide_seen", "1");
        setShowFirstRunGuide(false);
        return prev;
      }
      return prev + 1;
    });
  }, [firstRunGuideSteps.length]);

  useEffect(() => {
    if (!showFirstRunGuide || !currentFirstRunGuide?.key || showInitModal) {
      return;
    }
    openGuideTarget(currentFirstRunGuide.key);
  }, [currentFirstRunGuide?.key, openGuideTarget, showFirstRunGuide, showInitModal]);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-6 py-6">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" />
      </div>
      {uiNotice.text ? (
        <div className="pointer-events-none fixed right-6 top-6 z-[70]">
          <div
            className={`pointer-events-auto min-w-80 max-w-[32rem] rounded-xl border px-3 py-2 text-sm shadow-xl backdrop-blur ${
              uiNotice.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : uiNotice.type === "error"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {uiNotice.text}
          </div>
        </div>
      ) : null}
      {showFirstRunGuide && !showInitModal ? (
        <>
          <div className="fixed inset-0 z-[71] bg-slate-950/35 backdrop-blur-[1px]" />
          <div className="fixed bottom-6 right-6 z-[73] w-full max-w-md rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-600">首次使用引导</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{currentFirstRunGuide?.title}</div>
            <div className="mt-2 text-sm text-slate-600">{currentFirstRunGuide?.description}</div>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              第 {Math.min(firstRunGuideStep + 1, firstRunGuideSteps.length)} / {firstRunGuideSteps.length} 步。高亮区域已标出，按顺序看一遍就能快速上手。
            </div>
            <div className="mt-3 text-xs text-slate-500">点击当前高亮区域也会自动进入下一步。</div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => openGuideTarget(currentFirstRunGuide?.key)}>
                定位到高亮区域
              </Button>
              <Button variant="outline" onClick={closeFirstRunGuide}>
                跳过引导
              </Button>
              <Button onClick={nextFirstRunGuideStep}>
                {firstRunGuideStep >= firstRunGuideSteps.length - 1 ? "完成引导" : "下一步"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
      <Card className="overflow-hidden rounded-2xl border-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-white shadow-xl">
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xl font-semibold tracking-tight">OpenVShot 桌面工作台</div>
            <Badge variant={result.ok ? "secondary" : "outline"} className={result.ok ? "bg-emerald-500/25 text-emerald-100" : "bg-rose-500/25 text-rose-100"}>
              {result.ok ? "状态正常" : "需要处理"}
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/20 bg-white/10 p-3">
              <div className="text-xs text-slate-100/75">当前项目</div>
              <div className="mt-1 text-sm font-medium text-white">{projectTitle}</div>
              <div className="mt-1 text-xs text-slate-100/85">阶段：{projectStage || "idle"} ｜ 下一步：{projectNextAction || "等待操作"}</div>
            </div>
            <div className="rounded-xl border border-white/20 bg-white/10 p-3">
              <div className="text-xs text-slate-100/75">模式与成本</div>
              <div className="mt-1 text-sm font-medium text-white">{activeVideoProvider === "fal" ? "FAL 模式" : "火山模式"}</div>
              <div className="mt-1 text-xs text-slate-100/85">{activeVideoProvider === "fal" ? `视频：${String(falVideoModel || "").trim() || "未设置"} ｜ 图片：${String(falImageModel || "").trim() || "未设置"}` : `火山视频：${String(selectedModels.video || "").trim() || "未设置"}`}</div>
              <div className="mt-1 text-xs text-slate-100/85">累计预估费用：{usageSummary.currency} {Number(usageSummary.total_estimated_cost || 0).toFixed(6)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={showProjectModal ? "default" : "outline"}
              className={`h-8 gap-1 border-white/45 bg-white/15 text-xs text-white hover:bg-white/25 ${guideHighlightClass("project")}`}
              onClick={() =>
                handleGuideTargetClick("project", () => {
                  setActiveMenu("project");
                  setProjectModalTab(hasProject ? "open" : "create");
                  setShowProjectModal(true);
                })
              }
            >
              <FolderOpen className="h-3.5 w-3.5" />
              项目管理
            </Button>
            <Button size="sm" variant={showSettingsModal ? "default" : "outline"} className={`h-8 gap-1 border-white/45 bg-white/15 text-xs text-white hover:bg-white/25 ${guideHighlightClass("settings")}`} onClick={() => handleGuideTargetClick("settings", () => setShowSettingsModal(true))}>
              <Settings className="h-3.5 w-3.5" />
              模型设置
            </Button>
            <Button size="sm" variant="outline" className="h-8 border-white/45 bg-white/15 text-xs text-white hover:bg-white/25" onClick={startFirstRunGuide}>
              新手引导
            </Button>
            <Button size="sm" variant={activeMenu === "logs" ? "default" : "outline"} className="h-8 border-white/45 bg-white/15 text-xs text-white hover:bg-white/25" onClick={() => setActiveMenu("logs")}>
              执行日志
            </Button>
            <Button size="sm" variant={activeMenu === "debug" ? "default" : "outline"} className="h-8 border-white/45 bg-white/15 text-xs text-white hover:bg-white/25" onClick={() => setActiveMenu("debug")}>
              调试面板
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-5">
      <aside className="sticky top-6 h-[calc(100vh-3rem)] w-64 shrink-0 self-start overflow-y-auto">
        <Card className={`rounded-2xl border border-slate-200/80 bg-white/85 shadow-sm backdrop-blur ${guideHighlightClass("nav")}`} onClick={() => handleGuideTargetClick("nav", () => setActiveMenu(hasProject ? "step1" : "project"))}>
          <CardHeader>
            <CardTitle>主流程</CardTitle>
            <CardDescription>只保留 4 个核心步骤，辅助入口已移到顶部</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              当前阶段：{projectStage || "idle"} ｜ 模型状态：{hasModelSetup ? "已就绪" : "未完成"}
            </div>
            <div className="grid gap-2">
              <WorkflowNavButton active={activeMenu === "step1"} disabled={!hasProject || !hasModelSetup} icon={<MessageCircle className="h-4 w-4" />} title="第一步：剧本阶段" description="写故事、生成剧本、完成体检" onClick={() => setActiveMenu("step1")} />
              <WorkflowNavButton active={activeMenu === "step2"} disabled={!getStepDone("step1")} icon={<Sparkles className="h-4 w-4" />} title="第二步：角色场景" description="整理角色、场景、分镜文本" onClick={() => setActiveMenu("step2")} />
              <WorkflowNavButton active={activeMenu === "step3"} disabled={!getStepDone("step2")} icon={<Images className="h-4 w-4" />} title="第三步：素材分镜" description="统一设定素材，再生成镜头" onClick={() => setActiveMenu("step3")} />
              <WorkflowNavButton active={activeMenu === "step4"} disabled={!getStepDone("step3")} icon={<Clapperboard className="h-4 w-4" />} title="第四步：渲染合成" description="看进度、处理失败、输出成片" onClick={() => setActiveMenu("step4")} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              辅助入口：顶部可打开项目管理、模型设置、执行日志、调试面板。
            </div>
          </CardContent>
        </Card>
      </aside>

      <section className="min-w-0 flex-1 space-y-5">
      

      {showProjectModal && !showInitModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]" onClick={closeProjectModal}>
          <div className="w-full max-w-5xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h2 className="text-lg font-semibold">项目管理</h2>
                <p className="mt-1 text-sm text-muted-foreground">{hasProject ? `当前项目：${projectTitle}` : "请先选择项目目录并完成初始化"}</p>
              </div>
              <Button variant="outline" onClick={closeProjectModal}>
                关闭
              </Button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 lg:grid-cols-4">
                {projectModalStatusCards.map((item) => (
                  <div key={`project-status-${item.key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                当前模式说明：{activeVideoProvider === "fal" ? "FAL 模式下只走 FAL 视频/图片模型；Fal 快捷选型与诊断只在该模式开放。" : "火山模式下只走火山视频模型；项目创建、脚本与渲染主链路更简洁。"} ｜ 当前模型状态：{providerReadyText}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={projectModalTab === "create" ? "default" : "outline"} onClick={() => setProjectModalTab("create")}>
                  新建项目
                </Button>
                <Button size="sm" variant={projectModalTab === "open" ? "default" : "outline"} onClick={() => setProjectModalTab("open")}>
                  打开 / 切换
                </Button>
                <Button size="sm" variant={projectModalTab === "fal" ? "default" : "outline"} onClick={() => setProjectModalTab("fal")}>
                  FAL 工具
                </Button>
              </div>
              {projectModalTab === "create" ? (
                <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                  <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">1. 创建新项目</div>
                      <div className="mt-1 text-xs text-slate-500">先填项目名与目录，创建后自动进入第一步剧本编辑。</div>
                    </div>
                    <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="项目名称" />
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                      项目类型跟随第一步“剧本类型”：{scriptKind === "series" ? "连续剧短剧" : "单集短片"}
                    </div>
                    <Input value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} placeholder="项目根目录（必填，如 D:/OpenVShot）" />
                    <Button onClick={pickProjectDirectory} disabled={running} variant="outline">
                      选择项目目录
                    </Button>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                      state 文件路径：{projectStatePathPreview}
                    </div>
                    <Button
                      onClick={async () => {
                        const createType = scriptKind === "series" ? "series" : "short";
                        const createArgs = [
                          "--name",
                          projectName.trim() || "my-short-project",
                          "--root",
                          projectRoot.trim(),
                          "--project-type",
                          createType,
                        ];
                        if (createType === "series") {
                          const episode = Math.max(1, Number(seriesCurrentEpisode) || 1);
                          const seriesName = chatTitle.trim() || projectName.trim() || "my-series";
                          createArgs.push("--series-name", seriesName, "--episode-index", String(episode));
                        }
                        const payload = await executeCli("初始化项目", "project-init", createArgs);
                        if (payload?.ok) {
                          const targetState = String(payload?.state_file || "").trim() || stateFile.trim();
                          if (targetState) {
                            await executeCli("启动会话", "session-start", ["--state-file", targetState]);
                            await executeCli("读取项目状态", "session-state", ["--state-file", targetState]);
                          } else {
                            await executeCli("启动会话", "session-start", withStateFile([]));
                            await executeCli("读取项目状态", "session-state", withStateFile([]));
                          }
                          setProjectTitle(String(payload?.project_name || projectName.trim() || "my-short-project"));
                          setUiNotice({ type: "success", text: `项目创建成功：${projectName.trim() || "my-short-project"}` });
                          setActiveMenu("step1");
                          setShowProjectModal(false);
                        }
                      }}
                      disabled={running || !projectRoot.trim()}
                    >
                      创建项目
                    </Button>
                  </div>
                  <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                    <div className="text-sm font-semibold text-slate-900">创建前检查</div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      当前模式：{activeVideoProvider === "fal" ? "FAL 模式" : "火山模式"}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      模型状态：{providerReadyText}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      推荐流程：先建项目 → 改剧本 → 提取角色/场景/分镜 → 最后批量渲染。
                    </div>
                    <Button onClick={() => executeCli("刷新项目列表", "project-list", [])} disabled={running} variant="secondary">
                      刷新项目列表
                    </Button>
                  </div>
                </div>
              ) : null}
              {projectModalTab === "open" ? (
                <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
                  <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">2. 打开或切换项目</div>
                      <div className="mt-1 text-xs text-slate-500">支持按名称快速切换，也支持从列表直接打开。</div>
                    </div>
                    <Input value={projectSelectName} onChange={(event) => setProjectSelectName(event.target.value)} placeholder="输入项目名快速切换" />
                    <Button
                      onClick={async () => {
                        const payload = await executeCli(
                          "切换项目",
                          "project-use",
                          projectSelectName.trim() ? ["--name", projectSelectName.trim()] : withStateFile([]),
                        );
                        if (payload?.ok) {
                          await executeCli("读取项目状态", "session-state", withStateFile([]));
                          setActiveMenu("step1");
                          setShowProjectModal(false);
                        }
                      }}
                      disabled={running}
                      variant="secondary"
                    >
                      按名称切换项目
                    </Button>
                    {canCreateNextEpisode ? (
                      <Button
                        onClick={async () => {
                          const payload = await executeCli("创建下一集（继承素材）", "project-next-episode", withStateFile([]));
                          if (!payload?.ok) {
                            return;
                          }
                          const targetState = String(payload?.state_file || "").trim();
                          if (targetState) {
                            await executeCli("切换到下一集", "project-use", ["--state-file", targetState]);
                            await executeCli("启动下一集会话", "session-start", ["--state-file", targetState]);
                            await executeCli("读取下一集状态", "session-state", ["--state-file", targetState]);
                          }
                          setUiNotice({ type: "success", text: "下一集已创建并继承素材配置" });
                          setActiveMenu("step1");
                          setShowProjectModal(false);
                        }}
                        disabled={running || !stateFile.trim()}
                        variant="outline"
                      >
                        创建下一集（继承素材）
                      </Button>
                    ) : (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
                        当前项目为单集短片，不显示“创建下一集”。
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                    <div className="text-sm font-semibold text-slate-900">项目列表</div>
                    <div className="max-h-80 overflow-auto rounded-md border border-slate-200 p-2 text-sm">
                      {projectList.length === 0
                        ? "暂无项目记录，先初始化一个项目。"
                        : projectList.map((item, index) => {
                            const name = String(item?.name || "").trim() || `项目${index + 1}`;
                            const rowStateFile = String(item?.state_file || "").trim();
                            const deleting = deletingProjectStateFile === rowStateFile;
                            return (
                              <div key={`${name}-${index}`} className="mb-2 rounded-md border border-slate-200 p-2">
                                <div className="font-medium">{name}</div>
                                <div className="mb-2 text-xs text-slate-500">{rowStateFile}</div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      if (!rowStateFile) {
                                        return;
                                      }
                                      setStateFile(rowStateFile);
                                      await executeCli("切换项目", "project-use", ["--state-file", rowStateFile]);
                                      await executeCli("读取项目状态", "session-state", ["--state-file", rowStateFile]);
                                      setActiveMenu("step1");
                                      setShowProjectModal(false);
                                    }}
                                    disabled={running || deleting}
                                  >
                                    使用
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => deleteProject(item)}
                                    disabled={running || deleting}
                                  >
                                    {deleting ? "删除中..." : "删除"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                    </div>
                  </div>
                </div>
              ) : null}
              {projectModalTab === "fal" ? (
                <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold">Fal 与诊断快捷设置</h3>
                {activeVideoProvider === "fal" ? (
                  <>
                    {renderRetryControls({ showConcurrency: false, disablePreset: running })}
                    <div className="grid gap-2 md:grid-cols-3">
                      <Input
                        value={falWorkflowQuery}
                        onChange={(event) => {
                          setFalWorkflowQuery(event.target.value);
                          setFalKeywordPreset("custom");
                        }}
                        placeholder="Fal workflow 查询关键词"
                      />
                      <select className="h-10 rounded-md border border-slate-200 px-2 text-sm" value={falKeywordPreset} onChange={(event) => applyFalKeywordPreset(event.target.value)}>
                        {falWorkflowKeywordPresets.map((item) => (
                          <option key={`fal-keyword-preset-${item.value}`} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <select className="h-10 rounded-md border border-slate-200 px-2 text-sm" value={falAutoPreset} onChange={(event) => setFalAutoPreset(event.target.value)}>
                        {falAutoPresetOptions.map((item) => (
                          <option key={`fal-preset-${item.value}`} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <Button variant="outline" onClick={() => setActiveMenu("logs")} disabled={running}>
                        前往日志页看报表
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {falWorkflowKeywordOptions.map((item) => (
                        <Button
                          key={`fal-query-${item.value}`}
                          size="sm"
                          variant={Array.isArray(falWorkflowKeywords) && falWorkflowKeywords.includes(item.value) ? "default" : "outline"}
                          onClick={() =>
                            setFalWorkflowKeywords((prev) => {
                              const list = Array.isArray(prev) ? prev : [];
                              setFalKeywordPreset("custom");
                              if (list.includes(item.value)) {
                                return list.filter((x) => x !== item.value);
                              }
                              return [...list, item.value];
                            })
                          }
                          disabled={running}
                        >
                          关键词：{item.label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFalWorkflowKeywords([]);
                          setFalKeywordPreset("custom");
                        }}
                        disabled={running || !Array.isArray(falWorkflowKeywords) || falWorkflowKeywords.length === 0}
                      >
                        清空关键词
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => runFalQuickAction("workflow-list")} disabled={running || !falModeReady}>
                        查询 Fal 工作流
                      </Button>
                      <Button variant="secondary" onClick={() => runFalQuickAction("shortdrama-auto")} disabled={running || !falModeReady}>
                        执行 Fal 自动选型
                      </Button>
                      <Button variant="outline" onClick={loadJournalReport} disabled={running}>
                        刷新 Journal 报表
                      </Button>
                    </div>
                    {!falModeReady ? <p className="text-xs text-amber-700">请先在设置中配置 FAL 密钥与 FAL 视频模型，再执行 Fal 快捷操作。</p> : null}
                    {!falImageReady ? <p className="text-xs text-amber-700">建议同时配置 FAL 图片模型，确保角色/场景图片生成也走 FAL。</p> : null}
                    {renderFalPanelResult()}
                  </>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    当前视频提供商为火山。Fal 快捷操作已隐藏；切换到“视频提供商：FAL”后再使用 Fal 选型与诊断。
                  </div>
                )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Card className={`rounded-2xl border border-slate-200/80 bg-white/85 shadow-sm backdrop-blur ${guideHighlightClass("workspace")}`} onClick={() => handleGuideTargetClick("workspace", () => setActiveMenu(hasProject ? "step1" : "project"))}>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          {projectModalStatusCards.map((item) => (
            <div key={`workspace-status-${item.key}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{item.value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {activeMenu === "step1" ? (
        <Card className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle>第一步：剧本阶段</CardTitle>
            <CardDescription>输入一句话或一段故事，AI生成剧本；你改好后直接进入第二步提取。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SummaryCardGrid items={step1StatusCards} prefix="step1-status" />
            <div className="grid gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50 to-cyan-50 p-4">
              <div className="text-sm font-semibold text-indigo-700">操作指引（30 秒上手）</div>
              <div className="grid gap-2 text-xs text-indigo-700/90 md:grid-cols-3">
                <div className="rounded-lg border border-indigo-200/70 bg-white/80 p-2">① 输入一句话想法或故事</div>
                <div className="rounded-lg border border-indigo-200/70 bg-white/80 p-2">② 点击“生成剧本”并直接修改</div>
                <div className="rounded-lg border border-indigo-200/70 bg-white/80 p-2">③ 点击进入第二步自动提取</div>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-xs text-slate-600">剧本类型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={scriptKind} onChange={(event) => setScriptKind(event.target.value)}>
                    <option value="short">单集短片</option>
                    <option value="series">连续剧短剧</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-600">当前集数</label>
                  <Input value={seriesCurrentEpisode} onChange={(event) => setSeriesCurrentEpisode(event.target.value)} placeholder="例如 1" disabled={scriptKind !== "series"} />
                </div>
              </div>
              <label className="text-xs text-slate-600">目标场景数（建议 2-4）</label>
              <Input value={scriptSceneCount} onChange={(event) => setScriptSceneCount(event.target.value)} placeholder="例如 3" />
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <SectionLead title="创意输入与剧本编辑" description="左边先确定脚本参数，接着输入一句话想法；生成后直接在“当前剧本”里改，不需要跳来跳去。" />
              {step1ShowAdvanced ? (
                <div className="flex flex-wrap gap-2">
                  {["快节奏反转喜剧", "现实向嘴硬反讽", "悬疑开场30秒入冲突"].map((preset) => (
                    <Button key={preset} size="sm" variant="outline" onClick={() => setStep1ChatInput(preset)} disabled={running || step1Streaming}>
                      {preset}
                    </Button>
                  ))}
                </div>
              ) : null}
              <label className="text-xs text-slate-600">一句话想法 / 你的故事（输入后点生成）</label>
              <div className="flex gap-2">
                <Textarea
                  value={step1ChatInput}
                  onChange={(event) => setStep1ChatInput(event.target.value)}
                  onKeyDown={handleStep1InputKeyDown}
                  placeholder="例如：一个女生在地铁站收到未来自己的短信，最后反转。"
                />
                <div className="flex h-auto shrink-0 flex-col gap-2">
                  <Button onClick={submitStep1Chat} disabled={running || step1Streaming} className="h-auto">
                    {step1Streaming ? "生成中..." : "生成剧本"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      requestAiSuggestion({
                        kind: "script",
                        text: step1ChatInput,
                        context: `脚本类型:${scriptKind}; 场景数:${scriptSceneCount}; 平台:${step1ShortAuditPlatform}; 时长:${step1ShortAuditDuration}`,
                        onApply: setStep1ChatInput,
                        successText: "已补全输入想法，可直接生成剧本",
                      })
                    }
                    disabled={running || step1Streaming}
                    className="h-auto"
                  >
                    AI建议
                  </Button>
                </div>
              </div>
              <label className="text-xs text-slate-600">当前剧本（可直接修改）</label>
              <Textarea
                value={story}
                onChange={(event) => setStory(event.target.value)}
                placeholder="AI生成后会自动填入这里，你可以继续手动改。"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    requestAiSuggestion({
                      kind: "script_refine",
                      text: story,
                      context: `脚本类型:${scriptKind}; 当前集数:${seriesCurrentEpisode}`,
                      onApply: setStory,
                      successText: "已优化剧本文本",
                    })
                  }
                  disabled={running || step1Streaming || !String(story || "").trim()}
                >
                  AI建议优化剧本
                </Button>
              </div>
              {step1ShowAdvanced ? (
                <div className="h-[14rem] space-y-3 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3">
                  {step1Messages.length === 0 ? <p className="text-sm text-slate-500">高级对话记录为空</p> : null}
                  {step1Messages.map((item) => (
                    <div key={item.id} className={`max-w-[86%] rounded-xl px-3 py-2 text-sm leading-relaxed ${item.role === "user" ? "ml-auto bg-blue-600 text-white" : "bg-white text-slate-700"}`}>
                      {item.text}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <SectionLead title="下一步前检查" description="先看卡点与体检状态，确认通过后再进入第二步。" />
                <div className="text-xs text-slate-600">你只需要三步：输入一句话 → 生成并修改剧本 → 进入第二步自动提取。</div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button onClick={handleFinishStep1} disabled={running || !story.trim()} variant="default">
                    下一步：提取角色、场景、分镜
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStep1ShowAdvanced((prev) => !prev)} disabled={running || step1Streaming}>
                    {step1ShowAdvanced ? "收起高级选项" : "显示高级选项"}
                  </Button>
                </div>
                {step1ShowAdvanced ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-slate-700">第一步模式</div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant={step1ModePreset === "creative" ? "default" : "outline"} onClick={() => applyStep1ModePreset("creative")} disabled={running || step1Streaming}>
                          创意模式（默认）
                        </Button>
                        <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">严格模式（备选，当前不启用）</span>
                      </div>
                    </div>
                    <div className="text-xs font-medium text-slate-700">进入下一步前的完成标准</div>
                    <div className="grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                  <div className={step1CharsReady ? "text-emerald-600" : "text-rose-600"}>
                    {step1CharsReady ? "✓ 剧本字数达标" : `• 字数不足：当前 ${step1StoryText.length} / 目标 ${step1MinChars}`}
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full ${step1CharsReady ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${step1CharsProgress}%` }} />
                    </div>
                  </div>
                  <div className={step1LinesReady ? "text-emerald-600" : "text-rose-600"}>
                    {step1LinesReady ? "✓ 剧本分段达标" : `• 分段不足：当前 ${step1LineCount} 段 / 目标 ${step1MinLines} 段`}
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full ${step1LinesReady ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${step1LinesProgress}%` }} />
                    </div>
                  </div>
                  <div className={step1SceneReady ? "text-emerald-600" : "text-amber-600"}>
                    {step1SceneReady ? "✓ 场景数已确认" : "• 请确认场景数（1-8）"}
                  </div>
                  <div className={step1EpisodeReady ? "text-emerald-600" : "text-amber-600"}>
                    {step1EpisodeReady ? "✓ 集数设置正常" : "• 剧集模式请填写当前集数"}
                  </div>
                  <div className="text-slate-500">
                    {step1ScriptMode === "ai" ? "AI模式：建议至少发送1次并得到完整剧本回复" : "手动模式：可直接粘贴剧本，或先AI扩写再继续"}
                  </div>
                </div>
                <div className={`rounded-md px-2 py-1 text-xs ${step1BaseReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {step1AdviceText}
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="mb-2 text-xs text-slate-600">严格门控状态：{step1GateEnabledCount > 0 ? `${step1GatePassCount}/${step1GateEnabledCount} 通过` : "未开启门控"}</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {step1GateSignals.map((item) => {
                      const statusText = !item.enabled ? "关闭" : !item.report ? "未检测" : item.report.pass ? "通过" : "未通过";
                      const statusClass = !item.enabled
                        ? "border-slate-200 bg-slate-50 text-slate-500"
                        : !item.report
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : item.report.pass
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700";
                      return (
                        <div key={item.key} className={`rounded-md border px-2 py-1 text-xs ${statusClass}`}>
                          <div className="font-medium">{item.label}</div>
                          <div>{statusText}{item.metric ? ` · ${item.metric}` : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-700">剧本结构体检（硬门控）</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={step1QualityGateEnabled ? "default" : "outline"} onClick={() => setStep1QualityGateEnabled((prev) => !prev)} disabled={running || step1Streaming}>
                        {step1QualityGateEnabled ? "结构门控：开" : "结构门控：关"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => runStep1QualityCheck()} disabled={running || step1Streaming || !story.trim()}>
                        立即体检
                      </Button>
                    </div>
                  </div>
                  {step1QualityReport ? (
                    <div className="grid gap-1 text-xs text-slate-600 md:grid-cols-3">
                      <div className={step1QualityReport.pass ? "text-emerald-600" : "text-rose-600"}>总分：{Number(step1QualityReport.total || 0)}</div>
                      <div>冲突：{Number(step1QualityReport.conflict || 0)} ｜ 反转：{Number(step1QualityReport.twist || 0)}</div>
                      <div>钩子：{Number(step1QualityReport.hook || 0)} ｜ 目标：{Number(step1QualityReport.goal || 0)}</div>
                      <div>回扣：{Number(step1QualityReport.payoff || 0)} ｜ 可拍摄：{Number(step1QualityReport.shootability || 0)}</div>
                      <div className="md:col-span-2">{String(step1QualityReport.summary || "")}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">建议在进入第二步前执行一次体检，确保冲突、反转、钩子达标。</div>
                  )}
                </div>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-700">短视频运营体检（钩子/完播/CTA）</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={step1ShortAuditGateEnabled ? "default" : "outline"} onClick={() => setStep1ShortAuditGateEnabled((prev) => !prev)} disabled={running || step1Streaming}>
                        {step1ShortAuditGateEnabled ? "运营门控：开" : "运营门控：关"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => runStep1ShortvideoAudit()} disabled={running || step1Streaming || !story.trim()}>
                        立即体检
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <select className="h-8 rounded-md border border-slate-200 px-2 text-xs" value={step1ShortAuditPlatform} onChange={(event) => setStep1ShortAuditPlatform(event.target.value)}>
                      <option value="douyin">抖音</option>
                      <option value="shipinhao">视频号</option>
                      <option value="bilibili">B站</option>
                    </select>
                    <Input value={step1ShortAuditDuration} onChange={(event) => setStep1ShortAuditDuration(event.target.value)} placeholder="目标时长（秒）" className="h-8 text-xs" />
                  </div>
                  {step1ShortAuditReport ? (
                    <div className="grid gap-1 text-xs text-slate-600 md:grid-cols-3">
                      <div className={step1ShortAuditReport.pass ? "text-emerald-600" : "text-rose-600"}>总分：{Number(step1ShortAuditReport.total || 0)}</div>
                      <div>3秒钩子：{Number(step1ShortAuditReport.hook_3s || 0)} ｜ 中段留存：{Number(step1ShortAuditReport.retention_mid || 0)}</div>
                      <div>CTA：{Number(step1ShortAuditReport.cta_strength || 0)} ｜ 节奏：{Number(step1ShortAuditReport.rhythm_fit || 0)}</div>
                      <div>平台适配：{Number(step1ShortAuditReport.platform_fit || 0)} ｜ 安全：{Number(step1ShortAuditReport.risk_safety || 0)}</div>
                      <div className="md:col-span-2">{String(step1ShortAuditReport.summary || "")}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">用于检查前三秒钩子、完播点和转化动作是否符合平台短视频规律。</div>
                  )}
                </div>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-700">版权与敏感内容审查（硬门控）</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={step1SafetyGateEnabled ? "default" : "outline"} onClick={() => setStep1SafetyGateEnabled((prev) => !prev)} disabled={running || step1Streaming}>
                        {step1SafetyGateEnabled ? "安全门控：开" : "安全门控：关"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => runStep1SafetyAudit()} disabled={running || step1Streaming || !story.trim()}>
                        立即审查
                      </Button>
                    </div>
                  </div>
                  {step1SafetyReport ? (
                    <div className="grid gap-1 text-xs text-slate-600 md:grid-cols-3">
                      <div className={step1SafetyReport.pass ? "text-emerald-600" : "text-rose-600"}>风险等级：{String(step1SafetyReport.risk_level || "unknown")}</div>
                      <div>版权安全：{Number(step1SafetyReport.copyright_risk || 0)}</div>
                      <div>敏感安全：{Number(step1SafetyReport.sensitive_risk || 0)} ｜ 品牌安全：{Number(step1SafetyReport.brand_safety || 0)}</div>
                      <div className="md:col-span-2">{String(step1SafetyReport.summary || "")}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">用于识别版权侵权、敏感表达、品牌安全风险，高风险时阻断进入第二步。</div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span>点击后自动进入第二步，并尝试提取角色、场景、分镜。</span>
                    {!step1BaseReady ? (
                      <>
                        <Button
                          size="sm"
                          variant={step1AutoProceedAfterComplete ? "default" : "outline"}
                          onClick={() => setStep1AutoProceedAfterComplete((prev) => !prev)}
                          disabled={running || step1Streaming}
                        >
                          {step1AutoProceedAfterComplete ? "补全后自动进入第二步：开" : "补全后自动进入第二步：关"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={autoCompleteStep1Ready} disabled={running || step1Streaming}>
                          一键自动补全
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button onClick={handleFinishStep1} disabled={step1FinishDisabled} variant="default">
                      {step1FinishDisabled ? "请先处理卡点后再继续" : "确认最终剧本并进入下一步"}
                    </Button>
                    {step1PrimaryBlocker ? (
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-rose-600">当前卡点：{step1PrimaryBlocker.label}</div>
                        <Button size="sm" variant="outline" onClick={handleStep1PrimaryBlockerAction} disabled={running || step1Streaming}>
                          {step1PrimaryBlocker.actionText || "立即处理"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleStep1ResolveAllBlockers} disabled={running || step1Streaming || step1ResolveAllProgress.running}>
                          {step1ResolveAllProgress.running ? "处理中..." : "处理全部卡点"}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs text-emerald-600">当前卡点：无，可进入下一步</div>
                    )}
                    {step1ResolveAllProgress.running || step1ResolveAllProgress.current ? (
                      <div className="text-xs text-slate-500">
                        全量处理进度：{Math.max(0, Number(step1ResolveAllProgress.done || 0))}/{Math.max(0, Number(step1ResolveAllProgress.total || 0))}
                        {step1ResolveAllProgress.current ? ` ｜ 当前步骤：${step1ResolveAllProgress.current}` : ""}
                      </div>
                    ) : null}
                  </div>
                    </div>
                  </>
                ) : null}
              </div>
              {step1ShowAdvanced && scriptKind === "series" && step1ScriptMode === "ai" ? (
                <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-600">生成完整剧本后，再输入总集数并让 AI 分集。</div>
                  <div className="flex gap-2">
                    <Input value={seriesTotalEpisodes} onChange={(event) => setSeriesTotalEpisodes(event.target.value)} placeholder="总集数，例如 8" />
                    <Button variant="secondary" onClick={splitSeriesByEpisodeCount} disabled={running || step1Streaming || !story.trim()}>
                      按集数AI分集
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeMenu === "step2" ? (
        <Card className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle>第二步：角色场景与分镜文本</CardTitle>
            <CardDescription>这里主要做审阅与修改。你可以不改，直接点击“修改完成，进入下一步”。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SummaryCardGrid items={step2StatusCards} prefix="step2-status" />
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <SectionLead title="修改说明与流程入口" description="先写第二步修改要求，再决定是否重新自动提取；确认后直接进入第三步生成素材。" />
              <Textarea value={stage2Instruction} onChange={(event) => setStage2Instruction(event.target.value)} placeholder="第二步修改要求" />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    requestAiSuggestion({
                      kind: "stage2_instruction",
                      text: stage2Instruction,
                      context: `脚本类型:${scriptKind}; 场景数:${scriptSceneCount}`,
                      onApply: setStage2Instruction,
                      successText: "已补全第二步修改要求",
                    })
                  }
                  disabled={running}
                >
                  AI建议
                </Button>
              </div>
              <Input value={shotTargetCount} onChange={(event) => setShotTargetCount(event.target.value)} placeholder="分镜数量上限（例如 8 或 12）" />
              <div className="grid gap-2 md:grid-cols-2">
                <Button onClick={generateAllStage2Parts} disabled={running}>
                  从剧本自动提取（可选）
                </Button>
                <Button
                  onClick={proceedToStep3}
                  disabled={running}
                  variant="secondary"
                >
                  修改完成，进入下一步
                </Button>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-[0.95fr_0.95fr_1.1fr]">
              <div className="grid content-start gap-3 rounded-lg border border-slate-200 p-4">
                <SectionLead title="角色卡片" description="逐个编辑角色名、角色描述与角色 Prompt，角色设定会直接影响后续素材生成。" />
                <h3 className="text-sm font-semibold">角色卡片</h3>
                <div className="grid auto-rows-min content-start items-start gap-2 md:grid-cols-2">
                  {characterList.map((item, index) => (
                    <div key={`character-${index}`} className="grid gap-2 rounded-md border border-slate-200 p-2">
                      <Input
                        value={String(item?.name || "")}
                        onChange={(event) =>
                          setCharacterList((prev) => prev.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))
                        }
                        placeholder="角色名"
                      />
                      <Textarea
                        value={String(item?.description || "")}
                        onChange={(event) =>
                          setCharacterList((prev) => prev.map((row, i) => (i === index ? { ...row, description: event.target.value } : row)))
                        }
                        placeholder="角色描述"
                      />
                      <Textarea
                        value={String(item?.prompt || "")}
                        onChange={(event) =>
                          setCharacterList((prev) => prev.map((row, i) => (i === index ? { ...row, prompt: event.target.value } : row)))
                        }
                        placeholder="角色Prompt"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            requestAiSuggestion({
                              kind: "character_prompt",
                              text: String(item?.prompt || item?.description || item?.name || ""),
                              context: `角色名:${String(item?.name || "")}; 角色描述:${String(item?.description || "")}`,
                              onApply: (suggestion) =>
                                setCharacterList((prev) => prev.map((row, i) => (i === index ? { ...row, prompt: suggestion } : row))),
                              successText: "已补全角色Prompt",
                            })
                          }
                          disabled={running}
                        >
                          AI建议
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCharacterList((prev) => prev.filter((_, i) => i !== index))}
                      >
                        删除角色
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCharacterList((prev) => [...prev, { name: "", description: "", prompt: "" }])}
                >
                  新增角色
                </Button>
              </div>
              <div className="grid content-start gap-3 rounded-lg border border-slate-200 p-4">
                <SectionLead title="场景卡片" description="在这里统一整理场景名称、场景描述和场景 Prompt，后续场景素材会按这里的定义生成。" />
                <h3 className="text-sm font-semibold">场景卡片</h3>
                {sceneList.map((item, index) => (
                  <div key={`scene-${index}`} className="grid gap-2 rounded-md border border-slate-200 p-2">
                    <Input
                      value={String(item?.name || "")}
                      onChange={(event) =>
                        setSceneList((prev) => prev.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))
                      }
                      placeholder="场景名"
                    />
                    <Textarea
                      value={String(item?.description || "")}
                      onChange={(event) =>
                        setSceneList((prev) => prev.map((row, i) => (i === index ? { ...row, description: event.target.value } : row)))
                      }
                      placeholder="场景描述"
                    />
                    <Textarea
                      value={String(item?.prompt || "")}
                      onChange={(event) =>
                        setSceneList((prev) => prev.map((row, i) => (i === index ? { ...row, prompt: event.target.value } : row)))
                      }
                      placeholder="场景Prompt"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          requestAiSuggestion({
                            kind: "scene_prompt",
                            text: String(item?.prompt || item?.description || item?.name || ""),
                            context: `场景名:${String(item?.name || "")}; 场景描述:${String(item?.description || "")}`,
                            onApply: (suggestion) =>
                              setSceneList((prev) => prev.map((row, i) => (i === index ? { ...row, prompt: suggestion } : row))),
                            successText: "已补全场景Prompt",
                          })
                        }
                        disabled={running}
                      >
                        AI建议
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSceneList((prev) => prev.filter((_, i) => i !== index))}
                    >
                      删除场景
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSceneList((prev) => [...prev, { name: "", description: "", prompt: "" }])}
                >
                  新增场景
                </Button>
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <SectionLead title="分镜文本" description="这一列专注处理镜头 ID、时长、字幕和画面提示，改完就可以直接去第三步生成镜头素材。" />
                <div className="max-h-[38rem] space-y-2 overflow-auto pr-1">
                  {storyboardList.map((item, index) => (
                    <div key={`storyboard-${index}`} className="grid gap-2 rounded-md border border-slate-200 p-2">
                      <div className="grid gap-2 lg:grid-cols-2">
                        <Input
                          value={String(item?.shot_id || "")}
                          onChange={(event) =>
                            setStoryboardList((prev) => prev.map((row, i) => (i === index ? { ...row, shot_id: event.target.value } : row)))
                          }
                          placeholder="镜头ID"
                        />
                        <Input
                          value={String(item?.duration_sec || "")}
                          onChange={(event) =>
                            setStoryboardList((prev) => prev.map((row, i) => (i === index ? { ...row, duration_sec: event.target.value } : row)))
                          }
                          placeholder="时长秒数"
                        />
                      </div>
                      <Input
                        value={String(item?.subtitle || "")}
                        onChange={(event) =>
                          setStoryboardList((prev) => prev.map((row, i) => (i === index ? { ...row, subtitle: event.target.value } : row)))
                        }
                        placeholder="字幕"
                      />
                      <Textarea
                        value={String(item?.visual_hint || "")}
                        onChange={(event) =>
                          setStoryboardList((prev) => prev.map((row, i) => (i === index ? { ...row, visual_hint: event.target.value } : row)))
                        }
                        placeholder="画面提示"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            requestAiSuggestion({
                              kind: "storyboard_hint",
                              text: String(item?.visual_hint || item?.subtitle || item?.shot_id || ""),
                              context: `镜头ID:${String(item?.shot_id || "")}; 字幕:${String(item?.subtitle || "")}; 时长:${String(item?.duration_sec || "")}`,
                              onApply: (suggestion) =>
                                setStoryboardList((prev) => prev.map((row, i) => (i === index ? { ...row, visual_hint: suggestion } : row))),
                              successText: "已补全分镜画面提示",
                            })
                          }
                          disabled={running}
                        >
                          AI建议
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStoryboardList((prev) => prev.filter((_, i) => i !== index))}
                      >
                        删除分镜文本
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStoryboardList((prev) => [...prev, { shot_id: "", duration_sec: 5, subtitle: "", visual_hint: "" }])}
                >
                  新增分镜文本
                </Button>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-700">结构化预览</div>
                  <pre className="max-h-56 overflow-auto rounded-md bg-white p-3 text-xs text-slate-800">
                    {JSON.stringify(buildStage2Plan(), null, 2) || stage2PlanPreview || "(暂无)"}
                  </pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeMenu === "step3" ? (
        <Card className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle>第三步：素材与分镜</CardTitle>
            <CardDescription>这里可管理素材版本、镜头修订、渲染与合成。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-4">
              {step3StatusCards.map((item) => (
                <div key={`step3-status-${item.key}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <SectionLead title="全局素材设置" description="先在这里统一设定尺寸、比例、风格和素材生成模式，再去分别处理角色、场景和镜头。" />
              <Button onClick={refreshStep3} disabled={running}>
                刷新当前素材与分镜
              </Button>
              <div className="grid gap-2 md:grid-cols-3">
                <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={assetImageSize} onChange={(event) => setAssetImageSize(event.target.value)}>
                  {assetSizePresets.map((item) => (
                    <option key={`asset-size-${item.value}`} value={item.value}>
                      素材尺寸：{item.label}
                    </option>
                  ))}
                </select>
                <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={videoSize} onChange={(event) => setVideoSize(event.target.value)}>
                  {videoSizePresets.map((item) => (
                    <option key={`video-size-${item.value}`} value={item.value}>
                      视频尺寸：{item.label}
                    </option>
                  ))}
                </select>
                <Input value={renderRatio} onChange={(event) => setRenderRatio(event.target.value)} placeholder="自定义比例，如 9:16" />
              </div>
              <div className="grid gap-2 md:grid-cols-5">
                {artStylePresets.map((item) => (
                  <Button key={`style-${item.value}`} variant={artStyle === item.value ? "default" : "outline"} size="sm" onClick={() => setArtStyle(item.value)}>
                    {item.label}
                  </Button>
                ))}
              </div>
              <TogglePanelHeader
                title="高级设置"
                description="角色/场景生成模式、锚点、多角度包和重试策略都放这里。"
                open={step3ShowAdvancedControls}
                onToggle={() => setStep3ShowAdvancedControls((prev) => !prev)}
                openLabel="收起高级设置"
                closedLabel="展开高级设置"
              />
              {step3ShowAdvancedControls ? (
                <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={faceMode} onChange={(event) => setFaceMode(event.target.value)}>
                      {faceModePresets.map((item) => (
                        <option key={`face-mode-${item.value}`} value={item.value}>
                          角色生成模式：{item.label}
                        </option>
                      ))}
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={sceneMode} onChange={(event) => setSceneMode(event.target.value)}>
                      {sceneModePresets.map((item) => (
                        <option key={`scene-mode-${item.value}`} value={item.value}>
                          场景生成模式：{item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={faceAnglePackEnabled ? "default" : "outline"} onClick={() => setFaceAnglePackEnabled((prev) => !prev)}>
                      {faceAnglePackEnabled ? "角色多角度包：开启" : "角色多角度包：关闭"}
                    </Button>
                    <span className="text-xs text-slate-500">开启后每次角色生成会自动产出设定板、站姿、侧面与肖像等多角度素材。</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={sceneBindCharacterAnchors ? "default" : "outline"} onClick={() => setSceneBindCharacterAnchors((prev) => !prev)}>
                      {sceneBindCharacterAnchors ? "场景绑定角色锚点：开启" : "场景绑定角色锚点：关闭"}
                    </Button>
                    <span className="text-xs text-slate-500">建议保持开启，场景生成会自动带入已激活角色设定与素材版本。</span>
                  </div>
                  {faceMode === "model_sheet" ? (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={strictSheetLayout ? "default" : "outline"} onClick={() => setStrictSheetLayout((prev) => !prev)}>
                        {strictSheetLayout ? "固定机位构图：开启" : "固定机位构图：关闭"}
                      </Button>
                      <span className="text-xs text-slate-500">开启后会强制正面/左侧/右侧等比例版式，更像标准设定页。</span>
                    </div>
                  ) : null}
                  {renderRetryControls({ showConcurrency: false, disablePreset: running })}
                </div>
              ) : null}
              <div className="text-xs text-slate-500">
                当前生效比例：{effectiveRenderRatio} ｜ 当前美术风格：{artStyle} ｜ 角色模式：{faceModePresets.find((x) => x.value === faceMode)?.label || faceMode} ｜ 场景模式：
                {sceneModePresets.find((x) => x.value === sceneMode)?.label || sceneMode}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <h4 className="text-sm font-medium">人物素材</h4>
                <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-700">
                  Tips：人物参考图建议使用单人正脸、清晰、无遮挡、自然光照片；导入前请确认已获得当事人授权。
                </div>
                {characterList.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <div>暂无角色，请先回第二步提取角色。</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setActiveMenu("step2")}>
                      前往第二步
                    </Button>
                  </div>
                ) : (
                  characterList.map((item, index) => {
                    const name = String(item?.name || "").trim() || `角色${index + 1}`;
                    const version = activeFaceVersionMap.get(name);
                    const activeItem = activeFaceItemMap.get(name);
                    const previewSrc = resolveAssetPreviewSrc(activeItem);
                    const versions = getAssetVersions("face", name);
                    const referenceCoverage = summarizeReferenceCoverage(versions);
                    const referenceCoverageReady = referenceCoverage.front && referenceCoverage.side && referenceCoverage.threeQuarter;
                    return (
                      <div key={`face-plan-${name}-${index}`} className="rounded-md border border-slate-200 p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{name}</div>
                            <div className="mt-1 text-slate-500">当前版本：{version ? `v${version}` : "未生成"}</div>
                            <div className="text-slate-500">最近生成：{formatAssetTime(activeItem?.created_at)}</div>
                          </div>
                          <div className={`rounded-full px-2 py-0.5 text-[11px] ${version ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {version ? `v${version}` : "未生成"}
                          </div>
                        </div>
                        {previewSrc ? (
                          <button className="mt-2 block" onClick={() => setAssetPreview({ src: previewSrc, title: `${name} 预览` })}>
                            <img src={previewSrc} alt={`${name}-preview`} className="h-20 w-20 rounded border border-slate-200 object-cover" />
                          </button>
                        ) : null}
                        {isSeedanceModel ? (
                          <div className={`mt-2 rounded border p-2 ${referenceCoverageReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={referenceCoverage.front ? "default" : "outline"}>正面</Badge>
                              <Badge variant={referenceCoverage.side ? "default" : "outline"}>侧面</Badge>
                              <Badge variant={referenceCoverage.threeQuarter ? "default" : "outline"}>3/4 侧</Badge>
                            </div>
                            <div className={`mt-2 text-[11px] ${referenceCoverageReady ? "text-emerald-700" : "text-amber-700"}`}>
                              {referenceCoverageReady
                                ? "Seedance 参考角度已较完整，可更稳地做角色一致性。"
                                : referenceCoverage.taggedCount > 0
                                  ? "建议补齐正面、侧面、3/4 侧三类参考图；导入文件名可带 front / side / three-quarter 或 正面 / 侧面 / 三分之三侧。"
                                  : "暂未识别参考角度命名；若要做 Seedance 角色一致性，建议导入三张单独裁剪参考图，并在文件名里标注 front / side / three-quarter。"}
                            </div>
                          </div>
                        ) : null}
                        {versions.length > 0 ? (
                          <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
                            <div className="mb-1 text-[11px] text-slate-600">历史版本（{versions.length}）</div>
                            <div className="flex flex-wrap gap-2">
                              {versions.map((versionItem, versionIndex) => {
                                const itemVersion = String(versionItem?.version || "").trim();
                                const itemSrc = resolveAssetPreviewSrc(versionItem);
                                const isActive = itemVersion && String(version || "") === itemVersion;
                                return (
                                  <button
                                    key={`${name}-face-v-${itemVersion || "x"}-${String(versionItem?.tag || versionItem?.created_at || versionIndex)}`}
                                    type="button"
                                    className={`rounded border p-1 text-[11px] ${isActive ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}
                                    onClick={async () => {
                                      if (itemVersion) {
                                        await executeCli("切换人物素材版本", "asset-activate", withStateFile(["--kind", "face", "--name", name, "--version", itemVersion]));
                                      }
                                      if (itemSrc) {
                                        setAssetPreview({ src: itemSrc, title: `${name} v${itemVersion || "?"}` });
                                      }
                                    }}
                                    disabled={running}
                                  >
                                    {itemSrc ? <img src={itemSrc} alt={`${name}-v${itemVersion}`} className="mb-1 h-12 w-12 rounded object-cover" /> : null}
                                    <div>{`v${itemVersion || "?"}`}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => generateSingleAsset("face", name)}
                            disabled={assetJobKeys.includes(`face:${name}`)}
                          >
                            {version ? "重新生成" : "生成素材"}
                          </Button>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => importReferenceImage("face", name)}
                              disabled={running}
                            >
                              导入参考图
                            </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => executeCli("切换人物素材最新版", "asset-activate", withStateFile(["--kind", "face", "--name", name, "--version", "latest"]))}
                            disabled={running || !version}
                          >
                            启用最新版
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssetCompare(activeItem, name)}
                            disabled={running || !activeItem?.previous_version}
                          >
                            对比上一版
                          </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <h4 className="text-sm font-medium">场景素材</h4>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-700">
                  Tips：场景参考图建议使用目标机位相近、光线稳定、元素干净的图；尽量避免复杂水印和强透视畸变。
                </div>
                {sceneList.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <div>暂无场景，请先回第二步提取场景。</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setActiveMenu("step2")}>
                      前往第二步
                    </Button>
                  </div>
                ) : (
                  sceneList.map((item, index) => {
                    const name = String(item?.name || "").trim() || `场景${index + 1}`;
                    const version = activeSceneVersionMap.get(name);
                    const activeItem = activeSceneItemMap.get(name);
                    const previewSrc = resolveAssetPreviewSrc(activeItem);
                    const versions = getAssetVersions("scene", name);
                    return (
                      <div key={`scene-plan-${name}-${index}`} className="rounded-md border border-slate-200 p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{name}</div>
                            <div className="mt-1 text-slate-500">当前版本：{version ? `v${version}` : "未生成"}</div>
                            <div className="text-slate-500">最近生成：{formatAssetTime(activeItem?.created_at)}</div>
                          </div>
                          <div className={`rounded-full px-2 py-0.5 text-[11px] ${version ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {version ? `v${version}` : "未生成"}
                          </div>
                        </div>
                        {previewSrc ? (
                          <button className="mt-2 block" onClick={() => setAssetPreview({ src: previewSrc, title: `${name} 预览` })}>
                            <img src={previewSrc} alt={`${name}-preview`} className="h-20 w-20 rounded border border-slate-200 object-cover" />
                          </button>
                        ) : null}
                        {versions.length > 0 ? (
                          <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
                            <div className="mb-1 text-[11px] text-slate-600">历史版本（{versions.length}）</div>
                            <div className="flex flex-wrap gap-2">
                              {versions.map((versionItem, versionIndex) => {
                                const itemVersion = String(versionItem?.version || "").trim();
                                const itemSrc = resolveAssetPreviewSrc(versionItem);
                                const isActive = itemVersion && String(version || "") === itemVersion;
                                return (
                                  <button
                                    key={`${name}-scene-v-${itemVersion || "x"}-${String(versionItem?.tag || versionItem?.created_at || versionIndex)}`}
                                    type="button"
                                    className={`rounded border p-1 text-[11px] ${isActive ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"}`}
                                    onClick={async () => {
                                      if (itemVersion) {
                                        await executeCli("切换场景素材版本", "asset-activate", withStateFile(["--kind", "scene", "--name", name, "--version", itemVersion]));
                                      }
                                      if (itemSrc) {
                                        setAssetPreview({ src: itemSrc, title: `${name} v${itemVersion || "?"}` });
                                      }
                                    }}
                                    disabled={running}
                                  >
                                    {itemSrc ? <img src={itemSrc} alt={`${name}-v${itemVersion}`} className="mb-1 h-12 w-12 rounded object-cover" /> : null}
                                    <div>{`v${itemVersion || "?"}`}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => generateSingleAsset("scene", name)}
                            disabled={assetJobKeys.includes(`scene:${name}`)}
                          >
                            {version ? "重新生成" : "生成素材"}
                          </Button>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => importReferenceImage("scene", name)}
                              disabled={running}
                            >
                              导入参考图
                            </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => executeCli("切换场景素材最新版", "asset-activate", withStateFile(["--kind", "scene", "--name", name, "--version", "latest"]))}
                            disabled={running || !version}
                          >
                            启用最新版
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssetCompare(activeItem, name)}
                            disabled={running || !activeItem?.previous_version}
                          >
                            对比上一版
                          </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold">分镜管理与渲染</h3>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                分镜文本来源：第二步（当前 {storyboardList.length} 条）。镜头数量上限：{Math.max(0, Number(shotTargetCount) || 0) || "不限"}。先点“根据分镜文本生成镜头”，再点“批量开始渲染”。
              </div>
              <Textarea value={shotInstruction} onChange={(event) => setShotInstruction(event.target.value)} placeholder="镜头修订意见" />
              <p className="text-xs text-slate-500">当前提示词约束（{activeVideoProvider === "fal" ? "FAL 模式" : "火山模式"}）：{providerPromptConstraint}</p>
              {isSeedanceModel ? (
                <p className="text-xs text-amber-600">当前模型为 Seedance：文生视频建议 120-280 词；有参考图时建议 50-80 词；渲染时会自动限制单镜头最长 15 秒。</p>
              ) : null}
              {isSeedanceModel ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-amber-800">Seedance 校验概览：通过 {seedancePromptOkCount} 条，待修正 {seedancePromptWarnCount} 条。</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={applySeedancePromptTemplateToAll} disabled={running || !shotsList.length}>
                        批量标准化五模块
                      </Button>
                      <Button size="sm" variant="secondary" onClick={autoFixSeedancePromptToAll} disabled={running || !shotsList.length}>
                        批量一键修复
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-amber-700">
                    规则：五模块完整、词数命中建议区间、Action 尽量只有一个主动作、Style 带稳定锚点、Quality 包含 4K / Ultra HD / Sharp clarity。
                  </div>
                </div>
              ) : null}
              {shotsList.length > 1 ? (
                <div className={`rounded-md border p-3 text-xs ${shotContinuityChecks.length ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className={shotContinuityChecks.length ? "text-sky-800" : "text-emerald-800"}>
                      镜头连续性检查：{shotContinuityChecks.length ? `发现 ${shotContinuityChecks.length} 处需要复核的人物/服装/机位/方向跳变。` : "未发现明显的人物、服装、机位和动作方向跳变。"}
                    </div>
                  </div>
                  {shotContinuityChecks.length ? (
                    <div className="mt-2 space-y-1 text-[11px] text-sky-700">
                      {shotContinuityChecks.map((item) => (
                        <div key={`${item.fromShotId}-${item.toShotId}`}>
                          {item.fromShotId} → {item.toShotId}：{item.warnings.join(" / ")}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    requestAiSuggestion({
                      kind: "shot_instruction",
                      text: effectiveShotInstruction,
                      context: `目标比例:${effectiveRenderRatio}; 风格:${artStyle}; 视频提供商:${activeVideoProvider}; 约束:${providerPromptConstraint}`,
                      onApply: setShotInstruction,
                      successText: "已补全镜头修订意见",
                    })
                  }
                  disabled={running}
                >
                  AI建议
                </Button>
              </div>
              <Input value={shotDurationSec} onChange={(event) => setShotDurationSec(event.target.value)} placeholder="默认镜头时长（秒，例如 5）" />
              <Input value={downloadDir} onChange={(event) => setDownloadDir(event.target.value)} placeholder="下载目录，如 videos" />
              <Input value={mergeOutput} onChange={(event) => setMergeOutput(event.target.value)} placeholder="合并文件名，如 approved_merged.mp4" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={generateShotsFromStoryboard} disabled={shotsGenerating}>
                  根据分镜文本生成镜头（导入分镜）
                </Button>
                <Button variant="outline" onClick={() => saveShotsDraft()} disabled={running || !shotsList.length || !shotsDirty}>
                  保存镜头修改
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const ready = await ensureShotsSaved();
                    if (!ready) {
                      return;
                    }
                    await executeCli(
                      "批量渲染分镜",
                      "render-shots",
                      withStateFile(["--ratio", effectiveRenderRatio, "--poll", "--interval", "8", "--timeout", "3600", ...buildRetryArgs()]),
                    );
                  }}
                  disabled={running}
                >
                  批量开始渲染
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    executeCli("合并已批准镜头", "merge-approved", withStateFile(["--download-dir", downloadDir.trim() || "videos", "--output", mergeOutput.trim() || "approved_merged.mp4"]))
                  }
                  disabled={running}
                >
                  合并已通过镜头
                </Button>
              </div>
              <div className="max-h-[28rem] overflow-auto space-y-2">
                {shotsList.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <div>暂未生成镜头，请先点击“根据分镜文本生成镜头（导入分镜）”。</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={generateShotsFromStoryboard} disabled={shotsGenerating}>
                        立即生成镜头
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setActiveMenu("step2")}>
                        回第二步检查分镜
                      </Button>
                    </div>
                  </div>
                ) : (
                  shotsList.map((shot, index) => {
                    const shotId = String(shot?.shot_id || `S${String(index + 1).padStart(2, "0")}`);
                    const seedanceParts = parseSeedancePromptParts(String(shot?.visual_prompt || ""));
                    const seedanceExpanded = seedanceEditorShotId === shotId;
                    const seedanceCheck = isSeedanceModel ? seedancePromptChecks[index] : null;
                    return (
                      <div key={shotId} className="rounded-md border border-slate-200 p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{shotId}</div>
                            <div className="mt-1 text-slate-500">时长：{String(shot?.duration_sec ?? "")}s</div>
                            <div className="text-slate-500">字幕：{String(shot?.subtitle || "")}</div>
                          </div>
                          <div className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                            镜头
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <Input value={String(shot?.shot_id || "")} onChange={(event) => updateShotField(index, "shot_id", event.target.value)} placeholder="镜头ID" />
                          <Input value={String(shot?.duration_sec ?? "")} onChange={(event) => updateShotField(index, "duration_sec", event.target.value)} placeholder="时长秒数" />
                        </div>
                        <Input className="mt-2" value={String(shot?.subtitle || "")} onChange={(event) => updateShotField(index, "subtitle", event.target.value)} placeholder="字幕 / 主动作描述" />
                        <Textarea
                          className="mt-2 min-h-24"
                          value={String(shot?.visual_prompt || "")}
                          onChange={(event) => updateShotField(index, "visual_prompt", event.target.value)}
                          placeholder="画面提示词"
                        />
                        {isSeedanceModel && seedanceCheck ? (
                          <div className={`mt-2 rounded-md border p-2 ${seedanceCheck.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={seedanceCheck.ok ? "default" : "outline"}>{seedanceCheck.ok ? "通过" : "待修正"}</Badge>
                              <Badge variant="outline">词数 {seedanceCheck.wordCount}</Badge>
                              <Badge variant="outline">建议 {seedanceCheck.minWords}-{seedanceCheck.maxWords}</Badge>
                            </div>
                            {seedanceCheck.warnings.length ? (
                              <div className="mt-2 text-[11px] text-amber-700">
                                {seedanceCheck.warnings.join(" / ")}
                              </div>
                            ) : (
                              <div className="mt-2 text-[11px] text-emerald-700">当前镜头已满足 Seedance 基础提示词约束。</div>
                            )}
                          </div>
                        ) : null}
                        {isSeedanceModel ? (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[11px] text-amber-700">Seedance 五模块编辑器：可直接拆开维护 Subject / Action / Camera / Style / Quality。</div>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => applySeedancePromptTemplate(index)} disabled={running}>
                                  套用五模块模板
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => autoFixSeedancePrompt(index)} disabled={running}>
                                  一键修复当前
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSeedanceEditorShotId((prev) => (prev === shotId ? "" : shotId))}
                                >
                                  {seedanceExpanded ? "收起五模块" : "展开五模块"}
                                </Button>
                              </div>
                            </div>
                            {seedanceExpanded ? (
                              <div className="mt-3 grid gap-2">
                                <Textarea value={seedanceParts.subject} onChange={(event) => updateSeedanceShotPart(index, "subject", event.target.value)} placeholder="Subject" />
                                <Textarea value={seedanceParts.action} onChange={(event) => updateSeedanceShotPart(index, "action", event.target.value)} placeholder="Action（只保留一个主动作）" />
                                <Textarea value={seedanceParts.camera} onChange={(event) => updateSeedanceShotPart(index, "camera", event.target.value)} placeholder="Camera" />
                                <Textarea value={seedanceParts.style} onChange={(event) => updateSeedanceShotPart(index, "style", event.target.value)} placeholder="Style（建议带 Kodak Vision3 500T）" />
                                <Input value={seedanceParts.quality} onChange={(event) => updateSeedanceShotPart(index, "quality", event.target.value)} placeholder="Quality" />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2">
                          <Button
                            size="sm"
                            onClick={async () => {
                              const ready = await ensureShotsSaved();
                              if (!ready) {
                                return;
                              }
                              await executeCli(
                                "渲染并批准镜头",
                                "render-shot",
                                withStateFile([
                                  "--shot-id",
                                  String(shotsList[index]?.shot_id || shotId),
                                  "--ratio",
                                  effectiveRenderRatio,
                                  "--poll",
                                  "--approve",
                                  ...buildRetryArgs(),
                                  "--download-dir",
                                  downloadDir.trim() || "videos",
                                ]),
                              );
                            }}
                            disabled={running}
                          >
                            渲染并批准
                          </Button>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const ready = await ensureShotsSaved();
                                if (!ready) {
                                  return;
                                }
                                await executeCli(
                                  "修订镜头",
                                  "shot-revise",
                                  withStateFile(["--shot-id", String(shotsList[index]?.shot_id || shotId), "--instruction", effectiveShotInstruction]),
                                );
                              }}
                              disabled={running}
                            >
                              修订镜头
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <h4 className="text-sm font-medium">渲染任务</h4>
              <pre className="max-h-40 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800">
                {renderTaskRows.length ? JSON.stringify(renderTaskRows, null, 2) : "(暂无任务)"}
              </pre>
              <Button size="sm" variant="secondary" onClick={() => setActiveMenu("step4")} disabled={running}>
                前往第四步：渲染与合成
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeMenu === "step4" ? (
        <Card className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle>第四步：渲染与合成</CardTitle>
            <CardDescription>查看渲染进度、处理失败任务，并输出最终视频。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-4">
              {step4StatusCards.map((item) => (
                <div key={`step4-status-${item.key}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">渲染控制</div>
                  <div className="mt-1 text-xs text-slate-500">先看整体进度，再决定同步云端、重新批量渲染还是处理失败任务。</div>
                </div>
                <Button onClick={refreshStep4} disabled={running}>
                  刷新进度（本地）
                </Button>
                <div className="text-sm">已渲染：{renderedCount} ({progressRendered}%)</div>
                <div className="h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-blue-500" style={{ width: `${progressRendered}%` }} />
                </div>
                <div className="text-sm">已批准：{approvedCount} ({progressApproved}%)</div>
                <div className="h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-emerald-500" style={{ width: `${progressApproved}%` }} />
                </div>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div>待完成任务：{pendingTasks.length}</div>
                  <div>失败任务：{failedTasks.length}</div>
                  <div>已完成任务：{completedTasks.length}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={autoRefreshStep4 ? "default" : "outline"}
                    onClick={() => setAutoRefreshStep4((value) => !value)}
                    disabled={running}
                  >
                    自动刷新：{autoRefreshStep4 ? "开启" : "关闭"}
                  </Button>
                  <Input
                    value={autoRefreshSeconds}
                    onChange={(event) => setAutoRefreshSeconds(event.target.value)}
                    placeholder="刷新间隔（秒）"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={syncStep4FromCloud}
                    disabled={running}
                  >
                    一次性云端同步并下载（可能计费）
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      executeCli(
                        "重新批量渲染",
                        "render-shots",
                        withStateFile(["--ratio", renderRatio.trim() || "9:16", "--poll", "--interval", "8", "--timeout", "3600", ...buildRetryArgs()]),
                      )
                    }
                    disabled={running}
                  >
                    重新批量渲染
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">失败任务处理</div>
                  <div className="mt-1 text-xs text-slate-500">这里集中处理失败镜头，避免在任务列表里来回找。</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={retryAllFailedTasks}
                    disabled={running || retryBatchRunning || failedTasks.length === 0}
                  >
                    重试全部失败任务
                  </Button>
                  {renderRetryControls({ showConcurrency: true, disablePreset: running || retryBatchRunning })}
                  <Button size="sm" variant="outline" onClick={pauseRetryBatch} disabled={!retryBatchRunning || retryBatchPaused || retryCancelRequested}>
                    暂停重试
                  </Button>
                  <Button size="sm" variant="outline" onClick={resumeRetryBatch} disabled={!retryBatchRunning || !retryBatchPaused || retryCancelRequested}>
                    恢复重试
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelRetryBatch} disabled={!retryBatchRunning || retryCancelRequested}>
                    {retryCancelRequested ? "停止中..." : "取消重试"}
                  </Button>
                </div>
                {retryBatchProgress.total > 0 ? (
                  <div className="rounded-md border border-slate-200 p-2 text-xs text-slate-600">
                    <div>批量重试进度：{retryBatchProgress.done}/{retryBatchProgress.total}</div>
                    <div>成功：{retryBatchProgress.success} ｜ 失败：{retryBatchProgress.failed}</div>
                    <div>当前：{retryBatchProgress.current || "-"}</div>
                  </div>
                ) : null}
                {failedTasks.length === 0 ? (
                  <p className="text-xs text-slate-500">当前没有失败任务</p>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-auto">
                    {failedTasks.map((task, index) => {
                      const shotId = String(task?.shot_id || "");
                      return (
                        <div key={`failed-${shotId}-${index}`} className="rounded-md border border-slate-200 p-3 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-slate-900">镜头：{shotId}</div>
                              <div className="mt-1 text-slate-500">状态：{String(task?.status || "")}</div>
                            </div>
                            <div className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">失败</div>
                          </div>
                          <Button
                            size="sm"
                            className="mt-3"
                            onClick={() => retryRenderTask(task)}
                            disabled={running || !shotId}
                          >
                            重试并通过
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <SectionLead title="任务列表" description="筛选、批量选择和定位镜头都集中在这里，日常只需要操作这一块。" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={taskFilter === "all" ? "default" : "outline"} onClick={() => setTaskFilter("all")}>
                  全部({renderTaskRows.length})
                </Button>
                <Button size="sm" variant={taskFilter === "failed" ? "default" : "outline"} onClick={() => setTaskFilter("failed")}>
                  失败({failedTasks.length})
                </Button>
                <Button size="sm" variant={taskFilter === "pending" ? "default" : "outline"} onClick={() => setTaskFilter("pending")}>
                  处理中({pendingTasks.length})
                </Button>
                <Button size="sm" variant={taskFilter === "completed" ? "default" : "outline"} onClick={() => setTaskFilter("completed")}>
                  完成({completedTasks.length})
                </Button>
                <Input
                  value={taskSearchKeyword}
                  onChange={(event) => setTaskSearchKeyword(event.target.value)}
                  placeholder="搜索镜头ID或任务ID"
                />
              </div>
              <TogglePanelHeader
                title="批量与排序工具"
                description="排序、分页、导出和批量选择都收纳在这里，默认不打扰主操作。"
                open={step4ShowAdvancedTools}
                onToggle={() => setStep4ShowAdvancedTools((prev) => !prev)}
                openLabel="收起批量工具"
                closedLabel="展开批量工具"
              />
              {step4ShowAdvancedTools ? (
                <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <Button size="sm" variant={taskSortMode === "status" ? "default" : "outline"} onClick={() => setTaskSortMode("status")}>
                    状态优先
                  </Button>
                  <Button size="sm" variant={taskSortMode === "updated" ? "default" : "outline"} onClick={() => setTaskSortMode("updated")}>
                    最近更新
                  </Button>
                  <Button size="sm" variant={taskSortMode === "shot_asc" ? "default" : "outline"} onClick={() => setTaskSortMode("shot_asc")}>
                    镜头升序
                  </Button>
                  <Button size="sm" variant={taskSortMode === "shot_desc" ? "default" : "outline"} onClick={() => setTaskSortMode("shot_desc")}>
                    镜头降序
                  </Button>
                  <Input
                    value={taskPageSize}
                    onChange={(event) => setTaskPageSize(event.target.value)}
                    placeholder="每页数量"
                  />
                  <Button size="sm" variant="outline" onClick={exportFilteredTasksJson}>
                    导出当前列表JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelectedTaskKeys((prev) => Array.from(new Set([...prev, ...pagedTaskKeys])))
                    }
                    disabled={pagedTaskRows.length === 0}
                  >
                    选中本页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelectedTaskKeys((prev) => prev.filter((key) => !pagedTaskKeys.includes(key)))
                    }
                    disabled={pagedTaskRows.length === 0}
                  >
                    取消本页选择
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedTaskKeys(Array.from(new Set(filteredTaskKeys)))}
                    disabled={filteredTaskRows.length === 0}
                  >
                    选中筛选结果
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelectedTaskKeys([])} disabled={selectedTaskKeys.length === 0}>
                    清空已选
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={retrySelectedTasks}
                    disabled={running || retryBatchRunning || selectedTaskKeys.length === 0}
                  >
                    重试已选（{selectedTaskKeys.length}）
                  </Button>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>共 {filteredTaskRows.length} 条，当前第 {safeTaskPage} / {taskTotalPages} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTaskPage((value) => Math.max(1, value - 1))} disabled={safeTaskPage <= 1}>
                    上一页
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTaskPage((value) => Math.min(taskTotalPages, value + 1))} disabled={safeTaskPage >= taskTotalPages}>
                    下一页
                  </Button>
                </div>
              </div>
              <div className="max-h-80 space-y-2 overflow-auto">
                {pagedTaskRows.length === 0 ? (
                  <p className="text-xs text-slate-500">当前没有匹配的任务</p>
                ) : (
                  pagedTaskRows.map((task, index) => {
                    const shotId = String(task?.shot_id || "");
                    const taskId = String(task?.task_id || "");
                    const status = String(task?.status || "");
                    const key = `${shotId}-${taskId}-${index}`;
                    const taskKey = getTaskKey(task);
                    const isExpanded = expandedTaskKey === taskKey;
                    const isSelected = selectedTaskKeys.includes(taskKey);
                    const isLocated = locatedTaskKey === taskKey;
                    return (
                      <div
                        id={`task-row-${encodeURIComponent(taskKey)}`}
                        key={key}
                        className={`rounded-md border p-2 text-xs ${isSelected ? "border-blue-400 bg-blue-50/40" : "border-slate-200"} ${isLocated ? "ring-2 ring-amber-400/70" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                setSelectedTaskKeys((prev) =>
                                  event.target.checked ? Array.from(new Set([...prev, taskKey])) : prev.filter((item) => item !== taskKey),
                                )
                              }
                            />
                            <span>{shotId || "未命名镜头"}</span>
                          </div>
                          <span className={`rounded px-2 py-0.5 text-[11px] ${getTaskStatusStyle(task)}`}>{status || "处理中"}</span>
                        </div>
                        <div className="mt-1 text-slate-500">{taskId || "未返回任务ID"}</div>
                        <div className="mt-1 text-slate-500">更新时间：{getTaskUpdatedAtText(task)}（{getTaskRelativeTimeText(task)}）</div>
                        <div className="mt-1 text-slate-500">
                          素材提交：人物{task?.has_face_ref ? "✓" : "×"} ｜ 场景{task?.has_scene_ref ? "✓" : "×"} ｜ 模式：
                          {String(task?.request_mode || "unknown")} ｜ 约束：{task?.constraints_applied ? "已启用" : "未启用"}
                        </div>
                        <div className="mt-1 text-slate-500">{String(task?.local_file || "").trim() || "尚未下载本地文件"}</div>
                        {String(task?.download_error || "").trim() ? <div className="mt-1 text-rose-600">{String(task?.download_error || "")}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedTaskKey((prev) => (prev === taskKey ? "" : taskKey))}
                          >
                            {isExpanded ? "收起详情" : "展开详情"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => retryRenderTask(task)}
                            disabled={running || !shotId}
                          >
                            重试该镜头
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => playRenderTask(task)}
                            disabled={!shotId}
                          >
                            播放
                          </Button>
                        </div>
                        {isExpanded ? (
                          <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-[11px] text-slate-800">
                            {JSON.stringify(task, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">最终视频</div>
                <div className="mt-1 text-xs text-slate-500">确认任务通过后，在这里进行最终合成与播放。</div>
              </div>
              <div className="text-xs text-slate-500">{finalVideo || "尚未生成最终视频"}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={playFinalVideo}
                  disabled={!String(finalVideo || "").trim()}
                >
                  播放最终视频
                </Button>
                <Button
                  onClick={mergeWithSelectedShots}
                  disabled={running}
                >
                  开始最终合成
                </Button>
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">火山配音</div>
                <div className="mt-1 text-xs text-slate-500">先生成旁白音频，再给最终视频挂上配音轨。</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">TTS App ID</label>
                  <Input value={ttsAppId} onChange={(event) => setTtsAppId(event.target.value)} placeholder="VOLC_TTS_APP_ID" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">TTS Access Token</label>
                  <Input type="password" value={ttsAccessToken} onChange={(event) => setTtsAccessToken(event.target.value)} placeholder="VOLC_TTS_ACCESS_TOKEN（已保存可留空）" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">TTS 音色</label>
                  <Input value={ttsVoiceType} onChange={(event) => setTtsVoiceType(event.target.value)} placeholder="例如 zh_female_vv_uranus_bigtts" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">音频模型 / Resource ID</label>
                  <Input value={selectedModels.audio} onChange={(event) => setSelectedModels((prev) => ({ ...prev, audio: event.target.value }))} placeholder="例如 seed-tts-2.0" />
                </div>
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-slate-700">旁白文本</label>
                <textarea
                  className="min-h-[120px] rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={ttsScript}
                  onChange={(event) => setTtsScript(event.target.value)}
                  placeholder="留空则自动使用已批准镜头字幕拼接旁白"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">旁白输出文件名</label>
                  <Input value={ttsOutputFileName} onChange={(event) => setTtsOutputFileName(event.target.value)} placeholder="voiceover_narration.mp3" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-slate-700">配音成片文件名</label>
                  <Input value={dubbedOutputFileName} onChange={(event) => setDubbedOutputFileName(event.target.value)} placeholder="approved_merged_dubbed.mp4" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={ttsApprovedOnly} onChange={(event) => setTtsApprovedOnly(event.target.checked)} />
                只使用已批准镜头的字幕自动生成旁白
              </label>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div>旁白音频：{voiceoverInfo.audio_file || "尚未生成"}</div>
                <div>配音成片：{voiceoverInfo.dubbed_video || "尚未生成"}</div>
                <div>当前音色：{voiceoverInfo.voice_type || ttsVoiceType || "未设置"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={generateVoiceover} disabled={running || !selectedModels.audio.trim() || !ttsVoiceType.trim() || !ttsAppId.trim()}>
                  生成旁白音频
                </Button>
                <Button variant="secondary" onClick={dubFinalVideoWithVoiceover} disabled={running || !String(finalVideo || "").trim() || !String(voiceoverInfo.audio_file || "").trim()}>
                  给最终视频配音
                </Button>
                <Button variant="outline" onClick={playDubbedVideo} disabled={!String(voiceoverInfo.dubbed_video || "").trim()}>
                  播放配音成片
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeMenu === "logs" ? (
        <Card className="flex-1">
        <CardHeader>
          <CardTitle>运行日志</CardTitle>
          <CardDescription>这里展示完整输出信息，便于定位问题与回放过程。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-xs text-slate-500">当前操作：{running ? currentAction || "执行中" : "空闲"}</p>
          <p className="text-xs text-slate-500">
            最近一次费用估算：{lastUsageEstimate.currency} {Number(lastUsageEstimate.estimated_cost || 0).toFixed(6)}（调用 {lastUsageEstimate.calls || 0} 次，Token {lastUsageEstimate.total_tokens || 0}）
          </p>
          {renderJournalReportPanel()}
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">STDOUT</h3>
            <pre className="max-h-72 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800">{result.stdout || "(empty)"}</pre>
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">STDERR</h3>
            <pre className="max-h-72 overflow-auto rounded-md bg-rose-50 p-3 text-xs text-rose-700">{result.stderr || "(empty)"}</pre>
          </div>
          <p className="text-xs text-slate-500">Exit Code: {result.code}</p>
        </CardContent>
      </Card>
      ) : null}

      {activeMenu === "debug" ? (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>调试信息</CardTitle>
            <CardDescription>记录每次按钮操作的命令、参数、耗时与错误，便于定位问题。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDebugEntries([])} disabled={running || debugEntries.length === 0}>
                清空调试记录
              </Button>
              <Button variant="secondary" onClick={() => setActiveMenu("logs")}>
                查看执行日志
              </Button>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-200 p-2 text-xs">
              {debugEntries.length === 0
                ? "暂无调试记录，先执行一次操作。"
                : debugEntries
                    .slice()
                    .reverse()
                    .map((item) => (
                      <div key={item.id} className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
                        <div className="font-medium">
                          [{item.time}] {item.level || "info"} ｜ {item.action || "-"} ｜ {item.command || "-"}
                        </div>
                        <div className="mt-1 text-slate-600">{item.message || "-"}</div>
                        <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] text-slate-700">
                          {JSON.stringify(
                            {
                              args: item.args || [],
                              elapsedMs: item.elapsedMs,
                              code: item.code,
                              stderr: item.stderr,
                              stdout: item.stdout,
                              payload: item.payload,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {activeMenu === "step1" ? (
        <Card>
          <CardHeader>
            <CardTitle>故事梗概</CardTitle>
            <CardDescription>确认最终剧本后会显示在这里。</CardDescription>
          </CardHeader>
          <CardContent>
            {scriptKind === "series" && episodeSummaryCards.length > 0 ? (
              <div className="max-h-64 space-y-2 overflow-auto">
                {episodeSummaryCards.map((row, index) => (
                  <div key={`episode-summary-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">第 {row.episode} 集</div>
                      <Button size="sm" variant="outline" onClick={() => regenerateEpisodeFromCard(row)} disabled={running || step1Streaming}>
                        设为当前集并重生
                      </Button>
                    </div>
                    <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{row.summary}</div>
                  </div>
                ))}
              </div>
            ) : Array.isArray(parsedSummary) ? (
              <div className="max-h-56 space-y-2 overflow-auto">
                {parsedSummary.map((item, index) => (
                  <div key={`summary-row-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-1 text-sm font-semibold">{String(item?.shot_id || `片段 ${index + 1}`)}</div>
                    <div className="grid gap-1 text-xs text-slate-700">
                      {Object.entries(item || {}).map(([key, value]) => (
                        <div key={`${index}-${key}`}>
                          <span className="font-medium">{formatSummaryLabel(key)}：</span>
                          <span>{String(value ?? "") || "（空）"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : parsedSummary && typeof parsedSummary === "object" ? (
              <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                {Object.entries(parsedSummary).map(([key, value]) => (
                  <div key={`summary-obj-${key}`}>
                    <span className="font-medium">{formatSummaryLabel(key)}：</span>
                    <span>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="max-h-44 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800 whitespace-pre-wrap">{scriptResultPreview || "确认最终剧本后显示梗概。"}</pre>
            )}
          </CardContent>
        </Card>
      ) : null}
      </section>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>底部调试区</CardTitle>
          <CardDescription>这里常驻显示最近调试记录，提交失败时可直接查看。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDebugEntries([])} disabled={debugEntries.length === 0}>
              清空调试记录
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setActiveMenu("debug")}>
              打开完整调试面板
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setActiveMenu("logs")}>
              打开执行日志
            </Button>
            <Button size="sm" variant="secondary" onClick={openDevtools}>
              打开开发者工具
            </Button>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-slate-200 p-2 text-xs">
            {debugEntries.length === 0
              ? "暂无调试记录。"
              : debugEntries
                  .slice(-8)
                  .reverse()
                  .map((item) => (
                    <div key={`dock-${item.id}`} className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="font-medium">
                        [{item.time}] {item.level || "info"} ｜ {item.action || "-"} ｜ {item.command || "-"}
                      </div>
                      <div className="mt-1 text-slate-600">{item.message || "-"}</div>
                    </div>
                  ))}
          </div>
        </CardContent>
      </Card>

      {assetPreview.src ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" onClick={() => setAssetPreview({ src: "", title: "" })}>
          <div className="max-h-[90vh] max-w-[90vw] rounded-2xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{assetPreview.title || "素材预览"}</div>
              <Button size="sm" variant="outline" onClick={() => setAssetPreview({ src: "", title: "" })}>
                关闭
              </Button>
            </div>
            <img src={assetPreview.src} alt="asset-preview" className="max-h-[78vh] max-w-[84vw] rounded border border-slate-200 object-contain" />
          </div>
        </div>
      ) : null}

      {assetCompare.leftSrc && assetCompare.rightSrc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" onClick={() => setAssetCompare({ leftSrc: "", rightSrc: "", title: "" })}>
          <div className="max-h-[90vh] max-w-[95vw] rounded-2xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{assetCompare.title || "版本对比"}</div>
              <Button size="sm" variant="outline" onClick={() => setAssetCompare({ leftSrc: "", rightSrc: "", title: "" })}>
                关闭
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <div className="text-xs text-slate-500">当前版本</div>
                <img src={assetCompare.leftSrc} alt="asset-current" className="max-h-[76vh] w-full rounded border border-slate-200 object-contain" />
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-slate-500">上一版本</div>
                <img src={assetCompare.rightSrc} alt="asset-previous" className="max-h-[76vh] w-full rounded border border-slate-200 object-contain" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {videoPreview.src ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" onClick={() => setVideoPreview({ src: "", title: "" })}>
          <div className="max-h-[90vh] w-full max-w-4xl rounded-2xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{videoPreview.title || "视频预览"}</div>
              <Button size="sm" variant="outline" onClick={() => setVideoPreview({ src: "", title: "" })}>
                关闭
              </Button>
            </div>
            <video src={videoPreview.src} controls autoPlay className="max-h-[78vh] w-full rounded border border-slate-200 bg-black" />
          </div>
        </div>
      ) : null}

      {showInitModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl rounded-2xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border p-4">
              <h2 className="text-lg font-semibold">欢迎使用，先完成初始化设置</h2>
              <p className="mt-1 text-sm text-muted-foreground">先选择视频提供商。切到火山就使用火山视频模型，切到 FAL 就使用 FAL 视频模型。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant={activeVideoProvider === "ark" ? "default" : "outline"} onClick={() => switchVideoProviderMode("ark")}>
                  视频提供商：火山
                </Button>
                <Button size="sm" variant={activeVideoProvider === "fal" ? "default" : "outline"} onClick={() => switchVideoProviderMode("fal")}>
                  视频提供商：FAL
                </Button>
              </div>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                {activeVideoProvider === "ark" ? (
                  <>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={initApiKey || savedApiKeyMasked}
                    onChange={(event) => setInitApiKey(event.target.value)}
                    placeholder="ARK_API_KEY"
                  />
                  <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 p-0" onClick={() => setShowApiKey((prev) => !prev)}>
                    {showApiKey ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">{savedApiKeyMasked ? `已保存密钥：${savedApiKeyMasked}` : "尚未检测到已保存密钥"}</p>
                <Input value={initBaseUrl} onChange={(event) => setInitBaseUrl(event.target.value)} placeholder="ARK_BASE_URL" />
                <div className="grid gap-2 md:grid-cols-2">
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={modelProviderFilter} onChange={(event) => setModelProviderFilter(event.target.value)}>
                    {providerOptions.map((provider) => (
                      <option key={`modal-provider-${provider}`} value={provider}>
                        {provider === "all" ? "全部开发商" : provider}
                      </option>
                    ))}
                  </select>
                  <Input value={modelMinParamsB} onChange={(event) => setModelMinParamsB(event.target.value)} placeholder="最小参数(B)，如 14" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => fetchVolcModels({ saveCredentials: false, allowStoredKey: true })}
                    disabled={running || initTesting || !(initApiKey.trim() || savedApiKeyMasked.trim())}
                  >
                    {initTesting ? "测试中..." : "测试并获取模型"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => fetchVolcModels({ saveCredentials: true, allowStoredKey: true })}
                    disabled={running || initTesting || !(initApiKey.trim() || savedApiKeyMasked.trim())}
                  >
                    重新获取并保存连接
                  </Button>
                </div>
                <Button onClick={saveModelSettings} disabled={running || !selectedModels.text || !selectedModels.video}>
                  保存并继续
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    localStorage.setItem("openvshot_init_seen", "1");
                    setShowInitModal(false);
                    setShowSettingsModal(true);
                  }}
                >
                  稍后在设置中完成
                </Button>
                <p className="text-xs text-slate-500">连接状态：{initStatus}</p>
                <p className="text-xs text-slate-500">筛选规则：开发商={modelProviderFilter}，最小参数={modelMinParamsB || 0}B（参数未知的模型默认保留）</p>
                  </>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={falApiKey || falSavedApiKeyMasked}
                        onChange={(event) => setFalApiKey(event.target.value)}
                        placeholder="FAL_API_KEY"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 p-0" onClick={() => setShowApiKey((prev) => !prev)}>
                        {showApiKey ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">{falSavedApiKeyMasked ? `已保存密钥：${falSavedApiKeyMasked}` : "尚未检测到已保存 FAL 密钥"}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={refreshFalModelOptions}
                        disabled={running || falModelsLoading || !(String(falApiKey || "").trim() || String(falSavedApiKeyMasked || "").trim())}
                      >
                        {falModelsLoading ? "刷新中..." : "刷新 FAL 模型"}
                      </Button>
                    </div>
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={falVideoModel} onChange={(event) => setFalVideoModel(event.target.value)}>
                      <option value="">请选择 FAL 视频模型</option>
                      {falModelOptions.map((modelId) => (
                        <option key={`init-fal-model-${modelId}`} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={falImageModel} onChange={(event) => setFalImageModel(event.target.value)}>
                      <option value="">请选择 FAL 图片模型</option>
                      {falImageModelOptions.map((modelId) => (
                        <option key={`init-fal-image-model-${modelId}`} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <Input value={falVideoModel} onChange={(event) => setFalVideoModel(event.target.value)} placeholder="FAL 视频模型（endpoint，例如 fal-ai/veo3）" />
                    <Input value={falImageModel} onChange={(event) => setFalImageModel(event.target.value)} placeholder="FAL 图片模型（endpoint，例如 fal-ai/flux）" />
                    <p className="text-xs text-slate-500">当前视频提供商为 FAL。保存后渲染使用 FAL 视频模型，图片生成优先使用 FAL 图片模型。</p>
                    <Button
                      onClick={saveModelSettings}
                      disabled={running || !String(falVideoModel || "").trim() || !String(falImageModel || "").trim() || !(String(falApiKey || "").trim() || String(falSavedApiKeyMasked || "").trim())}
                    >
                      保存并继续
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        localStorage.setItem("openvshot_init_seen", "1");
                        setShowInitModal(false);
                        setShowSettingsModal(true);
                      }}
                    >
                      稍后在设置中完成
                    </Button>
                    <p className="text-xs text-slate-500">连接状态：{initStatus}</p>
                  </>
                )}
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                {activeVideoProvider === "ark" ? (
                  <>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">文本模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.text} onChange={(event) => setSelectedModels((prev) => ({ ...prev, text: event.target.value }))}>
                    <option value="">请选择文本模型</option>
                    {initModels.text.map((row) => (
                      <option key={`modal-text-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">图像模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.image} onChange={(event) => setSelectedModels((prev) => ({ ...prev, image: event.target.value }))}>
                    <option value="">请选择图像模型</option>
                    {initModels.image.map((row) => (
                      <option key={`modal-image-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">视频模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.video} onChange={(event) => setSelectedModels((prev) => ({ ...prev, video: event.target.value }))}>
                    <option value="">请选择视频模型</option>
                    {initModels.video.map((row) => (
                      <option key={`modal-video-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">音频模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.audio} onChange={(event) => setSelectedModels((prev) => ({ ...prev, audio: event.target.value }))}>
                    <option value="">请选择音频模型</option>
                    {initModels.audio.map((row) => (
                      <option key={`modal-audio-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS App ID</label>
                  <Input value={ttsAppId} onChange={(event) => setTtsAppId(event.target.value)} placeholder="VOLC_TTS_APP_ID" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS Access Token</label>
                  <Input type={showApiKey ? "text" : "password"} value={ttsAccessToken} onChange={(event) => setTtsAccessToken(event.target.value)} placeholder="VOLC_TTS_ACCESS_TOKEN" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS 音色</label>
                  <Input value={ttsVoiceType} onChange={(event) => setTtsVoiceType(event.target.value)} placeholder="例如 zh_female_vv_uranus_bigtts" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS 接口地址</label>
                  <Input value={ttsBaseUrl} onChange={(event) => setTtsBaseUrl(event.target.value)} placeholder="https://openspeech.bytedance.com/api/v3/tts/unidirectional" />
                </div>
                  </>
                ) : (
                  <div className="grid gap-2 text-xs text-slate-600">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      FAL 模式下可分别配置视频模型与图片模型。火山文本/图像/音频配置保持不变，不与 FAL 模型混用。
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 break-all">
                      当前 FAL 视频模型：{String(falVideoModel || "").trim() || "未设置"}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 break-all">
                      当前 FAL 密钥：{String(falSavedApiKeyMasked || "").trim() || "未设置"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSettingsModal && !showInitModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]" onClick={() => setShowSettingsModal(false)}>
          <div className="w-full max-w-4xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h2 className="text-lg font-semibold">模型与密钥设置</h2>
                <p className="mt-1 text-sm text-muted-foreground">火山与 FAL 分开配置：切到哪一边，渲染就走哪一边。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant={activeVideoProvider === "ark" ? "default" : "outline"} onClick={() => switchVideoProviderMode("ark")}>
                    视频提供商：火山
                  </Button>
                  <Button size="sm" variant={activeVideoProvider === "fal" ? "default" : "outline"} onClick={() => switchVideoProviderMode("fal")}>
                    视频提供商：FAL
                  </Button>
                </div>
              </div>
              <Button variant="outline" onClick={() => setShowSettingsModal(false)}>
                关闭
              </Button>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                {activeVideoProvider === "ark" ? (
                  <>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={initApiKey || savedApiKeyMasked}
                    onChange={(event) => setInitApiKey(event.target.value)}
                    placeholder="ARK_API_KEY"
                  />
                  <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 p-0" onClick={() => setShowApiKey((prev) => !prev)}>
                    {showApiKey ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">{savedApiKeyMasked ? `已保存密钥：${savedApiKeyMasked}` : "尚未检测到已保存密钥"}</p>
                <Input value={initBaseUrl} onChange={(event) => setInitBaseUrl(event.target.value)} placeholder="ARK_BASE_URL" />
                <div className="grid gap-2 md:grid-cols-2">
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={modelProviderFilter} onChange={(event) => setModelProviderFilter(event.target.value)}>
                    {providerOptions.map((provider) => (
                      <option key={`settings-provider-${provider}`} value={provider}>
                        {provider === "all" ? "全部开发商" : provider}
                      </option>
                    ))}
                  </select>
                  <Input value={modelMinParamsB} onChange={(event) => setModelMinParamsB(event.target.value)} placeholder="最小参数(B)，如 14" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => fetchVolcModels({ saveCredentials: false, allowStoredKey: true })} disabled={running || initTesting || !(initApiKey.trim() || savedApiKeyMasked.trim())}>
                    {initTesting ? "测试中..." : "测试并获取模型"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => fetchVolcModels({ saveCredentials: true, allowStoredKey: true })}
                    disabled={running || initTesting || !(initApiKey.trim() || savedApiKeyMasked.trim())}
                  >
                    重新获取并保存连接
                  </Button>
                </div>
                <Button onClick={saveModelSettings} disabled={running || !selectedModels.text || !selectedModels.video}>
                  保存模型设置
                </Button>
                <p className="text-xs text-slate-500">连接状态：{initStatus}</p>
                <p className="text-xs text-slate-500">筛选规则：开发商={modelProviderFilter}，最小参数={modelMinParamsB || 0}B（参数未知的模型默认保留）</p>
                  </>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={falApiKey || falSavedApiKeyMasked}
                        onChange={(event) => setFalApiKey(event.target.value)}
                        placeholder="FAL_API_KEY"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 p-0" onClick={() => setShowApiKey((prev) => !prev)}>
                        {showApiKey ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">{falSavedApiKeyMasked ? `已保存密钥：${falSavedApiKeyMasked}` : "尚未检测到已保存 FAL 密钥"}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={refreshFalModelOptions}
                        disabled={running || falModelsLoading || !(String(falApiKey || "").trim() || String(falSavedApiKeyMasked || "").trim())}
                      >
                        {falModelsLoading ? "刷新中..." : "刷新 FAL 模型"}
                      </Button>
                    </div>
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={falVideoModel} onChange={(event) => setFalVideoModel(event.target.value)}>
                      <option value="">请选择 FAL 视频模型</option>
                      {falModelOptions.map((modelId) => (
                        <option key={`settings-fal-model-${modelId}`} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={falImageModel} onChange={(event) => setFalImageModel(event.target.value)}>
                      <option value="">请选择 FAL 图片模型</option>
                      {falImageModelOptions.map((modelId) => (
                        <option key={`settings-fal-image-model-${modelId}`} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <Input value={falVideoModel} onChange={(event) => setFalVideoModel(event.target.value)} placeholder="FAL 视频模型（endpoint）" />
                    <Input value={falImageModel} onChange={(event) => setFalImageModel(event.target.value)} placeholder="FAL 图片模型（endpoint）" />
                    <p className="text-xs text-slate-500">可在项目管理里的 Fal 快捷设置中自动选型，再一键回填到这里。</p>
                    <Button
                      onClick={saveModelSettings}
                      disabled={running || !String(falVideoModel || "").trim() || !String(falImageModel || "").trim() || !(String(falApiKey || "").trim() || String(falSavedApiKeyMasked || "").trim())}
                    >
                      保存模型设置
                    </Button>
                    <p className="text-xs text-slate-500">连接状态：{initStatus}</p>
                  </>
                )}
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
                {activeVideoProvider === "ark" ? (
                  <>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">文本模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.text} onChange={(event) => setSelectedModels((prev) => ({ ...prev, text: event.target.value }))}>
                    <option value="">请选择文本模型</option>
                    {initModels.text.map((row) => (
                      <option key={`settings-text-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">图像模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.image} onChange={(event) => setSelectedModels((prev) => ({ ...prev, image: event.target.value }))}>
                    <option value="">请选择图像模型</option>
                    {initModels.image.map((row) => (
                      <option key={`settings-image-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">视频模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.video} onChange={(event) => setSelectedModels((prev) => ({ ...prev, video: event.target.value }))}>
                    <option value="">请选择视频模型</option>
                    {initModels.video.map((row) => (
                      <option key={`settings-video-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">音频模型</label>
                  <select className="h-9 rounded-md border border-slate-200 px-2 text-sm" value={selectedModels.audio} onChange={(event) => setSelectedModels((prev) => ({ ...prev, audio: event.target.value }))}>
                    <option value="">请选择音频模型</option>
                    {initModels.audio.map((row) => (
                      <option key={`settings-audio-${row.id}`} value={row.id}>
                        {modelOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS App ID</label>
                  <Input value={ttsAppId} onChange={(event) => setTtsAppId(event.target.value)} placeholder="VOLC_TTS_APP_ID" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS Access Token</label>
                  <Input type={showApiKey ? "text" : "password"} value={ttsAccessToken} onChange={(event) => setTtsAccessToken(event.target.value)} placeholder="VOLC_TTS_ACCESS_TOKEN" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS 音色</label>
                  <Input value={ttsVoiceType} onChange={(event) => setTtsVoiceType(event.target.value)} placeholder="例如 zh_female_vv_uranus_bigtts" />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">火山 TTS 接口地址</label>
                  <Input value={ttsBaseUrl} onChange={(event) => setTtsBaseUrl(event.target.value)} placeholder="https://openspeech.bytedance.com/api/v3/tts/unidirectional" />
                </div>
                  </>
                ) : (
                  <div className="grid gap-2 text-xs text-slate-600">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      FAL 模式下可分别切换 FAL 视频模型与 FAL 图片模型，火山文本/图像/音频配置保持不变。
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 break-all">
                      当前 FAL 视频模型：{String(falVideoModel || "").trim() || "未设置"}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 break-all">
                      当前 FAL 图片模型：{String(falImageModel || "").trim() || "未设置"}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 break-all">
                      当前 FAL 密钥：{String(falSavedApiKeyMasked || "").trim() || "未设置"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {projectDeleteCandidate.stateFile ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setProjectDeleteCandidate({ stateFile: "", name: "" })}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-border p-4">
              <h2 className="text-lg font-semibold">确认删除项目</h2>
              <p className="mt-1 text-sm text-muted-foreground">删除后将同时移除项目目录与状态文件，无法恢复。</p>
            </div>
            <div className="grid gap-3 p-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                {projectDeleteCandidate.name || "未命名项目"}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setProjectDeleteCandidate({ stateFile: "", name: "" })} disabled={running}>
                  取消
                </Button>
                <Button variant="secondary" onClick={confirmDeleteProject} disabled={running}>
                  确认删除
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
