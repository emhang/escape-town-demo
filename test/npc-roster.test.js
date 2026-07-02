const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const truthCard = require("../data/truthCard");

test("clockmaker NPC is available to the game engine and UI roster", () => {
  assert.ok(truthCard.npcs.clockmaker, "truth card should define clockmaker");
  assert.equal(truthCard.npcs.clockmaker.display_name, "钟楼修表匠秦秒");
  assert.ok(
    truthCard.npcs.clockmaker.trust_gates.some((gate) => gate.includes("误导")),
    "clockmaker should be framed as a troublemaker"
  );

  const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(appJs, /id:\s*"clockmaker"/);
  assert.match(appJs, /秦秒/);
});
