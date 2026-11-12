import { TOOL_CATALOG, type Tool } from '@marklayer/types/tools';
import toolPurposes from './ui-semantic-tools.json';

/** Stable semantic identities are independent of presentation and DOM structure. */
export interface UiSemantic {
  id: string;
  label: string;
  purpose: string;
  region: string;
  related: readonly string[];
  /** Optional component schema specification associated with this UI semantic entity. */
  schema?: ComponentSchema;
  props?: Record<string, ComponentPropDef>;
}

export type ComponentPropType = 'string' | 'number' | 'boolean' | 'enum' | 'string[]';

export interface ComponentPropDef {
  type: ComponentPropType;
  required?: boolean;
  enumValues?: readonly (string | number)[];
  description?: string;
}

export interface ComponentSchema {
  kind: string;
  description?: string;
  props: Record<string, ComponentPropDef>;
}

/** Raw component specification supplied by external sources (e.g. AI generation). */
export interface RawComponentSpec {
  kind: string;
  props?: Record<string, unknown>;
}

/** Controlled render output. Pure plain data, strictly typed and whitelisted. No HTML, no scripts, no eval. */
export interface ControlledRenderNode {
  readonly kind: string;
  readonly props: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export type UiSemanticsValidationCode =
  | 'UNKNOWN_KIND'
  | 'UNDECLARED_PROP'
  | 'TYPE_MISMATCH'
  | 'ENUM_MISMATCH'
  | 'MISSING_REQUIRED_PROP'
  | 'INVALID_SPEC';

export interface UiSemanticsValidationErrorItem {
  readonly path: string;
  readonly field: string;
  readonly code: UiSemanticsValidationCode;
  readonly message: string;
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly errors?: never;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly errors: readonly UiSemanticsValidationErrorItem[];
  readonly data?: never;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export class UiSemanticsCompileError extends Error {
  readonly errors: readonly UiSemanticsValidationErrorItem[];
  constructor(errors: readonly UiSemanticsValidationErrorItem[]) {
    const summary = errors.map((e) => `[${e.field}] ${e.message}`).join('; ');
    super(`UI semantics validation failed: ${summary}`);
    this.name = 'UiSemanticsCompileError';
    this.errors = errors;
  }
}

const purposes: Record<Tool, string> = toolPurposes;

const FORBIDDEN_PROP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface SemanticRegistry {
  register(value: UiSemantic): void;
  get(id: string): UiSemantic | undefined;
  registerComponent(schema: ComponentSchema): void;
  getComponent(kind: string): ComponentSchema | undefined;
  hasComponent(kind: string): boolean;
  listComponents(): readonly ComponentSchema[];
}

/** A registry accepts data only; a semantic entry does not grant executable capabilities. */
export function createSemanticRegistry(): SemanticRegistry {
  const entries = new Map<string, UiSemantic>();
  const componentSchemas = new Map<string, ComponentSchema>();

  function registerComponentInternal(schema: ComponentSchema): void {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Invalid component schema: must be an object');
    }
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(schema.kind)) {
      throw new Error(`Invalid component kind: "${schema?.kind}"`);
    }
    if (componentSchemas.has(schema.kind)) {
      throw new Error(`Duplicate component kind: ${schema.kind}`);
    }
    if (schema.props && typeof schema.props !== 'object') {
      throw new Error(`Invalid props definition for component kind: ${schema.kind}`);
    }
    const validatedProps: Record<string, ComponentPropDef> = {};
    if (schema.props) {
      for (const [propName, propDef] of Object.entries(schema.props)) {
        if (!propDef || typeof propDef !== 'object') {
          throw new Error(`Invalid prop definition for "${propName}" on kind "${schema.kind}"`);
        }
        if (!['string', 'number', 'boolean', 'enum', 'string[]'].includes(propDef.type)) {
          throw new Error(`Unsupported prop type "${propDef.type}" for "${propName}" on kind "${schema.kind}"`);
        }
        if (propDef.type === 'enum') {
          if (!Array.isArray(propDef.enumValues) || propDef.enumValues.length === 0) {
            throw new Error(`Enum prop "${propName}" on kind "${schema.kind}" must define non-empty enumValues`);
          }
        }
        validatedProps[propName] = {
          ...propDef,
          enumValues: propDef.enumValues ? [...propDef.enumValues] : undefined,
        };
      }
    }
    componentSchemas.set(schema.kind, {
      kind: schema.kind,
      description: schema.description,
      props: validatedProps,
    });
  }

