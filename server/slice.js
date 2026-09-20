"use strict";

/**
 * Contract slicing.
 *
 * The user checks 1..MAX_POINTERS nodes of the existing Schema tree, each
 * addressed by a schema JSON Pointer ("" is the root; "/properties/<key>"
 * and "/items" descend into object properties and array items). The slice:
 *
 *   - keeps every checked node together with the necessary ancestor chain;
 *   - when an ancestor is checked, its descendants are redundant and ignored;
 *   - at an object, only the hit `properties` survive and `required` keeps
 *     exactly the fields that were originally required AND still present;
 *   - arrays recurse through `items`;
 *   - type unions and `const` (and every other keyword) are copied untouched.
 *
 * The current sample set is projected in parallel: each instance keeps only
 * the values at locations that survive in the sliced schema.
 *
 * Every projected sample is validated with Ajv against the sliced schema.
 * If a single projection fails validation, no slice is produced: the call
 * is refused (422) and the failing sample indexes together with the Ajv
 * errors are returned.
 */

const Ajv2020 = require("ajv/dist/2020").default;

const MAX_POINTERS = 20;
const MAX_SAMPLES = 200;

const ajv = new Ajv2020({ allErrors: true, strict: false });

const POINTER_HINT =
  'Pointer 须为空串（根节点）或以 "/" 开头，"~" 仅允许写作 ~0（表示 ~）或 ~1（表示 /），路径段须与 Schema 树一致（/properties/<字段名>、/items）';

function isObjectSchema(node) {
  return !!node && typeof node === "object" && !Array.isArray(node);
}

function typeList(schema) {
  if (!isObjectSchema(schema) || schema.type === undefined) return null;
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

/**
 * Parse a schema JSON Pointer into unescaped segments ("" root -> []).
 * Returns null when the pointer is malformed: not empty / not starting
 * with "/" or carrying an illegal "~" escape.
 */
function parseSchemaPointer(pointer) {
  if (typeof pointer !== "string") return null;
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  const segments = [];
  for (const raw of pointer.slice(1).split("/")) {
    let segment = "";
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch !== "~") {
        segment += ch;
        continue;
      }
      const next = raw[i + 1];
      if (next === "0") segment += "~";
      else if (next === "1") segment += "/";
      else return null;
      i += 1;
    }
    segments.push(segment);
  }
  return segments;
}

/** Walk one schema node following `properties` / `items` segments. */
function resolveSchemaNode(root, segments) {
  let node = root;
  for (const seg of segments) {
    if (seg === "properties") continue;
    if (!isObjectSchema(node)) return null;
    node = seg === "items" ? node.items || null : node.properties ? node.properties[seg] : null;
  }
  return node ?? null;
}

function isAncestor(ancestor, descendant) {
  if (ancestor === descendant) return false;
  if (ancestor === "") return true; // the root Pointer is an ancestor of everything
  return descendant.startsWith(`${ancestor}/`);
}

/** Drop pointers that are descendants of another selected pointer. */
function normalizeSelection(pointers) {
  return pointers.filter((p) => !pointers.some((other) => isAncestor(other, p)));
}

function selectedAt(selected, pointer) {
  return selected.has(pointer);
}

/**
 * Whether the subtree rooted at `pointer` contains any selection: the node
 * itself or a descendant. Selected pointers only ever travel through
 * `properties` / `items` chains, so a prefix test is sufficient.
 */
function hitsWithin(selected, pointer) {
  for (const p of selected) {
    if (p === pointer) return true;
    if (pointer === "" ? p !== "" : p.startsWith(`${pointer}/`)) return true;
  }
  return false;
}

/**
 * Recursively build the sliced schema.
 *
 * @param {object} node original schema node
 * @param {string} pointer JSON Pointer of `node` inside the schema
 * @param {Set<string>} selected normalized selection
 * @returns {object} sliced node
 */
function sliceNode(node, pointer, selected) {
  if (selectedAt(selected, pointer)) {
    // An explicitly selected node keeps its whole subtree untouched.
    return JSON.parse(JSON.stringify(node));
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "required" || key === "items") continue;
    out[key] = JSON.parse(JSON.stringify(value));
  }

  const types = typeList(node);
  const hasObject = types === null || types.includes("object");
  const hasArray = types === null || types.includes("array");

  let keptProps = null;
  if (hasObject && isObjectSchema(node.properties)) {
    keptProps = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const childPointer = `${pointer}/properties/${key
        .replace(/~/g, "~0")
        .replace(/\//g, "~1")}`;
      if (hitsWithin(selected, childPointer)) {
        keptProps[key] = sliceNode(child, childPointer, selected);
      }
    }
    if (Object.keys(keptProps).length === 0) keptProps = null;
  }

  let keptItems = null;
  if (hasArray && isObjectSchema(node.items)) {
    const itemsPointer = `${pointer}/items`;
    if (hitsWithin(selected, itemsPointer)) {
      keptItems = sliceNode(node.items, itemsPointer, selected);
    }
  }

  // Rebuild the node with a stable key order: non-structural keywords first,
  // then properties, required, items — never leaking the original `required`.
  const result = { ...out };
  if (keptProps) {
    result.properties = keptProps;
    if (Array.isArray(node.required)) {
      const keptRequired = node.required.filter((key) =>
        Object.prototype.hasOwnProperty.call(keptProps, key)
      );
      if (keptRequired.length > 0) result.required = keptRequired;
    }
  }
  if (keptItems) result.items = keptItems;
  return result;
}

