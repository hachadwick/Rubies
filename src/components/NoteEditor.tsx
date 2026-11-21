import {
  ActionIcon,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  type TextInputProps,
} from '@mantine/core';
import { RichTextEditor } from '@mantine/tiptap';
import Highlight from '@tiptap/extension-highlight';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowLeft, CalendarCheck, Check, ChevronDown, ChevronUp, History, Copy, FileDown, FileText, FolderArchive, Loader2, Mail, PenLine, Share, Share2, Trash2, Type } from 'lucide-react';
import { canShare, copyNote, emailNote, exportNotesZip, exportPdf, exportWord, shareNote } from '../exporting';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPassage, refKeys } from '../bible/kjv';
import { extractRefs, formatRef, parseRefs, type Ref } from '../bible/reference';
import { db, hasSpeaker, kindLabel, NOTE_KINDS, type InkStroke, type Note, type NoteKind } from '../db';
import { escapeHtml, formatDate, noteTitle } from '../util';
import { refsLabel } from './BiblePane';
import { InkPad } from './InkPad';
import { ConfirmDialog } from './ConfirmDialog';
import { SERIF } from '../theme';
import { Quote, QuoteCite } from '../quote';
import type { Insertion } from '../insertion';
import { isStale, reviewedAt, timeAgo } from '../review';

interface Props {
  noteId: string;
  onBack: () => void;
  /** Lets the Bible and Library insert passages into this note while it is open. */
  registerInserter: (fn: ((what: Insertion) => void) | null) => void;
  toast: (msg: string) => void;
  /** Opens the prayer list over the note. */
  /** The review interval from Settings (0 = no review reminders). */
  reviewEveryDays: number;
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

const DETAILS_KEY = 'rubies.noteDetails';

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
        // The passage, with its reference as the quote's name line: “…” — John 3:16 (KJV)
        return `<blockquote><p>${body}</p><cite>${formatRef(r)} (KJV)</cite></blockquote>`;
      })
      .join('') + '<p></p>'
  );
}

