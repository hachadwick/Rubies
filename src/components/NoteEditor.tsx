import {
  ActionIcon,
  Blockquote,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  type TextInputProps,
} from '@mantine/core';
import { RichTextEditor } from '@mantine/tiptap';
import Highlight from '@tiptap/extension-highlight';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowLeft, BookOpen, Check, Copy, FileDown, FileText, Loader2, Mail, PenLine, Share, Share2, Trash2, Type } from 'lucide-react';
import { canShare, copyNote, emailNote, exportPdf, exportWord, shareNote } from '../exporting';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPassage, refKeys } from '../bible/kjv';
import { extractRefs, formatRef, parseRefs, type Ref } from '../bible/reference';
import { db, NOTE_KINDS, type InkStroke, type Note, type NoteKind } from '../db';
import { escapeHtml, noteTitle } from '../util';
import { refsLabel } from './BiblePane';
import { InkPad } from './InkPad';

interface Props {
  noteId: string;
  onBack: () => void;
  /** Lets the Bible pane insert verses into this note while it is open. */
  registerInserter: (fn: ((refs: Ref[]) => void) | null) => void;
  toast: (msg: string) => void;
}

export function NoteEditor(props: Props) {
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  useEffect(() => {
    db.notes.get(props.noteId).then((n) => setNote(n ?? null));
  }, [props.noteId]);

  if (note === undefined)
    return (
      <section className="pane notes-pane">
        <Center h="100%">
          <Loader type="dots" />
        </Center>
      </section>
    );
  if (note === null)
    return (
      <section className="pane notes-pane">
        <Stack align="center" mt="xl">
          <Text c="dimmed">This note no longer exists.</Text>
          <Button variant="light" onClick={props.onBack}>
            Back to notes
          </Button>
        </Stack>
      </section>
    );
  return <Editor_ key={note.id} initial={note} {...props} />;
}

const isEmpty = (n: Note) =>
  !n.title.trim() && !n.passage.trim() && !n.speaker.trim() && !n.church.trim() && !n.bodyText.trim() && !n.ink.length;

function computeVerseKeys(n: Note): string[] {
  const refs = [...parseRefs(n.passage), ...extractRefs(n.bodyText)];
  return [...new Set(refs.flatMap(refKeys))];
}

function passageHtml(refs: Ref[]): string {
  return (
    refs
      .map((r) => {
        const vs = getPassage(r);
        const body = vs
          .map((v) => (vs.length > 1 ? `<strong>${v.verse}</strong> ${escapeHtml(v.text)}` : escapeHtml(v.text)))
          .join(' ');
        return `<blockquote><p><strong>${formatRef(r)} (KJV)</strong></p><p>${body}</p></blockquote>`;
      })
      .join('') + '<p></p>'
  );
}

/**
 * Text input whose label sits inside the box until the field has a value or focus, then floats up.
 * `alwaysFloat` keeps the label up for inputs that always show something, such as dates.
 */
