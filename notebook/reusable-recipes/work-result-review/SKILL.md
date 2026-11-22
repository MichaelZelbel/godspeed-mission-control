---
name: work-result-review
description: Independently compare one finished file with its work item's DONE WHEN. Run by mc-work-run, never by hand.
---

Read the exact RESULT FILE named after this recipe and the complete work card above it. Compare the
file's actual content with every requirement in DONE WHEN. The earlier runner's RESULT may help locate
the result, but it is not evidence that any requirement was met.

Do not edit anything, run an outward action, or improve the result. Judge only the named file. A shell
check passing is not enough when it proves only size, headings, or shape. Say which content requirement
is absent or unusable in terms a person can act on.

Return only one JSON object, with no Markdown fence or extra text:

    {"passed":true,"reason":"every DONE WHEN requirement found in the file","missing":[]}

or:

    {"passed":false,"reason":"the result does not meet DONE WHEN","missing":["one concrete missing requirement"]}

`passed` is a boolean, `reason` is a non-empty string, and `missing` is an array of non-empty strings.
A failed verdict names at least one missing requirement. A passing verdict has an empty array.
