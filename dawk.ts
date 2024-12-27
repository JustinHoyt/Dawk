#!/usr/bin/env -S deno run --allow-all

import { parseArgs } from "jsr:@std/cli";
import { TextDelimiterStream } from "jsr:@std/streams";

const args = parseArgs(Deno.args, {
  string: [
    "record_seperator",
    "field_seperator",
    "begin",
    "end",
  ],
  boolean: [
    "help",
    "print",
    "in_place",
  ],
  alias: {
    record_seperator: "r",
    field_seperator: "f",
    begin: "b",
    end: "e",
    help: "h",
    print: "p",
    in_place: "i",
  },
  default: {
    record_seperator: "\n",
    field_seperator: "\\s+",
    begin: "",
    end: "",
    print: false,
    help: false,
    in_place: false,
  },
});

if (args.help) {
  console.log(`
Usage:
  dawk [OPTIONS] [--] [<main-snippet>] [file1 file2 ...]

Description:
  \`dawk\`, (D)eno AWK, is a Deno-based utility that supports Perl and
  awk-style one-liners in JavaScript.

  You can provide three JavaScript snippets:
    - BEGIN snippet (run once at the beginning)
    - MAIN snippet (run once per input record)
    - END snippet (run once at the end)

  For each record, the record (minus any trailing record separator) is available
  to you in the \`R\` variable, while the split fields (split by the field
  separator) are available in the \`F\` array. You also get access to some
  globally accessible objects for convenience.

Positional Arguments:
  <main-snippet>      The JavaScript code to run for each record. If omitted,
                      you must specify at least \`--begin\` or \`--end\`.

Options:
  -b, --begin <code>           JavaScript snippet to run once before any data
                               is processed (BEGIN block).
  -e, --end <code>             JavaScript snippet to run once after all data
                               is processed (END block).
  -r, --record_seperator <sep> Pattern or string to treat as the boundary
                               between records. Default is '\\n'.
  -f, --field_seperator <sep>  Pattern or string for splitting records into
                               fields. Default is '\\s+' (whitespace).
  -p, --print                  If set, each record’s MAIN snippet will be
                               wrapped with \`return (...)\`. Any
                               non-null return value will be automatically
                               printed.
  -i, --in_place               Edit files in-place. The processed output
                               replaces the original file contents.
  -h, --help                   Show this help message and exit.

Variables & Objects available to your code:
  - \`R\`:  (R)ecord: The full text of the current record (string).
  - \`F\`:  (F)ield: An array of fields from splitting \`R\` by the field separator.
  - \`G\`:  (G)lobal: A shared global object for storing/retrieving user data
            across all records.
  - \`N\`:  (N)umber: A "default object" for auto-initializing numeric counters
            to 0. For example:
              \`cat nums.txt | dawk 'N.count++' -e 'log(N.count)'\`
            will count and print the number of lines in a file without
            needing to explicitly initialize the \`count\` property.
  - \`S\`:  (S)tring: A "default object" for strings. Accessing S.anyKey returns ''
            (empty string) initially.
  - \`A\`:  (A)rray: A "default object" for arrays. Accessing A.someKey returns []
            initially.
  - \`I\`:  (I)ndex: The zero-based index of the current record. First record is 0,
            second record is 1, and so on.
  - \`log(...vals)\`: Prints \`vals\` (joined by spaces) immediately, without
                    adding a newline unless you specify one.
  - \`say(...vals)\`: Like \`log\`, but automatically appends a newline.

Examples:

1) Print each record in uppercase:
   \`\`\`
     echo 'hello world' | dawk -p 'R.toUpperCase()'
     # OUTPUT
     HELLO WORLD
   \`\`\`
   This reads from stdin, transforms each line to uppercase, and prints it.

2) Show a BEGIN message, then print the line number and text for each record:
     \`\`\`
     echo 'hello world
     1 2 3
     lorem ipsum' | dawk -b 'say("=== Begin ===")' \\
        -p '(N.lineno++) + ": " + R' \\
        -e 'say("=== End ===")'

     # OUTPUT
     === Begin ===
     0: hello world
     1: 1 2 3
     2: lorem ipsum
     === End ===
     \`\`\`

   - The \`-b/--begin\` snippet runs first, setting \`N.lineno\` to 0 and printing
     "=== Begin ===".
   - The main snippet returns the line number plus the raw text of each record.
   - The \`-e/--end\` snippet prints "=== End ===".

3) Process a CSV file, summing the second column:
     \`\`\`
     echo 'heading1,heading2
     one,1
     two,2
     three,3' | dawk -f ',' \\
        'if (I>0) say(N.sum += +F[1])' \\
        -e 'say("Total: " + N.sum)'

     # OUTPUT
     1
     3
     6
     Total: 6
     \`\`\`
   - Splits on \`,\` for fields.
   - Skips the header row (I == 0).
   - In the main snippet, we parse the second column (\`F[1]\`) and
     sum it, printing the accumulated sum as it goes.
   - Finally, prints the sum at the end.

4) In-place modification: convert each line to lowercase in a file:
     \`\`\`
     dawk -i -p 'R.toLowerCase()' your_file.txt
     \`\`\`
   - Edits \`your_file.txt\` in-place, replacing its contents with the
     lowercase version of each line.

For more complex transformations, you can provide any valid JavaScript.
Remember that the \`-b/--begin\` and \`-e/--end\` snippets can do
anything from defining helper functions, to initializing data, to printing
summary data at the end.
`);
  Deno.exit(0);
}

