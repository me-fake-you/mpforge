import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVISORY_ENDPOINT,
  auditElectronRuntime,
} from "./check-shipped-runtime.mjs";

const versions = { declaredVersion: "44.2.0", installedVersion: "44.2.0" };
const fixtureFetch = (payload) => async () => ({
  ok: true,
  json: async () => payload,
});

test("audits exact shipped runtime against official npm independently of production graph", async () => {
  let called = false;
  const result = await auditElectronRuntime({
    ...versions,
    fetchImpl: async (url, options) => {
      called = true;
      assert.equal(url, ADVISORY_ENDPOINT);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { electron: ["44.2.0"] });
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(called, true);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.ignored_advisories, []);
});

test("rejects high and critical runtime advisories without exclusions", async () => {
  const result = await auditElectronRuntime({
    ...versions,
    fetchImpl: fixtureFetch({
      electron: [
        {
          id: 1,
          severity: "high",
          title: "Fixture high",
          url: "https://github.com/advisories/fixture-high",
        },
        {
          id: 2,
          severity: "critical",
          title: "Fixture critical",
          url: "https://github.com/advisories/fixture-critical",
        },
      ],
    }),
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.vulnerabilities.high, 1);
  assert.equal(result.vulnerabilities.critical, 1);
});

test("keeps moderate findings visible at the high threshold", async () => {
  const result = await auditElectronRuntime({
    ...versions,
    fetchImpl: fixtureFetch({
      electron: [
        {
          severity: "moderate",
          title: "Fixture moderate",
          url: "https://github.com/advisories/fixture-moderate",
        },
      ],
    }),
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.vulnerabilities.moderate, 1);
});

test("rejects version drift or ranges before making a request", async () => {
  const fetchImpl = () => {
    throw new Error("Must not call network");
  };
  await assert.rejects(
    auditElectronRuntime({
      ...versions,
      declaredVersion: "^44.2.0",
      fetchImpl,
    }),
    /exact stable/,
  );
  await assert.rejects(
    auditElectronRuntime({
      ...versions,
      installedVersion: "28.3.3",
      fetchImpl,
    }),
    /does not match/,
  );
});

test("fails closed for network errors, non-success status and malformed responses", async () => {
  await assert.rejects(
    auditElectronRuntime({
      ...versions,
      fetchImpl: async () => {
        throw new Error("Offline");
      },
    }),
    /Offline/,
  );
  await assert.rejects(
    auditElectronRuntime({
      ...versions,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /503/,
  );
  for (const payload of [
    null,
    [],
    { other: [] },
    { electron: {} },
    { electron: null },
    { electron: [{ severity: "unknown" }] },
  ]) {
    await assert.rejects(
      auditElectronRuntime({ ...versions, fetchImpl: fixtureFetch(payload) }),
    );
  }
});