function FloatInput({ alwaysFloat, onFocus, onBlur, ...props }: TextInputProps & { alwaysFloat?: boolean }) {
  const [focused, setFocused] = useState(false);
  const floating = alwaysFloat || focused || String(props.value ?? '').length > 0;
  return (
    <TextInput
      size="md"
      {...props}
      classNames={{ root: 'float-root', label: 'float-label', input: 'float-input' }}
      labelProps={{ 'data-floating': floating || undefined }}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}

function Editor_({ initial, onBack, registerInserter, toast }: Props & { initial: Note }) {
  const [meta, setMeta] = useState(() => ({
    title: initial.title,
    date: initial.date,
    speaker: initial.speaker,
    church: initial.church,
  }));
  const [kind, setKind] = useState<NoteKind>(initial.kind ?? 'sermon');
  const [mode, setMode] = useState<'type' | 'write'>(initial.ink.length && !initial.bodyText.trim() ? 'write' : 'type');
  const [lookupOpen, setLookupOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const [suggest, setSuggest] = useState<{ speakers: string[]; churches: string[] }>({ speakers: [], churches: [] });

  const noteRef = useRef<Note>(initial);
  const timer = useRef<number | undefined>(undefined);

  // Autocomplete for speaker/church from past notes.
  useEffect(() => {
    db.notes.toArray().then((ns) =>
      setSuggest({
        speakers: [...new Set(ns.map((n) => n.speaker.trim()).filter(Boolean))],
        churches: [...new Set(ns.map((n) => n.church.trim()).filter(Boolean))],
      }),
    );
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const n = noteRef.current;
    n.verseKeys = computeVerseKeys(n);
    n.updatedAt = Date.now();
    await db.notes.put({ ...n });
    setSaved(true);
  }, []);

  const patch = useCallback(
    (p: Partial<Note>) => {
      noteRef.current = { ...noteRef.current, ...p };
      setSaved(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    [flush],
  );

  // Save when leaving the note, closing the app, or switching away on iPad/Android.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && timer.current !== undefined && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (timer.current !== undefined) flush();
    };
  }, [flush]);

  const editor = useEditor({
    extensions: [StarterKit, Highlight],
    content: initial.bodyHtml,
    editorProps: { attributes: { class: 'prose', 'aria-label': 'Sermon notes' } },
    onUpdate: ({ editor }) => patch({ bodyHtml: editor.getHTML(), bodyText: editor.getText({ blockSeparator: '\n' }) }),
  });

  const insert = useCallback(
    (refs: Ref[]) => {
      if (!editor || !refs.length) return;
      setMode('type');
      editor.chain().focus().insertContent(passageHtml(refs)).run();
      toast(`Added ${refsLabel(refs)} to note`);
    },
    [editor, toast],
  );

  useEffect(() => {
    registerInserter(insert);
    return () => registerInserter(null);
  }, [insert, registerInserter]);

  const setField = (k: keyof typeof meta, v: string) => {
    setMeta((m) => ({ ...m, [k]: v }));
    patch({ [k]: v });
  };

  const back = async () => {
    await flush();
    if (isEmpty(noteRef.current)) await db.notes.delete(noteRef.current.id);
    onBack();
  };

  const remove = async () => {
    if (!confirm(`Delete “${noteTitle(noteRef.current)}”? This cannot be undone.`)) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    await db.notes.delete(noteRef.current.id);
    toast('Note deleted');
    onBack();
  };


  return (
    <section className="pane notes-pane editor" aria-label="Note">
      <header className="pane-head">
        <ActionIcon onClick={back} aria-label="Back to all notes">
          <ArrowLeft />
        </ActionIcon>
        <Group gap={4} c="dimmed" className="save-state" aria-live="polite">
          {saved ? <Check size={14} /> : <Loader2 size={14} className="spin" />}
          <Text size="xs" inherit>
            {saved ? 'Saved' : 'Saving…'}
          </Text>
        </Group>
        <div className="spacer" />
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'type' | 'write')}
          aria-label="Note mode"
          data={[
            {
              value: 'type',
              label: (
                <Group gap={6} wrap="nowrap">
                  <Type size={16} /> Type
                </Group>
              ),
            },
            {
              value: 'write',
              label: (
                <Group gap={6} wrap="nowrap">
                  <PenLine size={16} /> Write
                </Group>
              ),
            },
          ]}
        />
        <div className="spacer" />
        <ExportMenu getNote={async () => (await flush(), noteRef.current)} toast={toast} />
        <Tooltip label="Delete note">
          <ActionIcon color="red" onClick={remove} aria-label="Delete note">
            <Trash2 />
          </ActionIcon>
        </Tooltip>
      </header>

      <div className="meta">
        <TextInput
          variant="unstyled"
          size="xl"
          value={meta.title}
          onChange={(e) => setField('title', e.currentTarget.value)}
          placeholder="Title"
          aria-label="Title"
          classNames={{ input: 'title-input' }}
        />
        <Radio.Group
          value={kind}
          onChange={(v) => {
            setKind(v as NoteKind);
            patch({ kind: v as NoteKind });
          }}
          aria-label="Type of message"
          mb="sm"
        >
          <Group gap="lg">
            {NOTE_KINDS.map((k) => (
              <Radio key={k.value} value={k.value} label={k.label} />
            ))}
          </Group>
        </Radio.Group>
        <div className="meta-grid">
          <FloatInput label="Date" type="date" alwaysFloat value={meta.date} onChange={(e) => setField('date', e.currentTarget.value)} />
          <FloatInput
            label="Speaker"
            value={meta.speaker}
            onChange={(e) => setField('speaker', e.currentTarget.value)}
            list="speakers"
          />
          <FloatInput label="Location" value={meta.church} onChange={(e) => setField('church', e.currentTarget.value)} list="churches" />
        </div>
        <datalist id="speakers">
          {suggest.speakers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <datalist id="churches">
          {suggest.churches.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {mode === 'type' ? (
        <RichTextEditor editor={editor} variant="subtle" className="rte">
          <RichTextEditor.Toolbar className="rte-toolbar">
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Bold />
              <RichTextEditor.Italic />
              <RichTextEditor.Underline />
              <RichTextEditor.Highlight />
            </RichTextEditor.ControlsGroup>
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.H2 />
              <RichTextEditor.BulletList />
              <RichTextEditor.OrderedList />
              <RichTextEditor.Blockquote />
            </RichTextEditor.ControlsGroup>
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Undo />
              <RichTextEditor.Redo />
            </RichTextEditor.ControlsGroup>
            <Button
              size="compact-md"
              ml="auto"
              leftSection={<BookOpen size={16} />}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLookupOpen(true)}
            >
              Insert verse
            </Button>
          </RichTextEditor.Toolbar>
          <div className="editor-scroll" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
            <RichTextEditor.Content />
          </div>
        </RichTextEditor>
      ) : (
        <InkPad initial={initial.ink} onChange={(ink: InkStroke[]) => patch({ ink })} />
      )}

      <VerseLookup
        opened={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onInsert={(refs) => {
          setLookupOpen(false);
          insert(refs);
        }}
      />
    </section>
  );
}

/** "Export & share" menu: Word, PDF, and the system share sheet (or email/copy where there is none). */
function ExportMenu({ getNote, toast }: { getNote: () => Promise<Note>; toast: (msg: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = (label: string, fn: (n: Note) => Promise<unknown>, done?: (result: unknown) => string | null) => async () => {
    setBusy(label);
    try {
      const result = await fn(await getNote());
      const msg = done?.(result);
      if (msg) toast(msg);
    } catch (err) {
      console.error(err);
      toast(`${label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const sharing = canShare();

  return (
    <Menu position="bottom-end" shadow="md" width={250} withinPortal>
      <Menu.Target>
        <Tooltip label="Export & share">
          <ActionIcon aria-label="Export and share" loading={!!busy}>
            <Share />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Export</Menu.Label>
        <Menu.Item leftSection={<FileText size={18} />} onClick={run('Word export', exportWord)}>
          Word document (.docx)
        </Menu.Item>
        <Menu.Item
          leftSection={<FileDown size={18} />}
          onClick={run('PDF export', exportPdf, (r) => (r === 'saved' ? 'PDF saved' : null))}
        >
          PDF
        </Menu.Item>
        <Menu.Divider />
        <Menu.Label>Share</Menu.Label>
        {sharing && (
          <Menu.Item leftSection={<Share2 size={18} />} onClick={run('Share', shareNote)}>
            Share…
          </Menu.Item>
        )}
        <Menu.Item leftSection={<Mail size={18} />} onClick={run('Email', emailNote)}>
          Email
        </Menu.Item>
        <Menu.Item leftSection={<Copy size={18} />} onClick={run('Copy', copyNote, () => 'Note copied — paste it anywhere')}>
          Copy text
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function VerseLookup({ opened, onClose, onInsert }: { opened: boolean; onClose: () => void; onInsert: (refs: Ref[]) => void }) {
  const [q, setQ] = useState('');
  const refs = parseRefs(q).filter((r) => r.verse !== undefined || r.endChapter === undefined);
  const verses = refs.flatMap((r) => getPassage(r));
  const tooLong = verses.length > 60;
  const ok = verses.length > 0 && !tooLong;

  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title={<Title order={3}>Insert verse</Title>} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) {
            setQ('');
            onInsert(refs);
          }
        }}
      >
        <Stack>
          <TextInput
            data-autofocus
            size="lg"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="John 3:16-18; Rom 5:8"
            aria-label="Verse reference"
            autoCapitalize="words"
            autoCorrect="off"
            enterKeyHint="done"
            leftSection={<BookOpen size={20} />}
          />
          <div className="preview">
            {q.trim() && !verses.length && <Text c="dimmed">Type a reference like “Ps 23” or “1 Cor 13:4-7”.</Text>}
            {tooLong && <Text c="dimmed">That’s {verses.length} verses — pick a shorter passage (up to 60).</Text>}
            {ok &&
              refs.map((r) => (
                <Blockquote key={formatRef(r)} cite={`— ${formatRef(r)} (KJV)`} p="md" mb="sm" radius="md" iconSize={0}>
                  {getPassage(r).map((v) => (
                    <span key={v.key}>
                      <sup>{v.verse}</sup>
                      {v.text}{' '}
                    </span>
                  ))}
                </Blockquote>
              ))}
          </div>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              Insert
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