/** Sentences from a Library book, as a quote naming the book and page. */
function bookQuoteHtml(paragraphs: string[], cite: string): string {
  return `<blockquote>${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}<cite>${escapeHtml(cite)}</cite></blockquote><p></p>`;
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

function Editor_({ initial, onBack, registerInserter, toast, reviewEveryDays }: Props & { initial: Note }) {
  const [lastReviewedAt, setLastReviewedAt] = useState(initial.lastReviewedAt);
  const [meta, setMeta] = useState(() => ({
    title: initial.title,
    date: initial.date,
    speaker: initial.speaker,
    church: initial.church,
  }));
  const [kind, setKind] = useState<NoteKind>(initial.kind ?? 'sermon');
  const [mode, setMode] = useState<'type' | 'write'>(initial.ink.length && !initial.bodyText.trim() ? 'write' : 'type');
  const [saved, setSaved] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggest, setSuggest] = useState<{ speakers: string[]; churches: string[] }>({ speakers: [], churches: [] });
  // The details (title, type, date, speaker, location, review) can be folded into one line for more writing room.
  // It's remembered for every note.
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const setCollapsed = (c: boolean) => {
    setCollapsedState(c);
    try {
      localStorage.setItem(DETAILS_KEY, c ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  };

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
    extensions: [StarterKit.configure({ blockquote: false }), Quote, QuoteCite, Highlight],
    content: initial.bodyHtml,
    editorProps: { attributes: { class: 'prose', 'aria-label': 'Sermon notes' } },
    onUpdate: ({ editor }) => patch({ bodyHtml: editor.getHTML(), bodyText: editor.getText({ blockSeparator: '\n' }) }),
  });

  const insert = useCallback(
    (what: Insertion) => {
      if (!editor) return;
      if (what.kind === 'bible') {
        if (!what.refs.length) return;
        setMode('type');
        editor.chain().focus().insertContent(passageHtml(what.refs)).run();
        toast(`Added ${refsLabel(what.refs)} to note`);
      } else {
        if (!what.paragraphs.length) return;
        setMode('type');
        editor.chain().focus().insertContent(bookQuoteHtml(what.paragraphs, what.cite)).run();
        toast(`Added quote from ${what.cite} to note`);
      }
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
          <ActionIcon color="red" onClick={() => setConfirmDelete(true)} aria-label="Delete note">
            <Trash2 />
          </ActionIcon>
        </Tooltip>
        <ConfirmDialog
          opened={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          title="Delete this note?"
          confirmLabel="Delete note"
        >
          <Text fw={600} c="var(--mantine-color-text)" style={{ fontFamily: SERIF }} mb={4}>
            {noteTitle(noteRef.current)}
          </Text>
          It will be removed from this device for good. This can’t be undone.
        </ConfirmDialog>
      </header>

      {collapsed ? (
        <UnstyledButton className="meta meta-collapsed" onClick={() => setCollapsed(false)} aria-expanded={false} aria-label="Show note details">
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text fw={700} fz={20} truncate c={meta.title.trim() ? undefined : 'dimmed'}>
              {meta.title.trim() || 'Untitled'}
            </Text>
            <Group gap={6} wrap="nowrap" c="dimmed">
              {isStale({ ...noteRef.current, lastReviewedAt }, reviewEveryDays) && (
                <Tooltip label="Due for review">
                  <History size={14} color="var(--accent)" />
                </Tooltip>
              )}
              <Text size="sm" inherit truncate>
                {[kindLabel(kind), formatDate(meta.date), hasSpeaker(kind) && meta.speaker.trim(), hasSpeaker(kind) && meta.church.trim()]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Group>
          </div>
          <ChevronDown size={20} className="meta-toggle-icon" />
        </UnstyledButton>
      ) : (
      <div className="meta">
        <Group gap={4} wrap="nowrap" align="center">
          <TextInput
            variant="unstyled"
            size="xl"
            value={meta.title}
            onChange={(e) => setField('title', e.currentTarget.value)}
            placeholder="Title"
            aria-label="Title"
            classNames={{ input: 'title-input' }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Tooltip label="Hide details">
            <ActionIcon variant="subtle" color="gray" onClick={() => setCollapsed(true)} aria-expanded aria-label="Hide note details">
              <ChevronUp size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
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
        {/* Personal study is on your own: just a date, no speaker or location (any already typed are kept, hidden,
            in case the type is changed back). */}
        <div className={`meta-grid ${hasSpeaker(kind) ? '' : 'only-date'}`}>
          <FloatInput label="Date" type="date" alwaysFloat value={meta.date} onChange={(e) => setField('date', e.currentTarget.value)} />
          {hasSpeaker(kind) && (
            <>
              <FloatInput
                label="Speaker"
                value={meta.speaker}
                onChange={(e) => setField('speaker', e.currentTarget.value)}
                list="speakers"
              />
              <FloatInput label="Location" value={meta.church} onChange={(e) => setField('church', e.currentTarget.value)} list="churches" />
            </>
          )}
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
        <ReviewLine
          note={{ ...noteRef.current, lastReviewedAt }}
          everyDays={reviewEveryDays}
          onReviewed={() => {
            const now = Date.now();
            setLastReviewedAt(now);
            patch({ lastReviewedAt: now });
            toast('Marked as reviewed');
          }}
        />
      </div>
      )}

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
          </RichTextEditor.Toolbar>
          <div className="editor-scroll" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
            <RichTextEditor.Content />
          </div>
        </RichTextEditor>
      ) : (
        <InkPad initial={initial.ink} onChange={(ink: InkStroke[]) => patch({ ink })} />
      )}
    </section>
  );
}

/**
 * When the note was last reviewed, with a button to mark it reviewed now. A stale note gets a highlighted bar
 * ("It's been 4 months since you reviewed this note").
 */
function ReviewLine({ note, everyDays, onReviewed }: { note: Note; everyDays: number; onReviewed: () => void }) {
  const stale = isStale(note, everyDays);
  const when = reviewedAt(note);
  const reviewedToday = !!note.lastReviewedAt && timeAgo(note.lastReviewedAt) === 'today';
  return (
    <Group className={`review-line ${stale ? 'is-stale' : ''}`} gap="xs" wrap="wrap" justify="space-between" mt="xs" role="status">
      <Group gap={6} wrap="nowrap" c={stale ? undefined : 'dimmed'}>
        {stale ? <History size={16} /> : <CalendarCheck size={16} />}
        <Text size="sm" inherit fw={stale ? 600 : undefined}>
          {stale
            ? note.lastReviewedAt
              ? `It's been ${timeAgo(when).replace(/ ago$/, '')} since you reviewed this note`
              : `You haven't reviewed this note since it was written ${timeAgo(when)}`
            : note.lastReviewedAt
              ? `Last reviewed ${timeAgo(when)} (${new Date(when).toLocaleDateString(undefined, { dateStyle: 'medium' })})`
              : 'Not reviewed yet'}
        </Text>
      </Group>
      {reviewedToday ? (
        <Group gap={4} c="teal" wrap="nowrap">
          <Check size={16} />
          <Text size="sm" inherit fw={600}>
            Reviewed today
          </Text>
        </Group>
      ) : (
        <Button size="compact-sm" variant={stale ? 'filled' : 'light'} leftSection={<CalendarCheck size={14} />} onClick={onReviewed}>
          Mark as reviewed
        </Button>
      )}
    </Group>
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

  /** Every note, each as its own Word file or PDF, in one zip. */
  const runAll = (format: 'docx' | 'pdf') => async () => {
    const label = format === 'pdf' ? 'PDF export' : 'Word export';
    setBusy(label);
    try {
      // Save what's being typed first, so the open note goes in as it is now.
      await getNote();
      const count = await exportNotesZip(await db.notes.toArray(), format);
      toast(`Exported ${count} ${count === 1 ? 'note' : 'notes'} as ${format === 'pdf' ? 'PDFs' : 'Word documents'}`);
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
        <Menu.Label>Export all notes</Menu.Label>
        <Menu.Item leftSection={<FolderArchive size={18} />} onClick={runAll('docx')}>
          Word documents, in a zip
        </Menu.Item>
        <Menu.Item leftSection={<FolderArchive size={18} />} onClick={runAll('pdf')}>
          PDFs, in a zip
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
