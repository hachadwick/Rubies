import { mergeAttributes, Node } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Quotes in notes: a blockquote ends with a line naming who is being quoted (saved as <cite>). The editor shows
 * curly quotation marks around the quoted text (see `.prose blockquote` in styles.css), and the exports add them.
 *
 * - Making a quote (the toolbar button, or typing "> ") adds the empty name line automatically, shown as
 *   "Who said this?" until something is typed.
 * - Enter on an empty last line of the quote moves to the name line; Enter on the name line leaves the quote.
 */
export const QuoteCite = Node.create({
  name: 'quoteCite',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'blockquote > cite' }],
  renderHTML: ({ HTMLAttributes }) => ['cite', mergeAttributes(HTMLAttributes), 0],

  addKeyboardShortcuts() {
    return {
      // Leave the quote: a new paragraph after it.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== this.name) return false;
        const after = $from.after($from.depth - 1);
        return editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).scrollIntoView().run();
      },
    };
  },
});

const citeKey = new PluginKey('quoteCite');

/** Lucide's trash-2 icon, for the delete button on each quote. */
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';

export const Quote = Blockquote.extend({
  content: 'block+ quoteCite?',

  /**
   * On screen, each quote (typed, or a Bible passage added from the Bible pane) gets a trash button in its top
   * right corner that removes the whole quote. It's only drawn in the editor; the saved note is unchanged, and
   * Undo brings a deleted quote back.
   */
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'quote-block';
      const quote = document.createElement('blockquote');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quote-delete';
      remove.contentEditable = 'false';
      remove.title = 'Delete this quote';
      remove.setAttribute('aria-label', 'Delete this quote');
      remove.innerHTML = TRASH_SVG;
      // Keep the cursor where it is until the click lands.
      remove.addEventListener('mousedown', (e) => e.preventDefault());
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) return;
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
      });
      dom.append(quote, remove);
      return {
        dom,
        contentDOM: quote,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          return true;
        },
        stopEvent: (e) => remove.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => remove.contains(m.target as globalThis.Node),
      };
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // Turning a quote back into plain text: its name line can't stand outside a quote, so it goes first
      // (any quote left over gets a new one).
      toggleBlockquote:
        () =>
        ({ editor, chain }) => {
          if (!editor.isActive(this.name)) return chain().wrapIn(this.name).run();
          return chain()
            .command(({ tr }) => {
              const { $from } = tr.selection;
              for (let d = $from.depth; d > 0; d--) {
                const node = $from.node(d);
                if (node.type.name !== this.name) continue;
                if (node.lastChild?.type.name === 'quoteCite') {
                  const end = $from.end(d);
                  tr.delete(end - node.lastChild.nodeSize, end);
                }
                break;
              }
              return true;
            })
            .lift(this.name)
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Enter on an empty last paragraph of the quote: drop it and go to the name line.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
        const quote = $from.node($from.depth - 1);
        if (quote?.type.name !== this.name) return false;
        const index = $from.index($from.depth - 1);
        if (index === 0 || quote.child(index + 1)?.type.name !== 'quoteCite') return false;
        const start = $from.before();
        const tr = editor.state.tr.delete(start, $from.after());
        tr.setSelection(TextSelection.create(tr.doc, start + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: citeKey,
        // Every quote gets its name line, however it was made.
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const cite = state.schema.nodes.quoteCite;
          const missing: number[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return node.isBlock;
            if (node.lastChild?.type !== cite) missing.push(pos + node.nodeSize - 1);
            return false;
          });
          if (!missing.length) return null;
          const tr = state.tr;
          for (const at of missing.reverse()) tr.insert(at, cite.create());
          return tr;
        },
        // "Who said this?" on an empty name line.
        props: {
          decorations: (state) => {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'quoteCite' && !node.content.size) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-placeholder': 'Who said this?' }));
              }
              return node.isBlock;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
