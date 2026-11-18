export interface Book {
  /** 1-based canonical index (Genesis = 1, Revelation = 66). */
  id: number;
  name: string;
  short: string;
  testament: 'OT' | 'NT';
  /** Lower-case aliases accepted by the reference parser (spaces removed). */
  aliases: string[];
}

const raw: [string, string, string[]][] = [
  ['Genesis', 'Gen', ['ge', 'gn']],
  ['Exodus', 'Exod', ['ex', 'exo']],
  ['Leviticus', 'Lev', ['le', 'lv']],
  ['Numbers', 'Num', ['nu', 'nm', 'nb']],
  ['Deuteronomy', 'Deut', ['dt', 'deu']],
  ['Joshua', 'Josh', ['jos', 'jsh']],
  ['Judges', 'Judg', ['jdg', 'jg', 'jdgs']],
  ['Ruth', 'Ruth', ['rth', 'ru']],
  ['1 Samuel', '1 Sam', ['1sa', '1sm', 'isamuel', 'isam', 'firstsamuel']],
  ['2 Samuel', '2 Sam', ['2sa', '2sm', 'iisamuel', 'iisam', 'secondsamuel']],
  ['1 Kings', '1 Kgs', ['1ki', '1kin', 'ikings', 'iki', 'firstkings']],
  ['2 Kings', '2 Kgs', ['2ki', '2kin', 'iikings', 'iiki', 'secondkings']],
  ['1 Chronicles', '1 Chr', ['1ch', '1chron', 'ichronicles', 'ichr', 'firstchronicles']],
  ['2 Chronicles', '2 Chr', ['2ch', '2chron', 'iichronicles', 'iichr', 'secondchronicles']],
  ['Ezra', 'Ezra', ['ezr']],
  ['Nehemiah', 'Neh', ['ne']],
  ['Esther', 'Esth', ['est', 'es']],
  ['Job', 'Job', ['jb']],
  ['Psalms', 'Ps', ['psalm', 'psa', 'pss', 'psm']],
  ['Proverbs', 'Prov', ['pr', 'prv', 'pro']],
  ['Ecclesiastes', 'Eccl', ['ec', 'ecc', 'eccles', 'qoh']],
  ['Song of Solomon', 'Song', ['so', 'sos', 'songofsongs', 'canticles', 'sng']],
  ['Isaiah', 'Isa', ['is']],
  ['Jeremiah', 'Jer', ['je', 'jr']],
  ['Lamentations', 'Lam', ['la']],
  ['Ezekiel', 'Ezek', ['eze', 'ezk']],
  ['Daniel', 'Dan', ['da', 'dn']],
  ['Hosea', 'Hos', ['ho']],
  ['Joel', 'Joel', ['jl']],
  ['Amos', 'Amos', ['am']],
  ['Obadiah', 'Obad', ['ob', 'oba']],
  ['Jonah', 'Jonah', ['jnh', 'jon']],
  ['Micah', 'Mic', ['mc']],
  ['Nahum', 'Nah', ['na']],
  ['Habakkuk', 'Hab', ['hb']],
  ['Zephaniah', 'Zeph', ['zep', 'zp']],
  ['Haggai', 'Hag', ['hg']],
  ['Zechariah', 'Zech', ['zec', 'zc']],
  ['Malachi', 'Mal', ['ml']],
  ['Matthew', 'Matt', ['mt', 'mat']],
  ['Mark', 'Mark', ['mk', 'mrk', 'mr']],
  ['Luke', 'Luke', ['lk', 'luk']],
  ['John', 'John', ['jn', 'jhn', 'joh']],
  ['Acts', 'Acts', ['ac', 'act']],
  ['Romans', 'Rom', ['ro', 'rm']],
  ['1 Corinthians', '1 Cor', ['1co', 'icorinthians', 'icor', 'firstcorinthians']],
  ['2 Corinthians', '2 Cor', ['2co', 'iicorinthians', 'iicor', 'secondcorinthians']],
  ['Galatians', 'Gal', ['ga']],
  ['Ephesians', 'Eph', ['ephes']],
  ['Philippians', 'Phil', ['php', 'pp']],
  ['Colossians', 'Col', ['co']],
  ['1 Thessalonians', '1 Thess', ['1th', '1thes', 'ithessalonians', 'ithess', 'firstthessalonians']],
  ['2 Thessalonians', '2 Thess', ['2th', '2thes', 'iithessalonians', 'iithess', 'secondthessalonians']],
  ['1 Timothy', '1 Tim', ['1ti', 'itimothy', 'itim', 'firsttimothy']],
  ['2 Timothy', '2 Tim', ['2ti', 'iitimothy', 'iitim', 'secondtimothy']],
  ['Titus', 'Titus', ['tit', 'ti']],
  ['Philemon', 'Phlm', ['philem', 'phm', 'pm']],
  ['Hebrews', 'Heb', ['he']],
  ['James', 'Jas', ['jm', 'jam']],
  ['1 Peter', '1 Pet', ['1pe', '1pt', 'ipeter', 'ipet', 'firstpeter']],
  ['2 Peter', '2 Pet', ['2pe', '2pt', 'iipeter', 'iipet', 'secondpeter']],
  ['1 John', '1 John', ['1jn', '1jo', '1jhn', 'ijohn', 'ijn', 'firstjohn']],
  ['2 John', '2 John', ['2jn', '2jo', '2jhn', 'iijohn', 'iijn', 'secondjohn']],
  ['3 John', '3 John', ['3jn', '3jo', '3jhn', 'iiijohn', 'iiijn', 'thirdjohn']],
  ['Jude', 'Jude', ['jud', 'jd']],
  ['Revelation', 'Rev', ['re', 'revelations', 'revelationofjohn', 'apocalypse']],
];

export const BOOKS: Book[] = raw.map(([name, short, aliases], i) => ({
  id: i + 1,
  name,
  short,
  testament: i < 39 ? 'OT' : 'NT',
  aliases,
}));

const norm = (s: string) => s.toLowerCase().replace(/[\s.]/g, '');

const exact = new Map<string, Book>();
for (const b of BOOKS) {
  exact.set(norm(b.name), b);
  exact.set(norm(b.short), b);
  for (const a of b.aliases) exact.set(a, b);
}

/** Finds a book by full name, abbreviation, or unambiguous prefix (e.g. "Phili" → Philippians). */
export function findBook(input: string): Book | undefined {
  const key = norm(input);
  if (!key) return undefined;
  const hit = exact.get(key);
  if (hit) return hit;
  const matches = BOOKS.filter((b) => norm(b.name).startsWith(key));
  return matches.length === 1 ? matches[0] : undefined;
}

export const bookById = (id: number): Book => BOOKS[id - 1];
