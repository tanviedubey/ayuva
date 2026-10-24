import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, signedUpClient } from "../helpers/app.js";

let ctx, A, B, aReminder, aHistory;
before(async () => {
  ctx = await startApp();
  A = await signedUpClient(ctx, "Alice"); B = await signedUpClient(ctx, "Bob");
  aReminder = (await A.post("/reminders", { name: "Alice reminder", time: "08:00" })).body.reminder;
  aHistory = (await A.post("/history", { title: "Alice fever", urgency: "routine" })).body.entry;
  await A.put("/checkins/2026-10-01", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 });
  await B.post("/reminders", { name: "Bob reminder", time: "09:00" });
});
after(async () => { await ctx.close(); });

test("every private route requires authentication", async () => {
  const anon = ctx.client();
  for (const [m, p, b] of [["GET", "/history"], ["POST", "/history", { title: "x" }], ["GET", "/checkins"], ["PUT", "/checkins/2026-10-01", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 }],
    ["GET", "/reminders"], ["POST", "/reminders", { name: "x", time: "08:00" }], ["GET", "/calendar/summary?from=2026-01-01&to=2026-12-31"], ["GET", "/profile"], ["PATCH", "/profile", { name: "x" }], ["GET", "/privacy/export"],
    ["DELETE", "/history/" + aHistory.id], ["PATCH", "/reminders/" + aReminder.id, { active: false }], ["DELETE", "/reminders/" + aReminder.id], ["DELETE", "/auth/account", { password: "x" }]]) {
    const r = await anon.send(m, p, b); assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test("user B only ever sees B's data in lists, calendar and export", async () => {
  assert.deepEqual((await B.get("/reminders")).body.reminders.map((r) => r.name), ["Bob reminder"]);
  assert.equal((await B.get("/history")).body.history.length, 0);
  assert.equal((await B.get("/checkins")).body.checkins.length, 0);
  assert.equal((await B.get("/calendar/summary?from=2026-01-01&to=2026-12-31")).body.checkins.length, 0);
  const exp = await B.get("/privacy/export"); assert.doesNotMatch(exp.text, /Alice/);
});

test("B cannot update or delete A's reminder or history (404, data intact)", async () => {
  assert.equal((await B.patch("/reminders/" + aReminder.id, { name: "hacked" })).status, 404);
  assert.equal((await B.delete("/reminders/" + aReminder.id)).status, 404);
  assert.equal((await B.delete("/history/" + aHistory.id)).status, 404);
  assert.equal((await A.get("/reminders")).body.reminders[0].name, "Alice reminder");
  assert.equal((await A.get("/history")).body.history.length, 1);
});

test("B's check-in on the same date does not overwrite A's", async () => {
  await B.put("/checkins/2026-10-01", { mood: "Low", energy: "Tired", digestion: "Heavy", sleep: 3 });
  assert.equal((await A.get("/checkins")).body.checkins.find((c) => c.date === "2026-10-01").mood, "Good");
});

test("A can manage own data", async () => {
  const p = await A.patch("/reminders/" + aReminder.id, { active: false, takenOn: "2026-10-02" });
  assert.equal(p.status, 200); assert.equal(p.body.reminder.active, false); assert.equal(p.body.reminder.takenOn, "2026-10-02");
  assert.equal((await A.delete("/history/" + aHistory.id)).status, 200);
});
