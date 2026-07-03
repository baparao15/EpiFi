// Verifies key-rotation behavior with a mocked fetch — actually exhausting real Groq rate
// limits across 10 real keys isn't practical to test against, so this proves the logic in
// isolation: round-robin, cooldown-on-429 (honoring Retry-After), cooldown-on-401/403,
// fail-fast on non-key errors, and the "all keys exhausted" terminal error.

const assert = require("assert");
const CLIENT_PATH = require.resolve("./groqClient");

function freshClient(keysCsv) {
  delete require.cache[CLIENT_PATH];
  process.env.GROQ_API_KEYS = keysCsv;
  delete process.env.GROQ_API_KEY;
  return require("./groqClient");
}

function fakeRes(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] || null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

async function run() {
  let failures = 0;
  function check(name, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => console.log(`  ok — ${name}`))
      .catch((e) => {
        failures++;
        console.error(`  FAIL — ${name}: ${e.message}`);
      });
  }

  // ---- Scenario 1: keyA and keyB rate-limited, keyC succeeds ----
  await check("falls through 429s to the next key and succeeds", async () => {
    const client = freshClient("keyA,keyB,keyC");
    const seenKeys = [];
    global.fetch = async (url, opts) => {
      const key = opts.headers.Authorization.replace("Bearer ", "");
      seenKeys.push(key);
      if (key === "keyA") return fakeRes(429, "rate limited", { "retry-after": "2" });
      if (key === "keyB") return fakeRes(429, "rate limited"); // no retry-after -> default backoff
      return fakeRes(200, JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    };

    const result = await client._internal.callGroq({ model: "m", messages: [] });
    assert.deepStrictEqual(result, { ok: true });
    assert.deepStrictEqual(seenKeys, ["keyA", "keyB", "keyC"]);
    assert.ok(client._internal.cooldownUntil.get("keyA") > Date.now());
    assert.ok(client._internal.cooldownUntil.get("keyB") > Date.now());
    assert.ok(!client._internal.cooldownUntil.has("keyC"));

    // Immediately calling again should skip keyA/keyB (still cooling) and go straight to keyC.
    seenKeys.length = 0;
    const result2 = await client._internal.callGroq({ model: "m", messages: [] });
    assert.deepStrictEqual(result2, { ok: true });
    assert.deepStrictEqual(seenKeys, ["keyC"]);
  });

  // ---- Scenario 2: a key's cooldown expiring makes it available again ----
  await check("a key becomes available again once its cooldown expires", async () => {
    const client = freshClient("keyA,keyB");
    let callNum = 0;
    global.fetch = async (url, opts) => {
      const key = opts.headers.Authorization.replace("Bearer ", "");
      callNum++;
      if (key === "keyA" && callNum === 1) return fakeRes(429, "rate limited", { "retry-after": "0" });
      return fakeRes(200, JSON.stringify({ choices: [{ message: { content: '{"n":' + callNum + "}" } }] }));
    };

    await client._internal.callGroq({ model: "m", messages: [] }); // keyA 429s (0s cooldown) -> keyB succeeds
    // Simulate the 0s cooldown having already elapsed (it basically has, but be explicit).
    client._internal.cooldownUntil.set("keyA", Date.now() - 1);
    const seenKeys = [];
    global.fetch = async (url, opts) => {
      seenKeys.push(opts.headers.Authorization.replace("Bearer ", ""));
      return fakeRes(200, JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    };
    await client._internal.callGroq({ model: "m", messages: [] });
    assert.ok(seenKeys.includes("keyA"), "expected keyA to be tried again after cooldown expired");
  });

  // ---- Scenario 3: 401/403 puts a key on long cooldown, doesn't retry it same run ----
  await check("401 (bad key) is skipped for the rest of the run", async () => {
    const client = freshClient("keyA,keyB");
    global.fetch = async (url, opts) => {
      const key = opts.headers.Authorization.replace("Bearer ", "");
      if (key === "keyA") return fakeRes(401, "invalid api key");
      return fakeRes(200, JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    };
    await client._internal.callGroq({ model: "m", messages: [] });
    const cooldown = client._internal.cooldownUntil.get("keyA");
    assert.ok(cooldown - Date.now() > 60 * 60 * 1000, "expected a long (>1h) cooldown for an invalid key");
  });

  // ---- Scenario 4: non-key error (500) fails fast, doesn't burn through other keys ----
  await check("a 500 fails fast without trying remaining keys", async () => {
    const client = freshClient("keyA,keyB,keyC");
    const seenKeys = [];
    global.fetch = async (url, opts) => {
      seenKeys.push(opts.headers.Authorization.replace("Bearer ", ""));
      return fakeRes(500, "server error");
    };
    await assert.rejects(() => client._internal.callGroq({ model: "m", messages: [] }), /500/);
    assert.deepStrictEqual(seenKeys, ["keyA"]);
  });

  // ---- Scenario 5: every key rate-limited -> clear terminal error, no infinite loop ----
  await check("all keys exhausted raises a clear error instead of hanging", async () => {
    const client = freshClient("keyA,keyB");
    global.fetch = async () => fakeRes(429, "rate limited", { "retry-after": "5" });
    await assert.rejects(
      () => client._internal.callGroq({ model: "m", messages: [] }),
      /All 2 Groq API key\(s\) are rate-limited or invalid/
    );
  });

  console.log(failures === 0 ? "\nAll key-rotation tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
