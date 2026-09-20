"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { inferSchema } = require("../infer");
const {
  sliceContract,
  normalizeSelection,
  parseSchemaPointer,
  MAX_POINTERS,
} = require("../slice");

const SAMPLES = [
  {
    id: 1,
    name: "Alice",
    tags: ["admin", "owner"],
    address: { city: "Shanghai", zip: "200000" },
    phone: null,
  },
  {
    id: 2,
    name: "Bob",
    tags: ["user", 42, null],
    address: { city: "Beijing" },
    phone: "+86-13800000000",
    active: true,
  },
];

function infer() {
  return inferSchema(SAMPLES).schema;
}

test("slice keeps only hit properties and intersects required with surviving fields", () => {
  const schema = infer();
  const result = sliceContract({ schema, samples: SAMPLES, pointers: ["/properties/name"] });
  assert.deepEqual(result.effectivePointers, ["/properties/name"]);
  assert.equal(result.fieldCount, 1);
  assert.equal(result.sampleCount, 2);
  // id was required but is not selected -> dropped from both properties and
  // required; name is present in every sample so it stays required.
  assert.deepEqual(Object.keys(result.schema.properties), ["name"]);
  assert.deepEqual(result.schema.required, ["name"]);
  assert.deepEqual(result.samples, [{ name: "Alice" }, { name: "Bob" }]);
  // Untouched sibling keywords survive on nodes.
  assert.equal(result.schema.$schema, schema.$schema);
});

test("slice drops originally required fields that are not selected", () => {
  // `active` is missing in sample 1 -> optional. Selecting only `active`
  // drops every originally required field (id/name/tags/address/phone).
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: ["/properties/active"],
  });
  assert.deepEqual(Object.keys(result.schema.properties), ["active"]);
  assert.equal(result.schema.required, undefined);
  assert.deepEqual(result.samples, [{}, { active: true }]);
});

test("slice keeps originally required fields that still exist", () => {
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: ["/properties/id", "/properties/active"],
  });
  // id survives as required; active is optional (absent from sample 1) and
  // must not enter required.
  assert.deepEqual(result.schema.required, ["id"]);
  assert.deepEqual(result.samples, [{ id: 1 }, { id: 2, active: true }]);
});

test("slice preserves nested ancestor structure and projects nested objects", () => {
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: ["/properties/address/properties/city"],
  });
  assert.deepEqual(Object.keys(result.schema.properties), ["address"]);
  assert.deepEqual(Object.keys(result.schema.properties.address.properties), ["city"]);
  // address itself is optional (sample two could omit it in general); zip is dropped.
  assert.deepEqual(result.samples, [
    { address: { city: "Shanghai" } },
    { address: { city: "Beijing" } },
  ]);
});

test("slice recurses through array items and projects every element", () => {
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: ["/properties/tags"],
  });
  // Selecting the array node keeps its full subtree, including the items union.
  assert.ok(result.schema.properties.tags.items);
  assert.deepEqual(result.samples[0].tags, ["admin", "owner"]);
  assert.deepEqual(result.samples[1].tags, ["user", 42, null]);
});

test("slice keeps a union type and const untouched", () => {
  const schema = {
    type: "object",
    properties: {
      kind: { type: "string", const: "created" },
      phone: { type: ["null", "string"] },
    },
    required: ["kind", "phone"],
  };
  const samples = [{ kind: "created", phone: null }];
  const result = sliceContract({
    schema,
    samples,
    pointers: ["/properties/kind", "/properties/phone"],
  });
  assert.deepEqual(result.schema.properties.kind, { type: "string", const: "created" });
  assert.deepEqual(result.schema.properties.phone.type, ["null", "string"]);
  assert.deepEqual(result.samples, samples);
});

test("selecting the root keeps the whole schema and samples untouched", () => {
  const schema = infer();
  const result = sliceContract({ schema, samples: SAMPLES, pointers: [""] });
  assert.deepEqual(result.effectivePointers, [""]);
  assert.deepEqual(result.schema, schema);
  assert.deepEqual(result.samples, SAMPLES);
});

test("selecting an ancestor ignores descendant selections", () => {
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: [
      "/properties/address",
      "/properties/address/properties/city",
      "/properties/address/properties/zip",
    ],
  });
  assert.deepEqual(result.effectivePointers, ["/properties/address"]);
  assert.equal(result.fieldCount, 1);
  // The whole address subtree (city + zip) survives.
  assert.deepEqual(
    Object.keys(result.schema.properties.address.properties).sort(),
    ["city", "zip"]
  );
  assert.deepEqual(result.samples[0].address, { city: "Shanghai", zip: "200000" });
});

