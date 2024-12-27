Usage: dawk [OPTIONS] [--] [\<main-snippet\>] [file1 file2 ...]

Description: `dawk`, (D)eno AWK, is a Deno-based utility that supports Perl and
awk-style one-liners in JavaScript.

You can provide three JavaScript snippets: - BEGIN snippet (run once at the
beginning) - MAIN snippet (run once per input record) - END snippet (run once at
the end)

For each record, the record (minus any trailing record separator) is available
to you in the `R` variable, while the split fields (split by the field
separator) are available in the `F` array. You also get access to some globally
accessible objects for convenience.

```
Positional Arguments: <main-snippet> The JavaScript code to run for each
record. If omitted, you must specify at least `--begin` or `--end`.

Options:
  -b, --begin <code>           JavaScript snippet to run once before any data
                               is processed (BEGIN block).
  -e, --end <code>             JavaScript snippet to run once after all data
                               is processed (END block).
  -r, --record_seperator <sep> Pattern or string to treat as the boundary
                               between records. Default is '\n'.
  -f, --field_seperator <sep>  Pattern or string for splitting records into
                               fields. Default is '\s+' (whitespace).
  -p, --print                  If set, each record’s MAIN snippet will be
                               wrapped with `return (...)`. Any
                               non-null return value will be automatically
                               printed.
  -i, --in_place               Edit files in-place. The processed output
                               replaces the original file contents.
  -h, --help                   Show this help message and exit.

Variables & Objects available to your code:

  - `R`:  (R)ecord: The full text of the current record (string).
  - `F`:  (F)ield: An array of fields from splitting `R` by the field separator.
  - `G`:  (G)lobal: A shared global object for storing/retrieving user data
            across all records.
  - `N`:  (N)umber: A "default object" for auto-initializing numeric counters
            to 0. For example:
              `cat nums.txt | dawk 'N.count++' -e 'log(N.count)'`
            will count and print the number of lines in a file without
            needing to explicitly initialize the `count` property.
  - `S`:  (S)tring: A "default object" for strings. Accessing S.anyKey returns ''
            (empty string) initially.
  - `A`:  (A)rray: A "default object" for arrays. Accessing A.someKey returns []
            initially.
  - `I`:  (I)ndex: The zero-based index of the current record. First record is 0,
            second record is 1, and so on.
  - `log(...vals)`: Prints `vals` (joined by spaces) immediately, without
                    adding a newline unless you specify one.
  - `say(...vals)`: Like `log`, but automatically appends a newline.
```

Examples:

1. Print each record in uppercase:

   ```bash
   echo 'hello world' | dawk -p 'R.toUpperCase()'

   # OUTPUT
   HELLO WORLD
   ```

   - This reads from stdin, transforms each line to uppercase, and prints it.

2. Show a BEGIN message, then print the line number and text for each record:

   ```bash
   echo 'hello world
   1 2 3
   lorem ipsum' | dawk -b 'say("=== Begin ===")' \
      -p '(N.lineno++) + ": " + R' \
      -e 'say("=== End ===")'

   # OUTPUT
   === Begin ===
   0: hello world
   1: 1 2 3
   2: lorem ipsum
   === End ===
   ```

   - The `-b/--begin` snippet runs first, setting `N.lineno` to 0 and printing
     "=== Begin ===".
   - The main snippet returns the line number plus the raw text of each record.
   - The `-e/--end` snippet prints "=== End ===".

3. Process a CSV file, summing the second column:

   ```bash
   echo 'heading1,heading2
   one,1
   two,2
   three,3' | dawk -f ',' \
      'if (I>0) say(N.sum += +F[1])' \
      -e 'say("Total: " + N.sum)'

   # OUTPUT
   1
   3
   6
   Total: 6
   ```

   - Splits on `,` for fields.
   - Skips the header row (I == 0).
   - In the main snippet, we parse the second column (`F[1]`) and sum it,
     printing the accumulated sum as it goes.
   - Finally, prints the sum at the end.

4. In-place modification: convert each line to lowercase in a file:

   ```bash
   dawk -i -p 'R.toLowerCase()' your_file.txt
   ```

   - Edits `your_file.txt` in-place, replacing its contents with the lowercase
     version of each line.

For more complex transformations, you can provide any valid JavaScript. Remember
that the `-b/--begin` and `-e/--end` snippets can do anything from defining
helper functions, to initializing data, to printing summary data at the end.
