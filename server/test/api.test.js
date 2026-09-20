"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../app");

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function post(pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("GET /api/health", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("POST /api/infer returns schema, paths and count", async () => {
  const { status, data } = await post("/api/infer", {
    samples: [{ id: 1, tag: "x" }, { id: 2 }],
  });
  assert.equal(status, 200);
  assert.equal(data.sampleCount, 2);
  assert.equal(data.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(data.schema.required, ["id"]);
  assert.equal(typeof data.paths, "object");
});

test("POST /api/infer rejects missing samples", async () => {
  const { status, data } = await post("/api/infer", { samples: [] });
  assert.equal(status, 400);
  assert.match(data.error, /samples/);
});

test("POST /api/validate reports JSON Pointers for errors", async () => {
  const { data: inferred } = await post("/api/infer", {
    samples: [{ id: 1, user: { name: "a" } }],
  });
  const ok = await post("/api/validate", {
    schema: inferred.schema,
    sample: { id: 2, user: { name: "b" } },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.valid, true);
  assert.deepEqual(ok.data.errors, []);

  const bad = await post("/api/validate", {
    schema: inferred.schema,
    sample: { id: "oops", user: {} },
  });
  assert.equal(bad.data.valid, false);
  const paths = bad.data.errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ["/id", "/user"]);
  const idErr = bad.data.errors.find((e) => e.path === "/id");
  assert.equal(idErr.keyword, "type");
  assert.equal(idErr.pointer, "/id");
});

test("POST /api/validate rejects an invalid schema", async () => {
  const { status, data } = await post("/api/validate", {
    schema: { type: "not-a-type" },
    sample: 1,
  });
  assert.equal(status, 422);
  assert.match(data.error, /Invalid schema/);
});

test("POST /api/diff classifies changes per perspective", async () => {
  const oldS = (
    await post("/api/infer", { samples: [{ id: 1, name: "a" }] })
  ).data.schema;
  const newS = (await post("/api/infer", { samples: [{ id: 1 }] })).data.schema;

  const res = await post("/api/diff", { oldSchema: oldS, newSchema: newS, perspective: "response" });
  assert.equal(res.status, 200);
  assert.equal(res.data.perspective, "response");
  const removed = res.data.changes.find((c) => c.kind === "property-removed");
  assert.equal(removed.pointer, "/properties/name");
  assert.equal(removed.severity, "breaking");
  assert.equal(res.data.summary.breaking, 1);
  assert.ok(removed.oldRule && removed.newRule && removed.reason);

  const req = await post("/api/diff", { oldSchema: oldS, newSchema: newS, perspective: "request" });
  assert.equal(req.data.changes.find((c) => c.kind === "property-removed").severity, "info");
  assert.equal(req.data.summary.breaking, 0);
});

test("POST /api/diff defaults to the request perspective", async () => {
  const { status, data } = await post("/api/diff", { oldSchema: {}, newSchema: {} });
  assert.equal(status, 200);
  assert.equal(data.perspective, "request");
  assert.deepEqual(data.changes, []);
  assert.deepEqual(data.summary, { breaking: 0, compatible: 0, info: 0 });
});

test("POST /api/diff validates its input", async () => {
  const missing = await post("/api/diff", { oldSchema: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /newSchema/);

  const badPerspective = await post("/api/diff", {
    oldSchema: {},
    newSchema: {},
    perspective: "sideways",
  });
  assert.equal(badPerspective.status, 400);
  assert.match(badPerspective.data.error, /perspective/);
});

test("POST /api/counterexample builds a request witness verified on both sides", async () => {
  const oldS = (
    await post("/api/infer", { samples: [{ id: 1, phone: null }, { id: 2, phone: "x" }] })
  ).data.schema;
  const newS = (await post("/api/infer", { samples: [{ id: 1, phone: "x" }] })).data.schema;

  const res = await post("/api/counterexample", {
    oldSchema: oldS,
    newSchema: newS,
    perspective: "request",
    kind: "type",
    pointer: "/properties/phone",
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.constructible, true);
  assert.equal(res.data.perspective, "request");
  assert.deepEqual(res.data.sample, { id: 0, phone: null });
  assert.equal(res.data.oldResult.valid, true);
  assert.deepEqual(res.data.oldResult.errors, []);
  assert.equal(res.data.newResult.valid, false);
  assert.ok(res.data.newResult.errors.length > 0);
  assert.equal(res.data.newResult.errors[0].pointer, "/phone");
});

test("POST /api/counterexample covers response direction and items changes", async () => {
  const oldS = (await post("/api/infer", { samples: [{ xs: [1] }] })).data.schema;
  const newS = (await post("/api/infer", { samples: [{ xs: [] }] })).data.schema;
  const res = await post("/api/counterexample", {
    oldSchema: oldS,
    newSchema: newS,
    perspective: "response",
    kind: "items-removed",
    pointer: "/properties/xs/items",
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.constructible, true);
  assert.equal(res.data.newResult.valid, true);
  assert.equal(res.data.oldResult.valid, false);
  assert.equal(res.data.oldResult.errors[0].path, "/xs/0");
});

test("POST /api/counterexample returns a reason when no witness exists", async () => {
  const oldS = {
    type: "object",
    properties: { phone: { type: ["null", "string"], enum: ["x"] } },
    required: ["phone"],
  };
  const newS = {
    type: "object",
    properties: { phone: { type: "string", enum: ["x"] } },
    required: ["phone"],
  };
  const res = await post("/api/counterexample", {
    oldSchema: oldS,
    newSchema: newS,
    perspective: "request",
    kind: "type",
    pointer: "/properties/phone",
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.constructible, false);
  assert.ok(typeof res.data.reason === "string" && res.data.reason.length > 0);
  assert.equal(res.data.sample, undefined);
});

test("POST /api/counterexample validates its input", async () => {
  const missingSchema = await post("/api/counterexample", { oldSchema: {} });
  assert.equal(missingSchema.status, 400);
  assert.match(missingSchema.data.error, /newSchema/);

  const badPerspective = await post("/api/counterexample", {
    oldSchema: {},
    newSchema: {},
    perspective: "nope",
    kind: "type",
    pointer: "",
  });
  assert.equal(badPerspective.status, 400);
  assert.match(badPerspective.data.error, /perspective/);

  const missingKind = await post("/api/counterexample", {
    oldSchema: {},
    newSchema: {},
    pointer: "",
  });
  assert.equal(missingKind.status, 400);
  assert.match(missingKind.data.error, /kind/);

  const badPointer = await post("/api/counterexample", {
    oldSchema: {},
    newSchema: {},
    kind: "type",
    pointer: "bad",
  });
  assert.equal(badPointer.status, 400);
  assert.match(badPointer.data.error, /JSON Pointer/);

  const badKind = await post("/api/counterexample", {
    oldSchema: {},
    newSchema: {},
    kind: "nope",
    pointer: "",
  });
  assert.equal(badKind.status, 400);
  assert.match(badKind.data.error, /暂不支持/);
});

test("POST /api/counterexample rejects an invalid schema with 422", async () => {
  const res = await post("/api/counterexample", {
    oldSchema: { type: "not-a-type" },
    newSchema: {},
    kind: "type",
    pointer: "",
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Invalid schema/);
});

test("POST /api/scan classifies historical samples against both versions", async () => {
  const oldS = (
    await post("/api/infer", { samples: [{ id: 1, phone: null }, { id: 2, phone: "x" }] })
  ).data.schema;
  const newS = (await post("/api/infer", { samples: [{ id: 1, phone: "x" }] })).data.schema;

  const res = await post("/api/scan", {
    oldSchema: oldS,
    newSchema: newS,
    samples: [
      { id: 1, phone: "a" }, // passes both
      { id: 2, phone: null }, // baseline only: null no longer accepted
      { id: 3 }, // neither: phone is required in both versions
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 3);
  assert.deepEqual(res.data.summary, { both: 1, baselineOnly: 1, currentOnly: 0, neither: 1 });
  assert.deepEqual(
    res.data.samples.map((s) => s.category),
    ["both", "baselineOnly", "neither"]
  );
  const broken = res.data.samples[1];
  assert.equal(broken.index, 1);
  assert.equal(broken.baseline.valid, true);
  assert.deepEqual(broken.baseline.errors, []);
  assert.equal(broken.current.valid, false);
  assert.equal(broken.current.errors[0].pointer, "/phone");
  assert.equal(broken.current.errors[0].keyword, "type");
  assert.ok(broken.current.errors[0].message);
});

test("POST /api/scan detects samples only the current schema accepts", async () => {
  const oldS = (await post("/api/infer", { samples: [{ id: 1 }] })).data.schema;
  const newS = (await post("/api/infer", { samples: [{ id: 1 }, { id: 1.5 }] })).data.schema;
  const res = await post("/api/scan", {
    oldSchema: oldS,
    newSchema: newS,
    samples: [{ id: 1.5 }],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.summary, { both: 0, baselineOnly: 0, currentOnly: 1, neither: 0 });
  assert.equal(res.data.samples[0].category, "currentOnly");
  assert.equal(res.data.samples[0].baseline.valid, false);
  assert.equal(res.data.samples[0].current.valid, true);
});

test("POST /api/scan accepts an empty sample set", async () => {
  const res = await post("/api/scan", { oldSchema: {}, newSchema: {}, samples: [] });
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 0);
  assert.deepEqual(res.data.summary, { both: 0, baselineOnly: 0, currentOnly: 0, neither: 0 });
  assert.deepEqual(res.data.samples, []);
});

test("POST /api/scan rejects non-array input and more than 200 samples", async () => {
  const notArray = await post("/api/scan", { oldSchema: {}, newSchema: {}, samples: { 0: 1 } });
  assert.equal(notArray.status, 400);
  assert.match(notArray.data.error, /'samples' array/);

  const missing = await post("/api/scan", { oldSchema: {}, newSchema: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /'samples' array/);

  const tooMany = await post("/api/scan", {
    oldSchema: {},
    newSchema: {},
    samples: Array.from({ length: 201 }, () => 1),
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /200/);

  const atLimit = await post("/api/scan", {
    oldSchema: {},
    newSchema: {},
    samples: Array.from({ length: 200 }, () => 1),
  });
  assert.equal(atLimit.status, 200);
  assert.equal(atLimit.data.total, 200);
});

test("POST /api/scan validates its schemas", async () => {
  const missingSchema = await post("/api/scan", { samples: [] });
  assert.equal(missingSchema.status, 400);
  assert.match(missingSchema.data.error, /oldSchema/);

  const invalid = await post("/api/scan", {
    oldSchema: { type: "not-a-type" },
    newSchema: {},
    samples: [1],
  });
  assert.equal(invalid.status, 422);
  assert.match(invalid.data.error, /Invalid schema/);
});

test("POST /api/contribution classifies samples via leave-one-out inference", async () => {
  const res = await post("/api/contribution", {
    samples: [{ id: 1, tag: "x" }, { id: 2, tag: "y" }, { id: 3 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 3);
  assert.deepEqual(res.data.summary, { critical: 1, redundant: 2 });
  assert.deepEqual(
    res.data.samples.map((s) => [s.index, s.verdict]),
    [
      [0, "redundant"],
      [1, "redundant"],
      [2, "critical"],
    ]
  );
  // Without sample #2, "tag" is present in every remaining object -> required.
  assert.deepEqual(res.data.samples[2].affectedPointers, ["/properties/tag"]);
  assert.deepEqual(res.data.samples[0].affectedPointers, []);
});

test("POST /api/contribution validates its input", async () => {
  const missing = await post("/api/contribution", {});
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /'samples' array/);

  const notArray = await post("/api/contribution", { samples: { 0: 1 } });
  assert.equal(notArray.status, 400);
  assert.match(notArray.data.error, /'samples' array/);

  const empty = await post("/api/contribution", { samples: [] });
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /'samples' array/);

  const tooMany = await post("/api/contribution", {
    samples: Array.from({ length: 51 }, () => 1),
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /50/);

  const atLimit = await post("/api/contribution", {
    samples: Array.from({ length: 50 }, (_, i) => ({ id: i })),
  });
  assert.equal(atLimit.status, 200);
  assert.equal(atLimit.data.total, 50);
});

test("POST /api/anonymize replaces matched scalars with stable typed pseudonyms", async () => {
  const { status, data } = await post("/api/anonymize", {
    samples: [
      { id: 1, email: "a@x.com", tags: ["x", "y"] },
      { id: 2, email: "a@x.com", tags: ["x"] },
    ],
    rules: ["/email", "/tags/*"],
  });
  assert.equal(status, 200);
  assert.equal(data.totalSamples, 2);
  const [emailRule, tagsRule] = data.rules;
  assert.equal(emailRule.status, "ok");
  assert.equal(emailRule.hits, 2);
  assert.deepEqual(emailRule.paths, ["#/0/email", "#/1/email"]);
  assert.equal(tagsRule.hits, 3);
  // Stable across samples, actually replaced, type preserved.
  assert.equal(data.samples[0].email, data.samples[1].email);
  assert.notEqual(data.samples[0].email, "a@x.com");
  assert.equal(typeof data.samples[0].email, "string");
  assert.notEqual(data.samples[0].tags[0], "x");
  assert.equal(data.samples[0].id, 1); // untouched
});

test("POST /api/anonymize refuses illegal pointers, non-scalar hits and conflicts with 422 + rule stats", async () => {
  const illegal = await post("/api/anonymize", { samples: [{ a: 1 }], rules: ["a"] });
  assert.equal(illegal.status, 422);
  assert.equal(illegal.data.rules[0].status, "invalid");
  assert.match(illegal.data.error, /规则 1/);
  assert.equal(illegal.data.samples, undefined);

  const nonScalar = await post("/api/anonymize", {
    samples: [{ a: { b: 1 } }],
    rules: ["/a"],
  });
  assert.equal(nonScalar.status, 422);
  assert.equal(nonScalar.data.rules[0].status, "non-scalar");
  assert.match(nonScalar.data.rules[0].error, /对象/);

  const conflict = await post("/api/anonymize", {
    samples: [{ a: { b: 1 } }],
    rules: ["/a/*", "/a/b"],
  });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.data.rules[0].status, "conflict");
  assert.equal(conflict.data.rules[1].status, "conflict");
  assert.equal(conflict.data.samples, undefined);
});

test("POST /api/anonymize validates its input", async () => {
  const noSamples = await post("/api/anonymize", { rules: ["/a"] });
  assert.equal(noSamples.status, 400);
  assert.match(noSamples.data.error, /'samples' array/);

  const noRules = await post("/api/anonymize", { samples: [{ a: 1 }], rules: [] });
  assert.equal(noRules.status, 400);
  assert.match(noRules.data.error, /'rules' array/);

  const badRule = await post("/api/anonymize", { samples: [{ a: 1 }], rules: [42] });
  assert.equal(badRule.status, 400);
  assert.match(badRule.data.error, /JSON Pointer string/);

  const tooMany = await post("/api/anonymize", {
    samples: Array.from({ length: 201 }, () => ({})),
    rules: ["/a"],
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /200/);
});

test("POST /api/slice projects the schema and samples and Ajv-verifies them", async () => {
  const { data: inferred } = await post("/api/infer", {
    samples: [
      { id: 1, name: "Alice", address: { city: "Shanghai", zip: "200000" } },
      { id: 2, address: { city: "Beijing" } },
    ],
  });
  const res = await post("/api/slice", {
    schema: inferred.schema,
    samples: [
      { id: 1, name: "Alice", address: { city: "Shanghai", zip: "200000" } },
      { id: 2, address: { city: "Beijing" } },
    ],
    pointers: ["/properties/address/properties/city"],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.effectivePointers, ["/properties/address/properties/city"]);
  assert.equal(res.data.fieldCount, 1);
  assert.equal(res.data.sampleCount, 2);
  assert.deepEqual(Object.keys(res.data.schema.properties), ["address"]);
  assert.deepEqual(Object.keys(res.data.schema.properties.address.properties), ["city"]);
  assert.deepEqual(res.data.schema.properties.address.required, ["city"]);
  assert.deepEqual(res.data.samples, [
    { address: { city: "Shanghai" } },
    { address: { city: "Beijing" } },
  ]);
});

test("POST /api/slice ignores descendants of a selected ancestor", async () => {
  const { data: inferred } = await post("/api/infer", {
    samples: [
      { id: 1, tags: ["a"], phone: null },
      { id: 2, tags: [2], phone: "x" },
    ],
  });
  const res = await post("/api/slice", {
    schema: inferred.schema,
    samples: [
      { id: 1, tags: ["a"], phone: null },
      { id: 2, tags: [2], phone: "x" },
    ],
    pointers: ["/properties/tags", "/properties/tags/items"],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.effectivePointers, ["/properties/tags"]);
  assert.ok(res.data.schema.properties.tags.items);
  assert.deepEqual(res.data.samples, [
    { tags: ["a"] },
    { tags: [2] },
  ]);
});

test("POST /api/slice keeps root selection and leaves samples unchanged", async () => {
  const samples = [{ id: 1, phone: null }];
  const { data: inferred } = await post("/api/infer", { samples });
  const res = await post("/api/slice", {
    schema: inferred.schema,
    samples,
    pointers: [""],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.schema, inferred.schema);
  assert.deepEqual(res.data.samples, samples);
});

test("POST /api/slice refuses with 422 when a projected sample fails Ajv", async () => {
  const res = await post("/api/slice", {
    schema: {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      dependentRequired: { a: ["b"] },
    },
    samples: [{ a: "x", b: "y" }],
    pointers: ["/properties/a"],
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /#0/);
  assert.equal(res.data.failures.length, 1);
  assert.equal(res.data.failures[0].index, 0);
  assert.equal(res.data.failures[0].errors[0].keyword, "dependentRequired");
  assert.equal(res.data.schema, undefined);
  assert.equal(res.data.samples, undefined);
});

test("POST /api/slice validates its input", async () => {
  const missingSchema = await post("/api/slice", { samples: [1], pointers: [""] });
  assert.equal(missingSchema.status, 400);
  assert.match(missingSchema.data.error, /'schema' object/);

  const noSamples = await post("/api/slice", { schema: {}, pointers: [""] });
  assert.equal(noSamples.status, 400);
  assert.match(noSamples.data.error, /'samples' array/);

  const noPointers = await post("/api/slice", { schema: {}, samples: [1], pointers: [] });
  assert.equal(noPointers.status, 400);
  assert.match(noPointers.data.error, /'pointers' array/);

  const badPointer = await post("/api/slice", { schema: {}, samples: [1], pointers: ["x"] });
  assert.equal(badPointer.status, 400);
  assert.match(badPointer.data.error, /非法 JSON Pointer/);

  const notFound = await post("/api/slice", {
    schema: { type: "object", properties: { a: { type: "string" } } },
    samples: [{ a: "x" }],
    pointers: ["/properties/missing"],
  });
  assert.equal(notFound.status, 400);
  assert.match(notFound.data.error, /不存在/);

  const tooMany = await post("/api/slice", {
    schema: {},
    samples: [1],
    pointers: Array.from({ length: 21 }, (_, i) => `/p${i}`),
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /20/);
});

test("malformed JSON body gets a JSON 400", async () => {
  const res = await fetch(`${base}/api/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("unknown API route returns JSON 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error);
});
