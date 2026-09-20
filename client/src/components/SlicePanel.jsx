import { useMemo, useState } from "react";
import { sliceContract } from "../api.js";

// Keep in sync with MAX_POINTERS in server/slice.js.
const MAX_POINTERS = 20;

function typeList(schema) {
  if (!schema || schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function escapeSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

function isAncestor(ancestor, descendant) {
  if (ancestor === descendant) return false;
  if (ancestor === "") return true;
  return descendant.startsWith(`${ancestor}/`);
}

/** Drop selections made redundant by a selected ancestor. */
function normalizePointers(pointers) {
  return pointers.filter((p) => !pointers.some((other) => isAncestor(other, p)));
}

function TypeBadges({ types }) {
  return (
    <span className="type-badges">
      {types.map((t) => (
        <span key={t} className={`type-badge type-badge--${t}`}>
          {t}
        </span>
      ))}
    </span>
  );
}

function SliceCheckNode({
  name,
  schema,
  pointer,
  depth,
  selected,
  covered,
  atLimit,
  onToggle,
}) {
  const [open, setOpen] = useState(depth < 2);
  const types = typeList(schema);
  const hasObject = types.includes("object");
  const hasArray = types.includes("array");
  const properties = hasObject && schema.properties ? Object.entries(schema.properties) : [];
  const hasItems = hasArray && schema.items;
  const hasChildren = properties.length > 0 || hasItems;

  const isChecked = selected.includes(pointer);
  // A selected ancestor already pulls this whole subtree into the slice.
  const disabled = (covered && !isChecked) || (!isChecked && atLimit && !covered);

  return (
    <div className="slice-node">
      <div className="slice-node__row">
        <button
          type="button"
          className={`tree-toggle ${hasChildren ? "" : "tree-toggle--leaf"}`}
          onClick={() => hasChildren && setOpen(!open)}
          aria-label={open ? "折叠" : "展开"}
          tabIndex={-1}
        >
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <label className="slice-check" title={pointer === "" ? "(root)" : pointer}>
          <input
            type="checkbox"
            checked={isChecked || covered}
            disabled={disabled}
            onChange={() => onToggle(pointer)}
          />
          <span className="schema-node__name">{name}</span>
        </label>
        <TypeBadges types={types} />
        {schema.const !== undefined && (
          <span className="flag flag--const">const {JSON.stringify(schema.const)}</span>
        )}
        {covered && !isChecked && <span className="flag flag--slice-covered">已随祖先包含</span>}
      </div>

      {open && hasChildren && (
        <div className="schema-node__children">
          {properties.map(([key, child]) => (
            <SliceCheckNode
              key={key}
              name={key}
              schema={child}
              pointer={`${pointer}/properties/${escapeSegment(key)}`}
              depth={depth + 1}
              selected={selected}
              covered={covered || isChecked}
              atLimit={atLimit}
              onToggle={onToggle}
            />
          ))}
          {hasItems && (
            <SliceCheckNode
              name="[items]"
              schema={schema.items}
              pointer={`${pointer}/items`}
              depth={depth + 1}
              selected={selected}
              covered={covered || isChecked}
              atLimit={atLimit}
              onToggle={onToggle}
            />
          )}
        </div>
      )}
    </div>
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/**
 * Contract slice: the user checks 1..20 schema-tree nodes; the backend keeps
 * the checked nodes plus the necessary ancestor chain, projects the current
 * samples in parallel and Ajv-verifies every projected sample. The result
 * shows the field/sample counts and offers separate copy buttons for the
 * sliced schema and the projected samples. Any change to the selection or
 * to the samples invalidates the displayed result immediately.
 */
export default function SlicePanel({ schema, samples, allValid, signature }) {
  const [picked, setPicked] = useState([]); // raw checkbox state (schema Pointers)
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { signature, ok, data, message?, data? }
  const [copied, setCopied] = useState(null); // "schema" | "samples"
  const [showSchema, setShowSchema] = useState(false);
  const [showSamples, setShowSamples] = useState(false);

  const selected = useMemo(() => normalizePointers(picked), [picked]);
  const fieldCount = selected.length;
  const atLimit = fieldCount >= MAX_POINTERS;

  const schemaSignature = schema ? JSON.stringify(schema) : "";
  const runSignature = JSON.stringify([picked, signature, schemaSignature]);
  const current = outcome && outcome.signature === runSignature ? outcome : null;
  const invalidated = outcome !== null && outcome.signature !== runSignature;

  const data = current && current.ok ? current.data : null;
  const failure = current && !current.ok ? current : null;
  const failedSamples =
    !data && failure && failure.data && Array.isArray(failure.data.failures)
      ? failure.data.failures
      : null;

  function toggle(pointer) {
    setPicked((prev) => {
      if (prev.includes(pointer)) return prev.filter((p) => p !== pointer);
      // Selecting a node makes its descendant selections redundant.
      return [...prev.filter((p) => !isAncestor(pointer, p)), pointer];
    });
  }

  function clearSelection() {
    setPicked([]);
  }

  async function run() {
    setBusy(true);
    try {
      const result = await sliceContract(schema, samples, selected);
      setOutcome({ signature: runSignature, ok: true, data: result });
      setShowSchema(true);
      setShowSamples(true);
      setCopied(null);
    } catch (e) {
      setOutcome({ signature: runSignature, ok: false, message: e.message, data: e.data });
    } finally {
      setBusy(false);
    }
  }

  async function copy(target) {
    if (!data) return;
    const text =
      target === "schema"
        ? JSON.stringify(data.schema, null, 2)
        : JSON.stringify(data.samples, null, 2);
    await copyText(text);
    setCopied(target);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!schema) {
    return <div className="empty-hint">请先在左侧粘贴样本并点击「归纳 Schema」，然后在此勾选要保留的节点。</div>;
  }

  return (
    <div className="slice-panel">
      <div className="scan-head">
        <span className="panel-label">契约切片</span>
        <span className="panel__meta">
          勾选 1～{MAX_POINTERS} 个 Schema 节点（祖先已选时自动包含子项），生成仅保留所选节点及必要祖先结构的独立
          Schema，并同步投影当前样本；后端会用 Ajv 校验每条投影样本，任一失败则不产出
        </span>
      </div>

      <div className="slice-toolbar">
        <span className={`slice-count ${fieldCount === 0 || atLimit ? "slice-count--warn" : ""}`}>
          已选 {fieldCount}/{MAX_POINTERS} 个节点
        </span>
        {fieldCount > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearSelection}>
            清空选择
          </button>
        )}
      </div>

      <div className="slice-tree-wrap">
        <SliceCheckNode
          name="(root)"
          schema={schema}
          pointer=""
          depth={0}
          selected={selected}
          covered={false}
          atLimit={atLimit}
          onToggle={toggle}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={run}
          disabled={busy || !allValid || samples.length === 0 || fieldCount === 0}
          title={
            !allValid
              ? "请先修正无效的 JSON 样本"
              : fieldCount === 0
                ? "请至少勾选一个节点"
                : ""
          }
        >
          {busy ? "切片中…" : "生成契约切片"}
        </button>
        {data && (
          <>
            <button type="button" className="btn" onClick={() => setShowSchema((v) => !v)}>
              {showSchema ? "隐藏切片 Schema" : "查看切片 Schema"}
            </button>
            <button type="button" className="btn" onClick={() => setShowSamples((v) => !v)}>
              {showSamples ? "隐藏投影样本" : "查看投影样本"}
            </button>
            <button type="button" className="btn" onClick={() => copy("schema")}>
              {copied === "schema" ? "✓ 已复制" : "复制切片 Schema"}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => copy("samples")}>
              {copied === "samples" ? "✓ 已复制" : "复制投影样本"}
            </button>
          </>
        )}
      </div>

      {invalidated && (
        <div className="alert alert--info">选择或样本已变化，上次切片结果已失效，请重新生成。</div>
      )}

      {failure && (
        <>
          <div className="alert alert--err">{failure.message}</div>
          {failedSamples && failedSamples.length > 0 && (
            <ul className="slice-failures">
              {failedSamples.map((f) => (
                <li key={f.index} className="slice-failure">
                  <div className="slice-failure__head">
                    <code className="error-pointer">样本 #{f.index}</code>
                    <span className="panel__meta">
                      {f.errors.length} 条 Ajv 错误，未产出切片
                    </span>
                  </div>
                  <ul className="ce-errors">
                    {f.errors.slice(0, 5).map((err, i) => (
                      <li key={i} className="ce-error">
                        <div className="ce-error__head">
                          <code className="ce-error__pointer">{err.pointer}</code>
                          <span className="ce-error__meta">{err.keyword}</span>
                        </div>
                        <div className="ce-error__msg">{err.message}</div>
                      </li>
                    ))}
                    {f.errors.length > 5 && (
                      <li className="panel__meta">…其余 {f.errors.length - 5} 条错误已省略</li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {data && (
        <div className="slice-summary">
          <span className="variant-chip variant-chip--ok">保留字段 {data.fieldCount} 个</span>
          <span className="variant-chip">投影样本 {data.sampleCount} 条</span>
          <span className="panel__meta">
            所有投影样本均通过切片 Schema 的 Ajv 校验
          </span>
        </div>
      )}

      {data && showSchema && (
        <>
          <div className="panel-label slice-preview__label">切片 Schema</div>
          <pre className="schema-raw slice-preview">{JSON.stringify(data.schema, null, 2)}</pre>
        </>
      )}

      {data && showSamples && (
        <>
          <div className="panel-label slice-preview__label">投影样本（{data.samples.length} 条）</div>
          <pre className="schema-raw slice-preview">{JSON.stringify(data.samples, null, 2)}</pre>
        </>
      )}

      {!current && !invalidated && (
        <div className="empty-hint">
          在上方 Schema 树中勾选 1～{MAX_POINTERS} 个节点后点击「生成契约切片」：对象只保留命中的
          properties，required 仅保留仍存在的必填字段，数组沿 items 递归，类型联合与 const 不变；
          后端对每条投影样本做 Ajv 校验，任一失败即拒绝产出并返回样本索引与错误。
        </div>
      )}
    </div>
  );
}
