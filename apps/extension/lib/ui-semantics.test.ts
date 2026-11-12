import { describe, expect, test } from 'bun:test';
import { TOOL_CATALOG, type Tool } from '@marklayer/types/tools';
import {
  createSemanticRegistry,
  toolbarToolSemantic,
  validateComponentSpec,
  validateComponentSpecs,
  compileComponentSpec,
  compileComponentSpecs,
  compileControlledRender,
  UiSemanticsCompileError,
  type ComponentSchema,
} from './ui-semantics';

describe('toolbar semantic catalog', () => {
  test('assigns every registered tool a stable identity and purpose', () => {
    for (const tool of Object.keys(TOOL_CATALOG) as Tool[]) {
      const semantic = toolbarToolSemantic(tool);
      expect(semantic.id).toBe(`toolbar.tool.${tool}`);
      expect(semantic.label).toBe(TOOL_CATALOG[tool].label);
      expect(semantic.purpose.length).toBeGreaterThan(0);
      expect(semantic.region).toBe('toolbar');
    }
  });

  test('relates tools in the same group without including itself', () => {
    expect(toolbarToolSemantic('pen').related).toContain('toolbar.tool.highlight');
    expect(toolbarToolSemantic('pen').related).not.toContain('toolbar.tool.pen');
    expect(toolbarToolSemantic('pen').related).not.toContain('toolbar.tool.rectangle');
  });
});

test('new component semantics can be registered without changing the lookup code', () => {
  const registry = createSemanticRegistry();
  const spec = { id: 'annotation.reply', label: '回复', purpose: '回复批注', region: 'annotation', related: ['annotation.thread'] };
  registry.register(spec);
  spec.related.push('changed-after-registration');
  expect(registry.get('annotation.reply')?.related).toEqual(['annotation.thread']);
  expect(() => registry.register(spec)).toThrow('Duplicate');
  expect(registry.get('unknown')).toBeUndefined();
});

