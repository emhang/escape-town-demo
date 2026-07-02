const npcRoster = [
  { id: "priest", name: "阿贝尔神父", blurb: "说话轻声，回避地窖话题。" },
  { id: "dj", name: "DJ 莉娜", blurb: "深夜节目主持，咖啡上瘾，控制台冒火花。" },
  { id: "innkeeper", name: "旅馆老板萝蕾尔", blurb: "保存账簿，爱八卦但怕被逼问。" },
  { id: "cop", name: "警员迪马斯", blurb: "黎明巡逻，疲惫，抱着封存档案。" },
  { id: "kid", name: "信使小皮皮", blurb: "跑腿少年，手上都是粉笔印。" }
];

const starterClues = [
  "一张十年前“临时封闭”的破损告示。",
  "电台噪声在说“钟声停之前别出门”。",
  "旅馆账簿，十年前那几页被撕掉。"
];

const state = {
  sessionState: {
    npc_trust: Object.fromEntries(npcRoster.map((n) => [n.id, 0])),
    npc_emotions: {},
    unlocked_clues: [...starterClues],
    unlocked_locations: [],
    inventory: [],
    global_facts: [],
    progress_flags: []
  },
  memorySummary: [],
  recentDialogue: [],
  lastHint: ""
};

const chatLog = document.getElementById("chatLog");
const npcListEl = document.getElementById("npcList");
const clueListEl = document.getElementById("clueList");
const locationListEl = document.getElementById("locationList");
const inventoryListEl = document.getElementById("inventoryList");
const factsListEl = document.getElementById("factsList");
const hintCard = document.getElementById("hintCard");
const hintText = document.getElementById("hintText");
const targetSelect = document.getElementById("targetSelect");
const intentSelect = document.getElementById("intentSelect");
const toneInput = document.getElementById("toneInput");
const itemInput = document.getElementById("itemInput");
const userText = document.getElementById("userText");
const clearBtn = document.getElementById("clearBtn");
const actionForm = document.getElementById("actionForm");
let streamingBubble = null;
let streamingText = "";

init();

function init() {
  npcRoster.forEach((npc) => {
    const option = document.createElement("option");
    option.value = npc.id;
    option.textContent = npc.name;
    targetSelect.appendChild(option);
  });

  renderPanels();
  appendMessage(
    "system",
    "你在雾弯旅馆醒来，走廊电台沙沙作响，谈论着“没有结束的那一夜”。外面的路被大雾吞没。你必须与镇民建立信任，解锁隐藏地点，拼出真相才能离开。",
    "开场"
  );
  appendMessage("system", "初始线索已加入侧栏。", "系统");

  actionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendAction();
  });

  clearBtn.addEventListener("click", () => {
    chatLog.innerHTML = "";
  });
}

function renderPanels() {
  npcListEl.innerHTML = "";
  npcRoster.forEach((npc) => {
    const trust = state.sessionState.npc_trust[npc.id] ?? 0;
    const emotion = state.sessionState.npc_emotions[npc.id] || "平静";
    const row = document.createElement("div");
    row.className = "status-row";
    row.innerHTML = `
      <div>
        <div><strong>${npc.name}</strong></div>
        <div class="meta">${npc.blurb}</div>
      </div>
      <div>
        <span class="chip green">信任 ${trust}</span>
        <span class="chip">${emotion}</span>
      </div>
    `;
    npcListEl.appendChild(row);
  });

  renderList(clueListEl, state.sessionState.unlocked_clues, "• ");
  renderList(locationListEl, state.sessionState.unlocked_locations, "◆ ");
  renderList(inventoryListEl, state.sessionState.inventory, "→ ");
  renderList(factsListEl, state.sessionState.global_facts, "✱ ");

  if (state.lastHint) {
    hintCard.hidden = false;
    hintText.textContent = state.lastHint;
  } else {
    hintCard.hidden = true;
  }
}