/**
 * Project one sample in parallel with the sliced schema.
 *
 * @param {any} value original sample value at this position
 * @param {object} node sliced schema node at this position
 * @returns {any} projected value
 */
function projectNode(value, node) {
  // Arrays recurse through `items` whenever the instance is an array.
  if (Array.isArray(value) && isObjectSchema(node) && isObjectSchema(node.items)) {
    return value.map((item) => projectNode(item, node.items));
  }
  if (Array.isArray(value)) {
    // No surviving items constraint: elements are not modelled, drop them.
    return [];
  }
  // Objects keep exactly the surviving modelled properties.
  if (
    value !== null &&
    typeof value === "object" &&
    isObjectSchema(node) &&
    isObjectSchema(node.properties)
  ) {
    const out = {};
    for (const [key, childSchema] of Object.entries(node.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        out[key] = projectNode(value[key], childSchema);
      }
    }
    return out;
  }
  // Scalars (and values at nodes without an object/items shape) stay as-is.
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mapErrors(validate) {
  return (validate.errors || []).map((e) => ({
    path: e.instancePath || "",
    pointer: e.instancePath || "(root)",
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message,
    params: e.params,
  }));
}

/**
 * Build a contract slice and project the samples.
 *
 * @returns {{ pointers: string[], effectivePointers: string[],
 *            fieldCount: number, sampleCount: number,
 *            schema: object, samples: any[] }}
 */
function sliceContract({ schema, samples, pointers }) {
  if (!isObjectSchema(schema)) {
    throw Object.assign(new Error("Request body must contain a 'schema' object."), {
      status: 400,
    });
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Object.assign(new Error("Request body must contain a non-empty 'samples' array."), {
      status: 400,
    });
  }
  if (samples.length > MAX_SAMPLES) {
    throw Object.assign(
      new Error(
        `Too many samples: got ${samples.length}, at most ${MAX_SAMPLES} allowed per slice.`
      ),
      { status: 400 }
    );
  }
  if (!Array.isArray(pointers) || pointers.length === 0) {
    throw Object.assign(
      new Error("Request body must contain a non-empty 'pointers' array (1..20 schema Pointers)."),
      { status: 400 }
    );
  }
  if (pointers.length > MAX_POINTERS) {
    throw Object.assign(
      new Error(`Too many pointers: got ${pointers.length}, at most ${MAX_POINTERS} allowed.`),
      { status: 400 }
    );
  }
  for (const pointer of pointers) {
    if (typeof pointer !== "string") {
      throw Object.assign(new Error("Every entry in 'pointers' must be a JSON Pointer string."), {
        status: 400,
      });
    }
  }

  // Parse every pointer and make sure it resolves to an existing schema node.
  const parsed = pointers.map((pointer) => ({ pointer, segments: parseSchemaPointer(pointer) }));
  for (const { pointer, segments } of parsed) {
    if (segments === null) {
      throw Object.assign(
        new Error(`非法 JSON Pointer：${JSON.stringify(pointer)}。${POINTER_HINT}。`),
        { status: 400 }
      );
    }
    const node = resolveSchemaNode(schema, segments);
    if (node === null) {
      throw Object.assign(
        new Error(`Pointer 在 Schema 中不存在：${JSON.stringify(pointer)}。`),
        { status: 400 }
      );
    }
  }

  const effectivePointers = normalizeSelection([...new Set(pointers)]);
  const selected = new Set(effectivePointers);

  let sliced;
  try {
    sliced = sliceNode(schema, "", selected);
  } catch (err) {
    throw Object.assign(new Error(`Schema 切片失败：${err.message}`), { status: 422 });
  }

  const projectedSamples = samples.map((sample) => projectNode(sample, sliced));

  let validate;
  try {
    validate = ajv.compile(sliced);
  } catch (err) {
    throw Object.assign(new Error(`Invalid schema: ${err.message}`), { status: 422 });
  }

  const failures = [];
  projectedSamples.forEach((sample, index) => {
    const valid = validate(sample);
    if (!valid) {
      failures.push({ index, errors: mapErrors(validate) });
    }
  });

  if (failures.length > 0) {
    throw Object.assign(
      new Error(
        `${failures.length} 条投影样本未通过切片 Schema 校验，未产出切片（样本索引：${failures
          .map((f) => `#${f.index}`)
          .join("、")}）。`
      ),
      { status: 422, details: { failures } }
    );
  }

  return {
    pointers: [...new Set(pointers)],
    effectivePointers,
    fieldCount: effectivePointers.length,
    sampleCount: samples.length,
    schema: sliced,
    samples: projectedSamples,
  };
}

module.exports = {
  sliceContract,
  normalizeSelection,
  parseSchemaPointer,
  MAX_POINTERS,
  MAX_SAMPLES,
  POINTER_HINT,
};
