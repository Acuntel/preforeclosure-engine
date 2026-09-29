// Fake Telegram Bot API for the A2 tests. mode: "ok" | "fail" | "timeout".
export function fakeTelegram() {
  let mid = 100;
  const fake = {
    mode: "ok",
    calls: [],
    updates: [],
    sends: () => fake.calls.filter((c) => c.method === "sendMessage"),
    fn: async (method, payload) => {
      fake.calls.push({ method, payload });
      if (method === "sendMessage") {
        if (fake.mode === "fail") return { ok: false, description: "Bad Request: chat not found" };
        if (fake.mode === "timeout") return { ok: false, unknown: true };
        return { ok: true, result: { message_id: ++mid } };
      }
      if (method === "getUpdates") return { ok: true, result: fake.updates.splice(0) };
      return { ok: true, result: true };
    },
  };
  return fake;
}