  return {
    register(value: UiSemantic): void {
      if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(value.id) ||
          !value.label.trim() || !value.purpose.trim() || !value.region.trim() ||
          !Array.isArray(value.related) || value.related.some((id) => typeof id !== 'string')) {
        throw new Error('Invalid UI semantic definition');
      }
      if (entries.has(value.id)) throw new Error(`Duplicate UI semantic ID: ${value.id}`);
      entries.set(value.id, { ...value, related: [...value.related] });

      if (value.schema) {
        registerComponentInternal(value.schema);
      } else if (value.props) {
        registerComponentInternal({
          kind: value.id,
          description: value.purpose,
          props: value.props,
        });
      }
    },
    get(id: string): UiSemantic | undefined {
      const entry = entries.get(id);
      return entry ? { ...entry, related: [...entry.related] } : undefined;
    },
    registerComponent(schema: ComponentSchema): void {
      registerComponentInternal(schema);
    },
    getComponent(kind: string): ComponentSchema | undefined {
      const entry = componentSchemas.get(kind);
      return entry ? { ...entry, props: { ...entry.props } } : undefined;
    },
    hasComponent(kind: string): boolean {
      return componentSchemas.has(kind);
    },
    listComponents(): readonly ComponentSchema[] {
      return Array.from(componentSchemas.values()).map((s) => ({
        ...s,
        props: { ...s.props },
      }));
    },
  };
}

export function toolbarToolSemantic(tool: Tool, label = TOOL_CATALOG[tool].label): UiSemantic {
  const group = TOOL_CATALOG[tool].group;
  return {
    id: `toolbar.tool.${tool}`,
    label,
    purpose: purposes[tool],
    region: 'toolbar',
    related: group
      ? (Object.keys(TOOL_CATALOG) as Tool[])
          .filter((other) => other !== tool && TOOL_CATALOG[other].group === group)
          .map((other) => `toolbar.tool.${other}`)
      : [],
  };
}