function renderList(el, items, prefix = "") {
  el.innerHTML = "";
  if (!items || !items.length) {
    const empty = document.createElement("li");
    empty.textContent = "暂无。";
    el.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${prefix}${item}`;
    el.appendChild(li);
  });
}

function appendMessage(sender, text, meta = "") {
  if (!text) return;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${sender === "user" ? "user" : "assistant"}`;

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = meta;
    bubble.appendChild(metaEl);
  }

  const body = document.createElement("div");
  body.innerText = text;
  bubble.appendChild(body);

  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendAction() {
  const target = targetSelect.value;
  const intent = intentSelect.value;
  const tone = toneInput.value.trim();
  const item = itemInput.value.trim();
  const text = userText.value.trim();

  if (!text) {
    userText.focus();
    return;
  }

  appendMessage("user", text, target ? `对 ${target}` : "你");
  pushDialogue({ speaker: "player", text, target });

  try {
    const payload = {
      userText: text,
      userAction: { target, intent, tone, item },
      sessionState: state.sessionState,
      memorySummary: state.memorySummary,
      recentDialogue: state.recentDialogue,
      globalFacts: state.sessionState.global_facts
    };

    const res = await fetch("/api/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await handleStream(res, intent, target);
  } catch (err) {
    appendMessage("system", `错误：${err.message}`, "系统");
  } finally {
    renderPanels();
    userText.value = "";
    toneInput.value = "";
    itemInput.value = "";
    streamingBubble = null;
    streamingText = "";
  }
}

function applyStateUpdate(update) {
  if (update.npc_trust_changes) {
    Object.entries(update.npc_trust_changes).forEach(([id, delta]) => {
      const current = state.sessionState.npc_trust[id] || 0;
      state.sessionState.npc_trust[id] = current + delta;
    });
  }

  if (update.npc_emotions) {
    Object.entries(update.npc_emotions).forEach(([id, emo]) => {
      state.sessionState.npc_emotions[id] = emo;
    });
  }

  if (update.unlocked_clues) {
    uniquePush(state.sessionState.unlocked_clues, update.unlocked_clues);
  }

  if (update.unlocked_locations) {
    uniquePush(state.sessionState.unlocked_locations, update.unlocked_locations);
  }

  if (update.inventory_changes) {
    applyInventoryChanges(update.inventory_changes);
  }

  if (update.global_facts_append) {
    uniquePush(state.sessionState.global_facts, update.global_facts_append);
  }

  if (update.progress_flags) {
    uniquePush(state.sessionState.progress_flags, update.progress_flags);
  }

  if (update.memory_summary_append) {
    uniquePush(state.memorySummary, update.memory_summary_append);
    state.memorySummary = state.memorySummary.slice(-8);
  }
}

function uniquePush(target, items) {
  items.forEach((item) => {
    if (!target.includes(item)) target.push(item);
  });
}

function applyInventoryChanges(changes) {
  changes.forEach((change) => {
    if (change.startsWith("add:")) {
      const item = change.replace("add:", "");
      if (!state.sessionState.inventory.includes(item)) {
        state.sessionState.inventory.push(item);
      }
    } else if (change.startsWith("remove:")) {
      const item = change.replace("remove:", "");
      state.sessionState.inventory = state.sessionState.inventory.filter((i) => i !== item);
    }
  });
}

async function handleStream(res, intent, target) {
  if (!res.body) {
    throw new Error("无响应流");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  streamingText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processSSE(rawEvent, intent, target);
    }
  }
}

function processSSE(rawEvent, intent, target) {
  const lines = rawEvent.split("\n");
  let event = "message";
  let data = "";
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.replace("event:", "").trim();
    } else if (line.startsWith("data:")) {
      data += line.replace("data:", "").trim() + "\n";
    }
  });
  data = data.trim();

  if (event === "message") {
    if (!streamingBubble) {
      streamingBubble = createStreamingBubble(target ? `${target}回应` : "旁白");
    }
    streamingText += data;
    updateStreamingBubble(streamingText);
  } else if (event === "state") {
    try {
      const parsed = JSON.parse(data);
      applyStateUpdate(parsed.stateUpdate || {});
      if (parsed.verdict && intent === "submit_verdict") {
        const verdictText = formatVerdict(parsed.verdict);
        appendMessage("assistant", verdictText, "推理评分");
      }
      if (parsed.hint) state.lastHint = parsed.hint;
      if (parsed.endgameCheck?.can_exit) {
        const missing = parsed.endgameCheck.missing?.join(", ") || "无";
        appendMessage("system", `你已接近离开小镇。仍缺：${missing}`, "离开条件");
      }
      if (streamingText && target) {
        pushDialogue({ speaker: "npc", text: streamingText, target });
      } else if (streamingText) {
        pushDialogue({ speaker: "npc", text: streamingText, target: "" });
      }
    } catch (err) {
      appendMessage("system", `解析错误：${err.message}`, "系统");
    }
  } else if (event === "error") {
    appendMessage("system", `错误：${data}`, "系统");
  }
}

function createStreamingBubble(meta) {
  const bubble = document.createElement("div");
  bubble.className = "bubble assistant";
  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = meta;
    bubble.appendChild(metaEl);
  }
  const body = document.createElement("div");
  body.innerText = "";
  bubble.appendChild(body);
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return { bubble, body };
}

function updateStreamingBubble(text) {
  if (!streamingBubble) return;
  streamingBubble.body.innerText = text;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function pushDialogue(entry) {
  state.recentDialogue.push({
    speaker: entry.speaker,
    text: entry.text,
    target: entry.target || "",
    time: Date.now()
  });
  state.recentDialogue = state.recentDialogue.slice(-8);
}

function formatVerdict(verdict) {
  const parts = [
    `凶手匹配: ${verdict.culprit_match}`,
    `动机匹配: ${verdict.motive_match}`,
    `手法匹配: ${verdict.method_match}`,
    `时间线覆盖: ${(verdict.timeline_coverage * 100 || 0).toFixed(0)}%`,
    `缺失: ${(verdict.missing_points || []).join("; ") || "无"}`,
    `矛盾: ${(verdict.contradictions || []).join("; ") || "无"}`,
    `评分: ${verdict.score ?? "N/A"}`
  ];
  return parts.join("\n");
}