describe('UI component spec validation and compilation', () => {
  function setupTestRegistry() {
    const registry = createSemanticRegistry();

    const annotationCardSchema: ComponentSchema = {
      kind: 'annotation.card',
      description: 'Card displaying user annotation and comments',
      props: {
        author: { type: 'string', required: true },
        content: { type: 'string', required: true },
        likes: { type: 'number' },
        pinned: { type: 'boolean' },
        status: { type: 'enum', enumValues: ['draft', 'open', 'resolved'] },
        tags: { type: 'string[]' },
      },
    };

    const replyButtonSchema: ComponentSchema = {
      kind: 'annotation.reply_button',
      description: 'Button to trigger a reply input',
      props: {
        label: { type: 'string', required: true },
        variant: { type: 'enum', enumValues: ['primary', 'secondary'] },
      },
    };

    registry.registerComponent(annotationCardSchema);
    registry.registerComponent(replyButtonSchema);

    return registry;
  }

  test('未知组件被拒: unregistered kind is rejected with UNKNOWN_KIND', () => {
    const registry = setupTestRegistry();

    // 1. Validation function returns structured error
    const result = validateComponentSpec(
      { kind: 'malicious.script_executor', props: {} },
      registry,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].code).toBe('UNKNOWN_KIND');
      expect(result.errors[0].field).toBe('kind');
      expect(result.errors[0].message).toContain('Unknown component kind "malicious.script_executor"');
    }

    // 2. Compile function throws UiSemanticsCompileError
    expect(() => {
      compileComponentSpec({ kind: 'unregistered.custom_widget', props: {} }, registry);
    }).toThrow(UiSemanticsCompileError);

    // 3. In array batch validation, error path includes index
    const batchResult = validateComponentSpecs(
      [
        { kind: 'annotation.reply_button', props: { label: 'Reply' } },
        { kind: 'unknown.ghost_component', props: {} },
      ],
      registry,
    );
    expect(batchResult.ok).toBe(false);
    if (!batchResult.ok) {
      expect(batchResult.errors[0].path).toBe('[1].kind');
      expect(batchResult.errors[0].code).toBe('UNKNOWN_KIND');
    }
  });

  test('越界属性被拒: undeclared and forbidden props are rejected with UNDECLARED_PROP', () => {
    const registry = setupTestRegistry();

    // Undeclared extra property
    const res1 = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 'Alice',
          content: 'LGTM',
          extraHackerProp: '<script>alert(1)</script>',
          onClick: 'doSomething()',
        },
      },
      registry,
    );
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      const undeclaredFields = res1.errors.map((e) => e.field);
      expect(undeclaredFields).toContain('extraHackerProp');
      expect(undeclaredFields).toContain('onClick');
      expect(res1.errors.every((e) => e.code === 'UNDECLARED_PROP')).toBe(true);
    }

    // Prototype pollution attempt
    const resProto = validateComponentSpec(
      {
        kind: 'annotation.reply_button',
        props: {
          label: 'Reply',
          __proto__: { polluted: true },
        },
      },
      registry,
    );
    expect(resProto.ok).toBe(false);
    if (!resProto.ok) {
      expect(resProto.errors.some((e) => e.code === 'UNDECLARED_PROP' && e.field === '__proto__')).toBe(true);
    }
  });

  test('类型不符被拒: type mismatch, enum mismatch and missing required props are rejected', () => {
    const registry = setupTestRegistry();

    // 1. Missing required prop 'author'
    const missingRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          content: 'Missing author',
        },
      },
      registry,
    );
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.errors[0].code).toBe('MISSING_REQUIRED_PROP');
      expect(missingRes.errors[0].field).toBe('author');
    }

    // 2. Type mismatch: string expected, got number
    const wrongTypeRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 12345, // invalid
          content: 'Hello',
        },
      },
      registry,
    );
    expect(wrongTypeRes.ok).toBe(false);
    if (!wrongTypeRes.ok) {
      expect(wrongTypeRes.errors[0].code).toBe('TYPE_MISMATCH');
      expect(wrongTypeRes.errors[0].field).toBe('author');
      expect(wrongTypeRes.errors[0].message).toContain('must be a string');
    }

    // 3. Type mismatch: number expected, got NaN or string
    const nanRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 'Alice',
          content: 'Hello',
          likes: NaN,
        },
      },
      registry,
    );
    expect(nanRes.ok).toBe(false);
    if (!nanRes.ok) {
      expect(nanRes.errors[0].code).toBe('TYPE_MISMATCH');
      expect(nanRes.errors[0].field).toBe('likes');
    }

    // 4. Type mismatch: boolean expected, got string
    const boolRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 'Alice',
          content: 'Hello',
          pinned: 'true',
        },
      },
      registry,
    );
    expect(boolRes.ok).toBe(false);
    if (!boolRes.ok) {
      expect(boolRes.errors[0].code).toBe('TYPE_MISMATCH');
      expect(boolRes.errors[0].field).toBe('pinned');
    }

    // 5. Enum mismatch: out of range value
    const enumRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 'Alice',
          content: 'Hello',
          status: 'unknown_status',
        },
      },
      registry,
    );
    expect(enumRes.ok).toBe(false);
    if (!enumRes.ok) {
      expect(enumRes.errors[0].code).toBe('ENUM_MISMATCH');
      expect(enumRes.errors[0].field).toBe('status');
      expect(enumRes.errors[0].message).toContain('must be one of');
    }

    // 6. Type mismatch: string[] expected, got non-string elements
    const arrayRes = validateComponentSpec(
      {
        kind: 'annotation.card',
        props: {
          author: 'Alice',
          content: 'Hello',
          tags: ['valid', 999],
        },
      },
      registry,
    );
    expect(arrayRes.ok).toBe(false);
    if (!arrayRes.ok) {
      expect(arrayRes.errors[0].code).toBe('TYPE_MISMATCH');
      expect(arrayRes.errors[0].field).toBe('tags');
    }
  });

  test('合法通过: valid spec compiles into controlled pure data render node', () => {
    const registry = setupTestRegistry();

    const spec = {
      kind: 'annotation.card',
      props: {
        author: 'Bob',
        content: 'This is an approved comment',
        likes: 42,
        pinned: true,
        status: 'open' as const,
        tags: ['bug', 'ui'],
      },
    };

    const node = compileComponentSpec(spec, registry);

    // Verify properties
    expect(node.kind).toBe('annotation.card');
    expect(node.props.author).toBe('Bob');
    expect(node.props.content).toBe('This is an approved comment');
    expect(node.props.likes).toBe(42);
    expect(node.props.pinned).toBe(true);
    expect(node.props.status).toBe('open');
    expect(node.props.tags).toEqual(['bug', 'ui']);

    // Verify it is a pure plain data object: no HTML strings, no functions, frozen
    expect(typeof node).toBe('object');
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.props)).toBe(true);
    expect(JSON.stringify(node)).toContain('"kind":"annotation.card"');
  });

  test('输出顺序稳定: props keys are sorted alphabetically and list order is preserved', () => {
    const registry = setupTestRegistry();

    // 1. Props key order is deterministic regardless of input key insertion order
    const spec1 = {
      kind: 'annotation.card',
      props: {
        tags: ['a'],
        pinned: false,
        content: 'text',
        author: 'User',
        likes: 10,
        status: 'draft',
      },
    };

    const spec2 = {
      kind: 'annotation.card',
      props: {
        author: 'User',
        status: 'draft',
        likes: 10,
        content: 'text',
        tags: ['a'],
        pinned: false,
      },
    };

    const node1 = compileComponentSpec(spec1, registry);
    const node2 = compileComponentSpec(spec2, registry);

    const keys1 = Object.keys(node1.props);
    const keys2 = Object.keys(node2.props);

    expect(keys1).toEqual(['author', 'content', 'likes', 'pinned', 'status', 'tags']);
    expect(keys2).toEqual(['author', 'content', 'likes', 'pinned', 'status', 'tags']);
    expect(keys1).toEqual(keys2);

    // 2. List order stability
    const listSpecs = [
      { kind: 'annotation.reply_button', props: { label: 'First' } },
      { kind: 'annotation.card', props: { author: 'Second', content: 'Second card' } },
      { kind: 'annotation.reply_button', props: { label: 'Third' } },
    ];

    const compiledList = compileComponentSpecs(listSpecs, registry);
    expect(compiledList.length).toBe(3);
    expect(compiledList[0].kind).toBe('annotation.reply_button');
    expect(compiledList[0].props.label).toBe('First');
    expect(compiledList[1].kind).toBe('annotation.card');
    expect(compiledList[1].props.author).toBe('Second');
    expect(compiledList[2].kind).toBe('annotation.reply_button');
    expect(compiledList[2].props.label).toBe('Third');

    // 3. compileControlledRender handles both single and array
    const single = compileControlledRender(listSpecs[0], registry);
    expect(!Array.isArray(single) && single.kind === 'annotation.reply_button').toBe(true);

    const multi = compileControlledRender(listSpecs, registry);
    expect(Array.isArray(multi) && multi.length === 3).toBe(true);
  });

  test('自动关联: registering UiSemantic with props registers its component schema', () => {
    const registry = createSemanticRegistry();

    registry.register({
      id: 'custom.tag',
      label: '标签',
      purpose: '显示状态标签',
      region: 'panel',
      related: [],
      props: {
        color: { type: 'string', required: true },
        text: { type: 'string', required: true },
      },
    });

    expect(registry.hasComponent('custom.tag')).toBe(true);

    const compiled = compileComponentSpec(
      { kind: 'custom.tag', props: { color: 'blue', text: 'Active' } },
      registry,
    );
    expect(compiled.kind).toBe('custom.tag');
    expect(compiled.props.color).toBe('blue');
    expect(compiled.props.text).toBe('Active');
  });
});
