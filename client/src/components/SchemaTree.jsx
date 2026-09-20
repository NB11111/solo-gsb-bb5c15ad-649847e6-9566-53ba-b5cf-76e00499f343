import { useState } from "react";

function typeList(schema) {
  if (!schema || schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
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

function SchemaNode({ name, schema, pointer, paths, isRequired, depth }) {
  const [open, setOpen] = useState(depth < 2);
  const [showPaths, setShowPaths] = useState(false);

  const types = typeList(schema);
  const hasObject = types.includes("object");
  const hasArray = types.includes("array");
  const properties = hasObject && schema.properties ? Object.entries(schema.properties) : [];
  const requiredKeys = new Set(schema.required || []);
  const hasItems = hasArray && schema.items;
  const hasChildren = properties.length > 0 || hasItems;

  const samplePaths = paths[pointer] || [];
  const nullable = types.includes("null");
  const conflict = types.length > 1;

  return (
    <div className="schema-node">
      <div className="schema-node__row">
        <button
          type="button"
          className={`tree-toggle ${hasChildren ? "" : "tree-toggle--leaf"}`}
          onClick={() => hasChildren && setOpen(!open)}
          aria-label={open ? "折叠" : "展开"}
        >
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <span className="schema-node__name">{name}</span>
        <TypeBadges types={types} />
        {schema.const !== undefined && (
          <span className="flag flag--const">const {JSON.stringify(schema.const)}</span>
        )}
        {isRequired === true && <span className="flag flag--required">必填</span>}
        {isRequired === false && <span className="flag flag--optional">可选</span>}
        {nullable && <span className="flag flag--null">可空</span>}
        {conflict && <span className="flag flag--mixed">多类型</span>}
        {samplePaths.length > 0 && (
          <button
            type="button"
            className="path-count"
            onClick={() => setShowPaths(!showPaths)}
            title="查看贡献此规则的样本路径"
          >
            {showPaths ? "▾" : "▸"} {samplePaths.length} 处样本
          </button>
        )}
      </div>

      {showPaths && samplePaths.length > 0 && (
        <ul className="sample-paths">
          {samplePaths.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      )}

      {open && hasChildren && (
        <div className="schema-node__children">
          {properties.map(([key, child]) => (
            <SchemaNode
              key={key}
              name={key}
              schema={child}
              pointer={`${pointer}/properties/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`}
              paths={paths}
              isRequired={requiredKeys.has(key)}
              depth={depth + 1}
            />
          ))}
          {hasItems && (
            <SchemaNode
              name="[items]"
              schema={schema.items}
              pointer={`${pointer}/items`}
              paths={paths}
              isRequired={undefined}
              depth={depth + 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function SchemaTree({ schema, paths }) {
  return (
    <div className="schema-tree">
      <SchemaNode
        name="(root)"
        schema={schema}
        pointer=""
        paths={paths}
        isRequired={undefined}
        depth={0}
      />
    </div>
  );
}
