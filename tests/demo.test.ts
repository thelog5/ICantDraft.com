import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { demoResponse, loadDemoSnapshot } from "../apps/web/src/lib/demo";
const snapshot = JSON.parse(
  readFileSync(
    new URL("../apps/web/public/demo/snapshot.json", import.meta.url),
    "utf8",
  ),
);
let fetches = 0;
Object.assign(globalThis, {
  window: { location: { origin: "http://localhost:5173" } },
  fetch: async (url: string) => {
    assert.equal(url, "/demo/snapshot.json");
    fetches++;
    return { ok: true, json: async () => snapshot };
  },
});
const root = `/leagues/${snapshot.info.leagueId}`;
test("demo loads once and serves all captured views without backend requests", async () => {
  await Promise.all([loadDemoSnapshot(), loadDemoSnapshot()]);
  for (const path of Object.keys(snapshot.responses))
    assert.ok(await demoResponse(path));
  assert.equal(fetches, 1);
});
test("trade filters respect size, grade, and untouchables", async () => {
  const path = `${root}/teams/${snapshot.info.teamId}/trade-suggestions`;
  const result: any = await demoResponse(
    path + "?tradeSize=1for1&minOppGrade=B",
  );
  assert.ok(
    result.suggestions.every(
      (s: any) =>
        s.trade.type === "1for1" &&
        ["B", "B+", "A-", "A", "A+"].includes(s.impact.opp.grade),
    ),
  );
  const id = result.suggestions[0]?.trade.send[0].playerId;
  if (id) {
    const filtered: any = await demoResponse(path + "?untouchables=" + id);
    assert.ok(
      filtered.suggestions.every((s: any) =>
        s.trade.send.every((p: any) => p.playerId !== id),
      ),
    );
  }
});
test("streaming impact computes net counting stats without inventing attempts", async () => {
  const overview =
    snapshot.responses[
      `${root}/streaming/overview?teamId=${snapshot.info.teamId}`
    ];
  const add = overview.freeAgents[0],
    drop = overview.roster[0];
  const result: any = await demoResponse(root + "/streaming/impact", {
    body: JSON.stringify({
      addPlayerId: add.playerId,
      dropPlayerId: drop.playerId,
    }),
  });
  assert.ok(
    Math.abs(
      result.deltas.pts - (add.projectedTotals.pts - drop.projectedTotals.pts),
    ) < 1e-8,
  );
  assert.equal(result.deltas.fgPct, 0);
  assert.ok(result.message);
});
