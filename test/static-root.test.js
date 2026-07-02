const assert = require("node:assert/strict");
const test = require("node:test");

test("GET / serves the static index page", async () => {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5173";
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/html/);
  assert.match(await response.text(), /<html/i);
});