class DefaultObject {
  constructor(defaultVal: () => unknown) {
    return new Proxy(Object.create(Object.prototype), {
      get(target, property) {
        if (Reflect.has(target, property)) return target[property];
        else return target[property] ??= defaultVal();
      },
    });
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Unescapes common backslash sequences so that
 * passing "-r '\n'" on the CLI becomes a real newline.
 */
function unescapeDelim<T>(val: T): T {
  if (isString(val)) {
    val.replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  return val as T;
}

const positional = args._.map(String); // force everything to string
const [mainSnippet = "", ...filePaths] = positional;

const beginSnippet = args.begin;
const endSnippet = args.end;

// If no code given at all, error out
if (!mainSnippet && !beginSnippet && !endSnippet) {
  console.error("Error: No snippets provided. Run with --help for usage.");
  Deno.exit(1);
}

type Logger = (...vals: unknown[]) => void;

// If -p/--print, wrap the user code in "return ( ... )" so we can print the result
const mainSnippetCode = args.print ? `return (${mainSnippet});` : mainSnippet;

type SnippetFunction = (
  G: Record<string, unknown>,
  N: DefaultObject,
  S: DefaultObject,
  A: DefaultObject,
  I: number,
  log: Logger,
  say: Logger,
  R: string,
  F: string[],
) => string | undefined;

// BEGIN snippet
const beginFunc = new Function(
  "G",
  "N",
  "S",
  "A",
  "I",
  "log",
  "say",
  "R",
  "F",
  beginSnippet,
) as SnippetFunction;

// MAIN (per-record) snippet
const mainFunc = new Function(
  "G",
  "N",
  "S",
  "A",
  "I",
  "log",
  "say",
  "R",
  "F",
  mainSnippetCode,
) as SnippetFunction;

// END snippet
const endFunc = new Function(
  "G",
  "N",
  "S",
  "A",
  "I",
  "log",
  "say",
  "R",
  "F",
  endSnippet,
) as SnippetFunction;

async function processStream(
  reader: ReadableStream<Uint8Array>,
  fieldRegex: RegExp,
  recordSep: string,
  log: Logger,
  say: Logger,
  G: Record<string, unknown>,
  N: DefaultObject,
  S: DefaultObject,
  A: DefaultObject,
  I = 0,
): Promise<void> {
  function processRecord(record: string): void {
    if (record !== null) {
      const F = record.split(fieldRegex).filter((f) => f !== "");

      const ret = mainFunc(
        G,
        N,
        S,
        A,
        I++,
        log,
        say,
        record,
        F,
      );

      if (args.print && ret != null) say(ret);
    }
  }

  let lastRecord: string | null = null;

  const textStream = reader
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextDelimiterStream(recordSep));

  for await (const thisRecord of textStream) {
    if (lastRecord !== null) {
      processRecord(lastRecord);
    }
    lastRecord = thisRecord;
  }

  // process final record if non-empty
  if (lastRecord && lastRecord.trim() !== "") {
    processRecord(lastRecord);
  }
}

const encoder = new TextEncoder();
// Global objects that are accessible across record iterations
const G: Record<string, unknown> = {};
// Default objects that will create an instance of the default value if the
// property accessed is undefined
const N = new DefaultObject(() => 0);
const S = new DefaultObject(() => "");
const A = new DefaultObject(() => []);

function inPlaceLogger(path: string) {
  return (...vals: unknown[]) => {
    const tmpFile = Deno.openSync(`${path}.tmp`, {
      write: true,
      create: true,
      append: true,
    });
    const writer = tmpFile.writable.getWriter();
    writer.ready;
    writer.write(encoder.encode(unescapeDelim(vals.join(" "))));
  };
}

function logStdout(...vals: unknown[]) {
  return Deno.writeFileSync(
    "/dev/stdout",
    encoder.encode(unescapeDelim(vals.join(" "))),
  );
}

// Log with a newline at the end of the record
const say = (logger: Logger): Logger => (...vals: unknown[]) =>
  logger(...vals, "\n");
// Run BEGIN snippet (once)
beginFunc(G, N, S, A, -1, logStdout, say(logStdout), "", []);

const recordSep = unescapeDelim(args.record_seperator);
const fieldSep = new RegExp(args.field_seperator);
// If no files, read from stdin
if (filePaths.length === 0) filePaths.push("/dev/stdin");

for (const path of filePaths) {
  const file = await Deno.open(path, { read: true });
  const log: Logger = args.in_place ? inPlaceLogger(path) : logStdout;

  await processStream(
    file.readable,
    fieldSep,
    recordSep,
    log,
    say(log),
    G,
    N,
    S,
    A,
  );

  if (args.in_place) Deno.renameSync(`${path}.tmp`, path);
}

// Run END snippet (once)
endFunc(G, N, S, A, -1, logStdout, say(logStdout), "", []);