export function validateComponentSpec(
  rawSpec: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
  pathPrefix = '',
): ValidationResult<ControlledRenderNode> {
  const errors: UiSemanticsValidationErrorItem[] = [];

  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    return {
      ok: false,
      errors: [
        {
          path: pathPrefix || 'root',
          field: pathPrefix || 'root',
          code: 'INVALID_SPEC',
          message: 'Component specification must be a non-null object',
        },
      ],
    };
  }

  const spec = rawSpec as Record<string, unknown>;
  const kindPath = pathPrefix ? `${pathPrefix}.kind` : 'kind';

  if (typeof spec.kind !== 'string' || !spec.kind.trim()) {
    return {
      ok: false,
      errors: [
        {
          path: kindPath,
          field: 'kind',
          code: 'INVALID_SPEC',
          message: 'Component spec must have a non-empty string "kind"',
        },
      ],
    };
  }

  const schema = registry.getComponent(spec.kind);
  if (!schema) {
    return {
      ok: false,
      errors: [
        {
          path: kindPath,
          field: 'kind',
          code: 'UNKNOWN_KIND',
          message: `Unknown component kind "${spec.kind}". Component is not registered in the UI semantics registry.`,
        },
      ],
    };
  }

  const propsRaw = spec.props ?? {};
  const propsPath = pathPrefix ? `${pathPrefix}.props` : 'props';

  if (typeof propsRaw !== 'object' || propsRaw === null || Array.isArray(propsRaw)) {
    return {
      ok: false,
      errors: [
        {
          path: propsPath,
          field: 'props',
          code: 'INVALID_SPEC',
          message: `Property container "props" for component "${spec.kind}" must be a plain object`,
        },
      ],
    };
  }

  const declaredProps = schema.props || {};

  // Reject objects with non-standard prototype (prototype pollution defense)
  const proto = Object.getPrototypeOf(propsRaw);
  if (proto !== Object.prototype && proto !== null) {
    errors.push({
      path: propsPath,
      field: '__proto__',
      code: 'UNDECLARED_PROP',
      message: 'Prototypical pollution or non-plain object detected in props.',
    });
  }

  // Check forbidden property keys and undeclared properties
  const propKeys = Object.getOwnPropertyNames(propsRaw);
  for (const key of propKeys) {
    const fieldPath = `${propsPath}.${key}`;
    if (FORBIDDEN_PROP_KEYS.has(key)) {
      errors.push({
        path: fieldPath,
        field: key,
        code: 'UNDECLARED_PROP',
        message: `Property "${key}" is prohibited for security reasons.`,
      });
      continue;
    }
    if (!(key in declaredProps)) {
      errors.push({
        path: fieldPath,
        field: key,
        code: 'UNDECLARED_PROP',
        message: `Undeclared property "${key}" for component "${spec.kind}". Only declared properties are permitted.`,
      });
    }
  }

  // Check required properties
  for (const [declaredKey, propDef] of Object.entries(declaredProps)) {
    if (propDef.required) {
      const val = (propsRaw as Record<string, unknown>)[declaredKey];
      if (val === undefined || val === null) {
        errors.push({
          path: `${propsPath}.${declaredKey}`,
          field: declaredKey,
          code: 'MISSING_REQUIRED_PROP',
          message: `Missing required property "${declaredKey}" for component "${spec.kind}".`,
        });
      }
    }
  }

  // Type and enum verification
  const sanitizedProps: Record<string, string | number | boolean | readonly string[]> = {};
  for (const [key, propDef] of Object.entries(declaredProps)) {
    if (!(key in (propsRaw as Record<string, unknown>))) {
      continue;
    }
    const val = (propsRaw as Record<string, unknown>)[key];
    if (val === undefined) {
      continue;
    }
    const fieldPath = `${propsPath}.${key}`;

    switch (propDef.type) {
      case 'string': {
        if (typeof val !== 'string') {
          errors.push({
            path: fieldPath,
            field: key,
            code: 'TYPE_MISMATCH',
            message: `Property "${key}" on component "${spec.kind}" must be a string, received ${typeof val}.`,
          });
        } else {
          sanitizedProps[key] = val;
        }
        break;
      }
      case 'number': {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          errors.push({
            path: fieldPath,
            field: key,
            code: 'TYPE_MISMATCH',
            message: `Property "${key}" on component "${spec.kind}" must be a finite number, received ${typeof val}.`,
          });
        } else {
          sanitizedProps[key] = val;
        }
        break;
      }
      case 'boolean': {
        if (typeof val !== 'boolean') {
          errors.push({
            path: fieldPath,
            field: key,
            code: 'TYPE_MISMATCH',
            message: `Property "${key}" on component "${spec.kind}" must be a boolean, received ${typeof val}.`,
          });
        } else {
          sanitizedProps[key] = val;
        }
        break;
      }
      case 'enum': {
        const allowed = propDef.enumValues || [];
        if (!allowed.includes(val as string | number)) {
          errors.push({
            path: fieldPath,
            field: key,
            code: 'ENUM_MISMATCH',
            message: `Property "${key}" on component "${spec.kind}" must be one of [${allowed.map((v) => JSON.stringify(v)).join(', ')}], received ${JSON.stringify(val)}.`,
          });
        } else {
          sanitizedProps[key] = val as string | number;
        }
        break;
      }
      case 'string[]': {
        if (!Array.isArray(val) || val.some((item) => typeof item !== 'string')) {
          errors.push({
            path: fieldPath,
            field: key,
            code: 'TYPE_MISMATCH',
            message: `Property "${key}" on component "${spec.kind}" must be an array of strings.`,
          });
        } else {
          sanitizedProps[key] = Object.freeze([...val]);
        }
        break;
      }
      default: {
        errors.push({
          path: fieldPath,
          field: key,
          code: 'TYPE_MISMATCH',
          message: `Unsupported property definition type "${(propDef as any).type}" for "${key}".`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Construct stable, deterministic render node: props keys are sorted alphabetically
  const sortedKeys = Object.keys(sanitizedProps).sort();
  const sortedProps: Record<string, string | number | boolean | readonly string[]> = {};
  for (const k of sortedKeys) {
    sortedProps[k] = sanitizedProps[k];
  }

  const node: ControlledRenderNode = Object.freeze({
    kind: spec.kind,
    props: Object.freeze(sortedProps),
  });

  return { ok: true, data: node };
}

export function validateComponentSpecs(
  rawSpecs: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): ValidationResult<readonly ControlledRenderNode[]> {
  if (!Array.isArray(rawSpecs)) {
    return {
      ok: false,
      errors: [
        {
          path: 'root',
          field: 'root',
          code: 'INVALID_SPEC',
          message: 'Component specifications list must be an array',
        },
      ],
    };
  }

  const errors: UiSemanticsValidationErrorItem[] = [];
  const nodes: ControlledRenderNode[] = [];

  for (let i = 0; i < rawSpecs.length; i++) {
    const res = validateComponentSpec(rawSpecs[i], registry, `[${i}]`);
    if (!res.ok) {
      errors.push(...res.errors);
    } else {
      nodes.push(res.data);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: Object.freeze(nodes) };
}

export function compileComponentSpec(
  rawSpec: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): ControlledRenderNode {
  const result = validateComponentSpec(rawSpec, registry);
  if (!result.ok) {
    throw new UiSemanticsCompileError(result.errors);
  }
  return result.data;
}

export function compileComponentSpecs(
  rawSpecs: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): readonly ControlledRenderNode[] {
  const result = validateComponentSpecs(rawSpecs, registry);
  if (!result.ok) {
    throw new UiSemanticsCompileError(result.errors);
  }
  return result.data;
}

export function compileControlledRender(
  input: unknown[],
  registry: Pick<SemanticRegistry, 'getComponent'>,
): readonly ControlledRenderNode[];
export function compileControlledRender(
  input: Record<string, unknown>,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): ControlledRenderNode;
export function compileControlledRender(
  input: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): ControlledRenderNode | readonly ControlledRenderNode[];
export function compileControlledRender(
  input: unknown,
  registry: Pick<SemanticRegistry, 'getComponent'>,
): ControlledRenderNode | readonly ControlledRenderNode[] {
  if (Array.isArray(input)) {
    return compileComponentSpecs(input, registry);
  }
  return compileComponentSpec(input, registry);
}
