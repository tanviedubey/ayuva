import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, signedUpClient } from "../helpers/app.js";

let ctx, u;
before(async () => { ctx = await startApp(); u = await signedUpClient(ctx); });
after(async () => { await ctx.close(); });

test("check-ins upsert per date and appear in list + calendar", async () => {
  const body = { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7.5 };
  assert.equal((await u.put("/checkins/2026-10-05", body)).body.checkin.sleep, 7.5);
  await u.put("/checkins/2026-10-05", { ...body, mood: "Great" });
  const list = (await u.get("/checkins")).body.checkins; assert.equal(list.length, 1); assert.equal(list[0].mood, "Great"); assert.equal(list[0].date, "2026-10-05");
  const cal = (await u.get("/calendar/summary?from=2026-10-01&to=2026-10-31")).body; assert.equal(cal.stats.checkins, 1); assert.equal(cal.stats.averageSleep, 7.5);
  assert.equal((await u.get("/checkins?from=2026-11-01&to=2026-11-30")).body.checkins.length, 0);
});
test("reminders CRUD with HH:MM times and taken-on date", async () => {
  const r = (await u.post("/reminders", { name: "Triphala at night", time: "21:15" })).body.reminder;
  assert.equal(r.time, "21:15"); assert.equal(r.takenOn, null); assert.equal(r.active, true);
  assert.equal((await u.patch("/reminders/" + r.id, { takenOn: "2026-10-05" })).body.reminder.takenOn, "2026-10-05");
  assert.equal((await u.patch("/reminders/" + r.id, { takenOn: null })).body.reminder.takenOn, null);
  assert.equal((await u.delete("/reminders/" + r.id)).status, 200); assert.equal((await u.delete("/reminders/" + r.id)).status, 404);
});
test("history validation and ordering; profile update (age optional, nullable)", async () => {
  assert.equal((await u.post("/history", { title: "", urgency: "routine" })).status, 400);
  assert.equal((await u.post("/history", { title: "Fever", urgency: "severe" })).status, 400);
  await u.post("/history", { title: "Old", date: "2026-01-01", urgency: "routine" }); await u.post("/history", { title: "New", date: "2026-02-01", urgency: "urgent" });
  assert.deepEqual((await u.get("/history")).body.history.map((h) => h.title), ["New", "Old"]);
  assert.equal((await u.patch("/profile", { age: 40 })).body.profile.age, 40);
  assert.equal((await u.patch("/profile", { age: null })).body.profile.age, null);
  assert.equal((await u.patch("/profile", { age: 500 })).status, 400);
  assert.equal((await u.patch("/profile", { name: "New Name" })).body.profile.name, "New Name");
});
