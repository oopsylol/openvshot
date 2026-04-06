# 真人短剧 AI 工作流（SOP）

## 目标与范围
- 产出可批量化的“真人短剧”成片，规格为 9:16、1-3 分钟、普通话配音+字幕。
- 以国内 API 为主，文本与语音优先使用硅基流动；视频模型通过评测流程确定主用与备用。
- 角色为虚拟演员，通过一致性包与参考图集保持跨镜头一致。

## 关键产出
- SOP 文档（本文件）
- 镜头清单 JSON 规范与示例：`schema/shot_list.schema.json`、`schema/shot_list.example.json`
- 提示词模板套件：`templates/`
- 模型评测流程与评分表：`evaluation/model_evaluation.md`、`evaluation/score_sheet.csv`

## 建议目录结构
- `projects/{series}/{episode}/`
- `projects/{series}/{episode}/story/`：选题、世界观、人物小传、大纲
- `projects/{series}/{episode}/shotlist/`：镜头清单 JSON
- `projects/{series}/{episode}/refs/`：角色参考图、风格参考图
- `projects/{series}/{episode}/renders/`：模型输出视频
- `projects/{series}/{episode}/audio/`：配音与字幕
- `projects/{series}/{episode}/edit/`：剪辑工程与导出文件
- `projects/{series}/{episode}/qa/`：质量检查记录与问题清单

## 工作流阶段与门禁

### 1) 选题与世界观设定
Input: 主题方向、受众画像、平台限制
Output: Logline、世界观设定、三幕概述
Gate: 主题可持续、人物关系清晰、冲突可在 1-3 分钟内闭合

### 2) 角色设定与一致性包
Input: 世界观设定、角色关系
Output: 角色卡、角色参考图集、风格一致性提示词
Gate: 每个角色 3-5 张参考图一致、外观描述可复述、禁忌清单齐全

### 3) 剧情大纲与分镜
Input: Logline、角色卡
Output: 场景列表、分镜摘要、对白草稿、7D 分镜矩阵
Gate: 场景数量 3-5 个、单集镜头 8-12 个、节奏紧凑、7D 字段完整
说明：可使用 AI 7D 生成器快速生成初稿，再人工校对。

### 4) 镜头级提示词生成
Input: 分镜摘要、角色卡、风格模板
Output: 镜头清单 JSON
Gate: 每个镜头具备完整字段，提示词与镜头目标一致

### 5) 视频生成与回炉
Input: 镜头清单 JSON
Output: 镜头级视频、失败记录、回炉队列
Gate: 关键镜头通过写实度与一致性检查；失败镜头进入回炉队列并记录原因与版本

### 6) 配音与字幕
Input: 镜头对白、人物音色设定
Output: 配音音频、字幕文件（SRT/ASS）
Gate: 听感自然、无明显错别字、与镜头时长匹配

### 7) 剪辑与交付
Input: 合格镜头、配音、字幕、BGM
Output: 成片 MP4
Gate: 画面连贯、音画同步、字幕无遮挡、平台规格符合
说明：使用“后期合成”模块生成 SRT、concat 列表与 ffmpeg 命令，一键合成成片时间线。

### 8) 质量复检与版本归档
Input: 成片、项目资产
Output: QA 记录、版本归档
Gate: 复检通过、所有资产可回溯、成本与耗时记录完成

## 镜头清单 JSON 规范
- 规范文件：`schema/shot_list.schema.json`
- 示例文件：`schema/shot_list.example.json`
- 字段包含：`episode_id`、`scene_id`、`shot_id`、`duration_sec`、`visual_prompt`、`negative_prompt`、`character_refs`、`camera_style`、`lighting_style`、`seed`、`output_path`、`voice_line`、`subtitle_line`、`status`
- 可选配音字段：`audio_path`
- 工业化扩展字段：`action_desc`、`version`、`retry_count`、`last_error`、`qa_score`、`qa_notes`、`storyboard_7d`、`gate_status`

## 提示词模板套件
- 角色卡模板：`templates/角色卡模板.md`
- 场景模板：`templates/场景模板.md`
- 镜头模板：`templates/镜头模板.md`
- 动作模板：`templates/动作模板.md`
- 负面提示词模板：`templates/负面提示词模板.md`
- 风格一致性模板：`templates/风格一致性模板.md`
- 组合规则：`templates/提示词组合规则.md`

## 模型适配层约定
- 镜头清单中允许加入可选字段 `provider`、`model`、`params`，用于适配不同视频模型。
- `provider` 建议使用国内服务标识（例如 vendor 名称）。
- `model` 使用官方模型代号或版本号。
- `params` 记录模型特有参数（如 cfg、steps、motion strength 等）。

## 质量门禁清单（全局）
- 写实度: 皮肤与材质细节自然，无明显 AI 伪影
- 角色一致性: 同一角色在不同镜头保持五官与发型一致
- 时序稳定: 无明显闪烁、抖动或物体漂移
- 构图与动线: 视觉引导清晰，镜头切换不跳戏
- 音画一致: 画面与对白节奏匹配

## 工业控制台与门禁
- 每个阶段都有 Gate 校验与阻断原因记录
- 通过“下一步建议”自动定位当前瓶颈模块
- 门禁报告与 QA 日志可归档进 Manifest

## 回炉与版本管理
- 每个镜头记录 `retry_count` 与 `version`
- 失败/回炉原因写入 `last_error`
- QA 低于阈值可自动进入回炉队列

## 评测流程指引
- 详见 `evaluation/model_evaluation.md`
- 通过 3 场景、8-12 镜头的标准样片，综合评分选主用与备用模型

## 运行与追踪指标
- 单集成本（API/存储/剪辑）
- 单集耗时（从脚本到成片）
- 失败镜头回炉率
- 平均镜头生成时延

## AI 7D/预演
- 使用文本模型生成 7D 分镜与预演建议
- 预演建议以 JSON 形式写入 `previs_notes`

## 7D/预演队列
- 支持把镜头加入队列按批次处理，避免一次性阻塞
- 队列任务支持 7D、预演或二者组合

## 队列自动运行
- 可开启自动运行，按设定间隔自动处理队列
- 队列为空或配置缺失时自动停止

## 成本估算
- 通过 Provider/模型的每秒价格表自动估算 `cost_yuan`
- 可选择覆盖已有成本或仅对完成镜头估算
- 支持成本规则 JSON 的导入与导出
- 提供成本规则模板便于快速起步

## 失败归因与优化报告
- 自动统计失败原因类别、QA 低分镜头、回炉次数高的镜头
- 输出优化建议报告（JSON）便于归档与复盘

## 快速启动步骤（最小可行）
1. 填写 `templates/角色卡模板.md`，生成 2-3 个核心角色
2. 使用 `templates/场景模板.md` 与 `templates/镜头模板.md` 产出镜头清单 JSON
3. 运行 8-12 镜头样片，按 `evaluation/model_evaluation.md` 评测模型
4. 确定主用模型后，进入规模化生产与优化
