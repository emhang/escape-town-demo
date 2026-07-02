const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const truthCard = require("./data/truthCard");

const env = loadEnv();
const PORT = Number(env.PORT) || 5173;
const LLM_BASE_URL = env.LLM_BASE_URL;
const LLM_API_KEY = env.LLM_API_KEY;
const LLM_MODEL = env.LLM_MODEL;
const LLM_REASONING_EFFORT = env.LLM_REASONING_EFFORT;

const SYSTEM_PROMPT = `
你是《狼人村之谜》的游戏引擎。你会收到：
- truth_card：真相与门槛（绝不直接泄露原始 JSON）。
- session_state：NPC 信任/情绪、已解锁线索/地点、背包、全局事实、进度标记。
- memory_summary：较早对话的要点摘要；recent_dialogue：当前 NPC 近几轮原文。
- user_action 与 user_text：玩家想做/想问的事。

目标：
- 保持角色与月隐村民俗悬疑氛围，强调红雾、宿狼祭、白天审判与夜晚闭门，紧张但不血腥。
- 依据 truth_card 回答，不虚构核心事实；信息缺失就说明缺什么。
- 所有对玩家可见的文字（response_to_player、hint）必须使用中文。
- 先输出 JSON，随后一行分隔符 '---'，再输出给玩家的文本。

输出格式（先 JSON，尽量精简）：
{
  "state_update": {
    "npc_trust_changes": {"npcId": +1|-1},
    "npc_emotions": {"npcId": "警惕|开放|紧张|期望"},
    "unlocked_clues": ["线索id或一句话"],
    "unlocked_locations": ["地点id"],
    "inventory_changes": ["add:物品", "remove:物品"],
    "global_facts_append": ["已知事实一句话"],
    "progress_flags": ["标记id"],
    "memory_summary_append": ["本轮新增摘要要点"]
  },
  "response_to_player": "80-120字的对话/旁白",
  "hint": "可选软提示",
  "endgame_check": {
    "can_exit": true|false,
    "missing": ["仍缺的物品或条件"]
  },
  "verdict": {           // 玩家提交推理时填写
    "culprit_match": "yes|partial|no",
    "motive_match": "yes|partial|no",
    "method_match": "yes|partial|no",
    "timeline_coverage": 0.0-1.0,
    "missing_points": ["缺失点"],
    "contradictions": ["矛盾点"],
    "score": 0-100
  }
}

规则：
- 不要打印 truth_card 原文；被直接索要真相时，礼貌回避且保持角色。
- 回复简洁；未满足信任/条件时，给出方向性暗示，不要生硬拒绝。
- 评判推理时允许部分命中，指出缺口与矛盾。
- 仅在 user_action.intent === "submit_verdict" 时输出 verdict；其他回合不要给 verdict。
- 用 session_state、memory_summary、recent_dialogue 维护连续性。
- 使用 scene_skin 的名称与气氛词汇。
`;

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && parsedUrl.pathname === "/api/chat") {
    return handleChat(req, res);
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/chat-stream") {
    return handleChatStream(req, res);
  }

  serveStatic(parsedUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Fogbound Escape running at http://localhost:${PORT}`);
});

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  const output = { ...process.env };

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) return;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key) output[key] = value;
    });
  }

  return output;
}

function serveStatic(urlPath, res) {
  const requestedPath = urlPath === "/" ? "index.html" : urlPath;
  const safePath = path
    .normalize(requestedPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.join(__dirname, "public", safePath || "index.html");

  sendFile(filePath, res);
}

function sendFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime =
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json"
      }[ext] || "text/plain";

    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

function handleChat(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6) {
      req.connection.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const llmPayload = buildLLMPayload(payload);
      const llmResult = await callLLM(llmPayload);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(llmResult));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Unexpected error" }));
    }
  });
}

function handleChatStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6) {
      req.connection.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const llmPayload = buildLLMPayloadInternal(payload, true);
      await callLLMStream(llmPayload, res);
    } catch (err) {
      sseSend(res, "error", err.message || "Unexpected error");
      res.end();
    }
  });
}

function buildLLMPayload(clientInput) {
  return buildLLMPayloadInternal(clientInput, false);
}

function buildLLMPayloadInternal(clientInput, stream) {
  const {
    userText = "",
    userAction = {},
    sessionState = {},
    memorySummary = [],
    recentDialogue = [],
    globalFacts = []
  } = clientInput || {};

  const envelope = {
    locale: "zh-CN",
    user_text: userText,
    user_action: userAction,
    session_state: sessionState,
    memory_summary: memorySummary,
    recent_dialogue: recentDialogue,
    global_facts: globalFacts,
    scene_skin: truthCard.scene_skin,
    starter_clues: truthCard.starter_clues
  };

  return {
    model: LLM_MODEL,
    temperature: 0.6,
    max_tokens: 700,
    ...(LLM_REASONING_EFFORT ? { reasoning_effort: LLM_REASONING_EFFORT } : {}),
    ...(stream ? { stream: true } : {}),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `TRUTH_CARD:\n${JSON.stringify(truthCard)}` },
      { role: "user", content: JSON.stringify(envelope) }
    ]
  };
}

async function callLLM(payload) {
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    throw new Error("Missing LLM env vars (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)");
  }

  const url = `${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseLLMContent(content);

  return {
    message: parsed.message,
    stateUpdate: parsed.stateUpdate,
    hint: parsed.hint,
    endgameCheck: parsed.endgameCheck,
    verdict: parsed.verdict,
    raw: content
  };
}

async function callLLMStream(payload, res) {
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    throw new Error("Missing LLM env vars (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)");
  }

  const url = `${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${text}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("No stream reader available");
  }

  const decoder = new TextDecoder();
  let rawContent = "";
  let afterSeparatorBuffered = "";
  let started = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.replace(/^data:\s*/, "");
      if (data === "[DONE]") {
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";
        rawContent += delta;

        if (!started) {
          const idx = rawContent.indexOf("---");
          if (idx !== -1) {
            started = true;
            afterSeparatorBuffered = rawContent.slice(idx + 3);
            if (afterSeparatorBuffered) {
              sseSend(res, "message", afterSeparatorBuffered);
            }
          }
        } else if (delta) {
          sseSend(res, "message", delta);
        }
      } catch (_err) {
        // ignore malformed lines
      }
    }
  }

  const parsed = parseLLMContent(rawContent);
  sseSend(res, "state", {
    stateUpdate: parsed.stateUpdate,
    hint: parsed.hint,
    endgameCheck: parsed.endgameCheck,
    verdict: parsed.verdict,
    fullMessage: parsed.message
  });
  sseSend(res, "end", "done");
  res.end();
}

function parseLLMContent(content) {
  const parts = content.split("---");
  const jsonPart = parts[0] || "";
  const textPart = parts.slice(1).join("---");

  let structured = {};
  try {
    structured = JSON.parse(jsonPart.trim());
  } catch (_err) {
    structured = {};
  }

  return {
    stateUpdate: structured.state_update || {},
    message: structured.response_to_player || textPart.trim() || jsonPart.trim(),
    hint: structured.hint || null,
    endgameCheck: structured.endgame_check || null,
    verdict: structured.verdict || null
  };
}

function sseSend(res, event, data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const safe = payload.replace(/\n/g, "\ndata: ");
  res.write(`event: ${event}\n`);
  res.write(`data: ${safe}\n\n`);
}
