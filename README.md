# 雾弯逃离（LLM 演示版）

可直接运行的 Web 演示：LLM 驱动的神秘小镇逃脱。服务端读取 `.env` 中的 LLM 基础地址、API Key、模型名，转发 `/api/chat` 请求，并要求模型按“先 JSON 再文本”的结构化输出。

## 快速开始
1) 复制环境变量模板并填写：
```bash
cp .env.example .env
# 编辑 .env：LLM_BASE_URL、LLM_API_KEY、LLM_MODEL、LLM_REASONING_EFFORT(可选)、PORT(可选)
```
接口需兼容 OpenAI 格式，路径 `${LLM_BASE_URL}/chat/completions`。`LLM_REASONING_EFFORT` 会透传给接口（如支持，可设 low/medium/high）。

2) 启动（无需额外依赖，Node 20+）：
```bash
npm start
# 或
node server.js
```
3) 浏览器打开 http://localhost:5173 （或自定义的 `PORT`）。

## 结构说明
- `server.js` 读取真相卡，构造 system prompt，把状态/记忆/用户动作封装后调用 LLM；要求回复为 JSON + `---` + 玩家可读文本。
- `public/app.js` 管理前端状态（信任、线索、地点、背包、已知事实、记忆摘要），基于 `state_update` 更新 UI，显示提示与回复。
- 真相卡在 `data/truthCard.js`，可修改场景皮肤和秘密。

## LLM 输出契约
回复格式：先 JSON，后 `---`，再可读文本。JSON 字段：
```
state_update: {
  npc_trust_changes: {"npcId": +1|-1},
  npc_emotions: {"npcId": "警惕|开放|紧张|期望"},
  unlocked_clues: ["线索id或一句话"],
  unlocked_locations: ["地点id"],
  inventory_changes: ["add:物品", "remove:物品"],
  global_facts_append: ["已知事实一句话"],
  progress_flags: ["标记id"],
  memory_summary_append: ["摘要要点"]
},
response_to_player: "80-120 字回复",
hint: "可选提示",
endgame_check: {can_exit: bool, missing: [...]},
verdict: {culprit_match, motive_match, method_match, timeline_coverage, missing_points, contradictions, score}
```
当玩家意图为提交推理（`submit_verdict`）时填写 `verdict`，其他回合可留空。

## 备注
- UI 保留最近 8 轮原文和一份可追加的记忆摘要，每次调用都会传给 LLM。
- 本地不做规则判定，全部由 LLM 按真相卡与状态给出 gating/评分。 