test("duplicate pointers are de-duplicated", () => {
  const schema = infer();
  const result = sliceContract({
    schema,
    samples: SAMPLES,
    pointers: ["/properties/name", "/properties/name"],
  });
  assert.deepEqual(result.pointers, ["/properties/name"]);
  assert.equal(result.fieldCount, 1);
});

test("normalizeSelection drops only strict descendants", () => {
  assert.deepEqual(
    normalizeSelection(["/properties/a", "/properties/a/properties/b", "/properties/c"]),
    ["/properties/a", "/properties/c"]
  );
  assert.deepEqual(normalizeSelection(["", "/properties/a"]), [""]);
  // Sibling-ish prefixes that are not on a properties/items boundary are
  // still proper descendant strings and therefore dropped too.
  assert.deepEqual(normalizeSelection(["/properties/ab", "/properties/a"]), [
    "/properties/ab",
    "/properties/a",
  ]);
});

test("parseSchemaPointer accepts the root and RFC 6901 escapes", () => {
  assert.deepEqual(parseSchemaPointer(""), []);
  assert.deepEqual(parseSchemaPointer("/properties/a~1b/properties/c~0d"), [
    "properties",
    "a/b",
    "properties",
    "c~d",
  ]);
  assert.equal(parseSchemaPointer("a/b"), null);
  assert.equal(parseSchemaPointer("/a~2b"), null);
  assert.equal(parseSchemaPointer(42), null);
});

test("slice validates every projected sample and refuses on the first failure", () => {
  // Hand-crafted (not inferred) schemas can carry cross-field constraints:
  // `dependentRequired` makes `b` mandatory whenever `a` is present. Slicing
  // to keep only `a` drops `b` from the projection, so sample #0 fails while
  // sample #1 (no `a`) still passes.
  const schema = {
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "string" },
    },
    dependentRequired: { a: ["b"] },
  };
  const samples = [
    { a: "x", b: "y" }, // passes the original schema, breaks the projection
    { b: "z" }, // no `a` -> no dependency triggered
  ];
  let caught;
  try {
    sliceContract({ schema, samples, pointers: ["/properties/a"] });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected the slice to be refused");
  assert.equal(caught.status, 422);
  assert.match(caught.message, /#0/);
  assert.equal(caught.details.failures.length, 1);
  assert.equal(caught.details.failures[0].index, 0);
  assert.equal(caught.details.failures[0].errors[0].keyword, "dependentRequired");
});

test("slice rejects malformed and unresolvable pointers", () => {
  const schema = infer();
  assert.throws(
    () => sliceContract({ schema, samples: SAMPLES, pointers: ["name"] }),
    /非法 JSON Pointer/
  );
  assert.throws(
    () => sliceContract({ schema, samples: SAMPLES, pointers: ["/properties/missing"] }),
    /不存在/
  );
  assert.throws(
    () => sliceContract({ schema, samples: SAMPLES, pointers: ["/properties/id/items"] }),
    /不存在/
  );
});

test("slice validates its input shape", () => {
  const schema = infer();
  assert.throws(
    () => sliceContract({ schema: null, samples: SAMPLES, pointers: [""] }),
    /'schema' object/
  );
  assert.throws(
    () => sliceContract({ schema, samples: [], pointers: [""] }),
    /'samples' array/
  );
  assert.throws(
    () => sliceContract({ schema, samples: SAMPLES, pointers: [] }),
    /'pointers' array/
  );
  assert.throws(
    () => sliceContract({ schema, samples: SAMPLES, pointers: [42] }),
    /JSON Pointer string/
  );
  assert.throws(
    () =>
      sliceContract({
        schema,
        samples: SAMPLES,
        pointers: Array.from({ length: MAX_POINTERS + 1 }, (_, i) => `/p${i}`),
      }),
    new RegExp(String(MAX_POINTERS))
  );
});

test("slice caps the number of samples at 200", () => {
  const schema = { type: "string" };
  assert.throws(
    () =>
      sliceContract({
        schema,
        samples: Array.from({ length: 201 }, () => "x"),
        pointers: [""],
      }),
    /200/
  );
});
