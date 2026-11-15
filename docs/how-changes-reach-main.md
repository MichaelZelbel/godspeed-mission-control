# How a change reaches main

Main changes only through a pull request whose `required` check passed. Nobody pushes to main.

1. **Issue.** Work starts as a GitHub issue that says the problem, why it matters, the outcome and how to tell it is done.
2. **Archon.** Archon takes the issue in at intake, the build queue builds it on a branch and opens the pull request, and the merge queue merges it once the pull request is ready.
3. **Review.** Archon reviews the pull request and stamps its verdict in one comment. Its first line is `<!-- archon-review-report -->`, its second is `` Reviewed commit: `<newest commit sha>` ``, and it then says `Verdict: ready`.
4. **Who may write the verdict.** Only a login listed in `.archon/sdlc/policy/maintainers.json` on main. A verdict from anyone else, or a second verdict comment, counts as none.
5. **Release step.** Pull requests made by the release step are approved by the release App, which is one of the reviewers in the repository variable `REQUIRED_REVIEWERS`.
6. **The factory's own pull requests.** A pull request opened by the factory's builder App (`godspeed-dev-builder[bot]`) from a branch of this repository needs no review comment: Cole Medin's `archon-loop` reviews it, and its land step merges it with `gh pr merge --squash --match-head-commit <reviewed sha>`. `required` passes for it once every other check on its newest commit passed; a `Loop review:` comment, including `not merged`, changes nothing.
7. **Hand-made pull request.** If you open one yourself, `required` passes only when its newest commit has one of these: the marked verdict from a listed maintainer, the newest `Loop review:` comment from a listed maintainer saying approved or merging with a line `` Reviewed head `<newest commit sha>` ``, or approval by the reviewers in `REQUIRED_REVIEWERS`. For that route only each listed reviewer's latest review counts: at least one must approve and none may request changes, so a later comment replaces that reviewer's earlier approval.
