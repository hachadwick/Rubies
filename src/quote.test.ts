import { getSchema } from '@tiptap/core';
import { findWrapping } from '@tiptap/pm/transform';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { Quote, QuoteCite } from './quote';

const schema = getSchema([StarterKit.configure({ blockquote: false }), Quote, QuoteCite]);

describe('quotes with a name line', () => {
  it('lets a paragraph be made into a quote (the name line is added after)', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Be still')])]);
    const range = doc.resolve(1).blockRange(doc.resolve(doc.content.size - 1))!;
    expect(findWrapping(range, schema.nodes.blockquote)).not.toBeNull();
  });

  it('takes the quoted words then who said them', () => {
    const quote = schema.node('blockquote', null, [
      schema.node('paragraph', null, [schema.text('Be still, and know that I am God')]),
      schema.node('quoteCite', null, [schema.text('Psalm 46:10 (KJV)')]),
    ]);
    expect(() => quote.check()).not.toThrow();
  });

  it('keeps the name line last, once', () => {
    const cite = schema.node('quoteCite');
    const para = schema.node('paragraph', null, [schema.text('x')]);
    expect(schema.nodes.blockquote.validContent(schema.nodes.blockquote.create().content.append(
      schema.node('blockquote', null, [para, cite]).content,
    ))).toBe(true);
    expect(schema.nodes.blockquote.validContent(schema.node('blockquote', null, [para]).content.addToEnd(cite).addToEnd(para))).toBe(false);
  });
});
