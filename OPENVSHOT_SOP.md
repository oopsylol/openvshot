# OpenVShot 全流程 SOP（可直接执行）

## 0) 目标
- 从一个点子开始，经过可反复修改的故事、剧本、角色、场景、分镜，最终逐镜头审片、满意后合成成片。
- 全流程支持断电恢复、项目切换、资产版本管理、多模态图文提交渲染。

## 1) 一次性准备
```bash
vshot setup
```

如需手动设置环境变量（PowerShell）：
```powershell
$env:ARK_API_KEY="你的Key"
$env:ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
$env:VOLC_TEXT_MODEL="doubao-seed-2-0-pro-260215"
$env:VOLC_IMAGE_MODEL="doubao-seedream-4-0-250828"
$env:VOLC_VIDEO_MODEL="doubao-seedance-1-5-pro-251215"
```

## 2) 新建项目
```bash
vshot p new --name my_film --root D:\wwwroot\video-creater --state-file D:\wwwroot\video-creater\my_film_state.json
```

查看/切换项目：
```bash
vshot p list
vshot p use --name my_film
vshot p continue
```

## 3) 点子 -> 故事（可反复修改）
### 方式A：交互聊天
```bash
vshot
```
- 在聊天里直接输入自然语言。
- 快捷输入：`state`、`continue`、`menu`、`exit`。

### 方式B：命令式
```bash
vshot --json session-start --state-file D:\wwwroot\video-creater\my_film_state.json
vshot --json session-step --state-file D:\wwwroot\video-creater\my_film_state.json --input "这是我的点子..."
vshot --json session-step --state-file D:\wwwroot\video-creater\my_film_state.json --input "把第二段冲突再加强"
vshot --json session-state --state-file D:\wwwroot\video-creater\my_film_state.json
```

## 4) 故事 -> 剧本（可反复修改）
```bash
vshot --json script-generate --state-file D:\wwwroot\video-creater\my_film_state.json --source story
vshot --json script-revise --state-file D:\wwwroot\video-creater\my_film_state.json --instruction "把对话口语化"
```

## 5) 角色与场景资产（可自己提供素材 + 版本化）
### 5.1 角色（两种方式）
- 自动生成：
```bash
vshot --json character-design --state-file D:\wwwroot\video-creater\my_film_state.json --name 阿豹 --description "写实豹猫，暖棕底色，琥珀眼，毛发超细节"
```
- 导入你自己的人脸/角色图：
```bash
vshot --json asset-add --state-file D:\wwwroot\video-creater\my_film_state.json --kind face --name 阿豹 --file D:\assets\abao.png
```

### 5.2 场景（两种方式）
- 自动生成：
```bash
vshot --json scene-design --state-file D:\wwwroot\video-creater\my_film_state.json --name 商场夜景 --description "写实夜景，湿地反光，电影感"
```
- 导入你的场景图：
```bash
vshot --json asset-add --state-file D:\wwwroot\video-creater\my_film_state.json --kind scene --name 商场夜景 --file D:\assets\mall_night.png
```

### 5.3 资产版本管理
```bash
vshot --json asset-list --state-file D:\wwwroot\video-creater\my_film_state.json
vshot --json asset-activate --state-file D:\wwwroot\video-creater\my_film_state.json --kind face --name 阿豹 --version latest
vshot --json asset-activate --state-file D:\wwwroot\video-creater\my_film_state.json --kind scene --name 商场夜景 --version 2
vshot --json asset-lock --state-file D:\wwwroot\video-creater\my_film_state.json --kind scene --name 商场夜景 --version 2
vshot --json asset-lock --state-file D:\wwwroot\video-creater\my_film_state.json --kind scene --name 商场夜景 --unlock
vshot --json asset-remove-version --state-file D:\wwwroot\video-creater\my_film_state.json --kind scene --name 商场夜景 --version 1
```

## 6) 出分镜（可反复改）
```bash
vshot --json plan --state-file D:\wwwroot\video-creater\my_film_state.json --title "我的短片" --story "..." --seconds 20
vshot --json shot-revise --state-file D:\wwwroot\video-creater\my_film_state.json --shot-id S01 --instruction "改成更克制的镜头运动"
```

## 7) 渲染（逐镜头审片循环）
### 7.1 严格多模态渲染单镜头（推荐）
```bash
vshot --json render-shot --state-file D:\wwwroot\video-creater\my_film_state.json --shot-id S01 --strict-multimodal --poll --download-dir videos
```

### 7.2 审片后继续改镜头
```bash
vshot --json shot-revise --state-file D:\wwwroot\video-creater\my_film_state.json --shot-id S01 --instruction "人物表情更平静，背景灯更暖"
vshot --json render-shot --state-file D:\wwwroot\video-creater\my_film_state.json --shot-id S01 --strict-multimodal --poll --download-dir videos
```

### 7.3 满意镜头标记批准
```bash
vshot --json render-shot --state-file D:\wwwroot\video-creater\my_film_state.json --shot-id S01 --strict-multimodal --poll --download-dir videos --approve
```

## 8) 任务进度与断电恢复
```bash
vshot --json s
vshot --json t --refresh
vshot --json r --poll-render --interval 8 --timeout 1200
vshot --json continue
vshot --json continue --chat
```

## 9) 合成最终视频
```bash
vshot --json merge-approved --state-file D:\wwwroot\video-creater\my_film_state.json --download-dir videos --output final.mp4
```

## 10) 项目目录结构
项目初始化后会在项目目录自动生成：
- `assets/characters` 角色资产（版本化）
- `assets/scenes` 场景资产（版本化）
- `scripts` 故事/剧本
- `shots` 分镜与节拍
- `renders/videos` 渲染视频

## 11) 推荐最短命令（常用）
```bash
vshot p list
vshot p continue
vshot s
vshot t --refresh
```

