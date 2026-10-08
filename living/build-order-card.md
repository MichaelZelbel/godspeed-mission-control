# The Build Order (Appendix C)

If you've set the book aside for a while, this list will help you find your place. Look for the result you last checked.

Tick each chapter when its result works. If you fall off, do not restart: resume where you
stopped. Each line names the kit files that chapter uses.

## Part I: Start With Something That Matters

- [ ] Chapter 1: Make Your AI Briefing From What It Already Knows. Kit:
      `profile/bring-your-context-with-you.md`; fallback `profile/about-you-template.md`.
- [ ] Chapter 2: Set Up Godspeed Mission Control. Kit: the installer for your route
      (`docker/install.sh` on a server, `GodspeedSetup.exe` on Windows, `install-godspeed.sh`
      on a Mac).
- [ ] Chapter 3: Get Useful Work Done on Your First Day. No kit file.
- [ ] Chapter 4: Your Files Are the Originals. Kit: `starter-godspeed/`; the filing
      request is Step 4 of `profile/bring-your-context-with-you.md`.
- [ ] Chapter 5: Let It Check In With You. No kit file: talks are built in.

## Part II: Give It Useful Background

- [ ] Chapter 6: The People Who Matter. Kit: `profile/people-interview.md`.
- [ ] Chapter 7: Priorities Across Your Life. Kit: `profile/projects-interview.md`.
- [ ] Chapter 8: Give Mission Control a Goal, Then Let It Work. Kit:
      `starter-godspeed/goals/`, `starter-godspeed/forecasts/`, `starter-godspeed/work/`,
      `starter-godspeed/skills/next-action/` and `starter-godspeed/skills/work-item/`.
- [ ] Chapter 9: Teach AI Your Writing Style. Kit: `profile/voice-extraction-prompt.md`.
- [ ] Chapter 10: Tell Mission Control Once, Let It Remember. Kit:
      `profile/capture-checklist.md`.
- [ ] Chapter 11: Let Mission Control Keep Up With Your Life. Kit: `profile/mirror-test.md`
      and `profile/spring-clean-checklist.md`.
- [ ] Chapter 12: Correct AI Without the Argument. No kit file.
- [ ] Chapter 13: Your Notebook: Notes, People and What It Noticed. Kit:
      `starter-godspeed/skills/keep-a-note/`; moving your notes from Menerio:
      `docs/menerio-migration.md`.
- [ ] Chapter 14: Collections, the Timeline and the World. No kit file;
      `starter-godspeed/world/README.md` explains how the world is kept.

## Part III: Teach AI Repeated Jobs

- [ ] Chapter 15: Save a Repeated Job as an AI Skill. Kit: `skills/summarize-for-me.md` and
      `skills/practice-texts.md`.
- [ ] Chapter 16: Make an AI Skill Work Your Way. Kit: `skills/skill-interview.md` and
      `living/saved-prompt-card.md`.
- [ ] Chapter 17: Skills for Email, Planning, Conversations and Decisions. Kit:
      `skills/first-five-skills.md` and `skills/prepare-a-decision/SKILL.md`.
- [ ] Chapter 18: Create Skills for Your Own Work. Kit: `skills/craft-skill-interview.md`.
- [ ] Chapter 19: Check That Your AI Skills Work. Kit: `skills/skill-test-checklist.md`.

## Part IV: Set Limits and Check the Work

- [ ] Chapter 20: Set Limits on What AI May Do. Kit: `procedures/red-lines-interview.md`
      and `procedures/red-lines-template.md`.
- [ ] Chapter 21: Back Up Your Mission Control and Undo Mistakes. Kit:
      `procedures/safety-net-setup.md`.
- [ ] Chapter 22: Check Where Your Private Information Goes. Kit:
      `living/privacy-audit-checklist.md`.
- [ ] Chapter 23: Check AI's Answers Before You Act. Kit: `living/two-questions-card.md`
      and `living/the-alternatives-card.md`.

## Part V: Have Work Ready When You Return

- [ ] Chapter 24: See and Change What Runs on Its Own. Kit: `procedures/where-it-runs.md`
      and `procedures/procedure-register.md`.
- [ ] Chapter 25: The Morning Brief. Kit: `starter-godspeed/skills/morning-brief/` and
      `procedures/where-it-runs.md`; `procedures/morning-brief-setup.md` to build your own
      brief by hand, and `practice/maintenance-classes/`, Robin's made-up files.
- [ ] Chapter 26: Let AI Investigate a Question While You Are Away. No kit file.
- [ ] Chapter 27: Set Up an Automatic Weekly Review. Kit:
      `procedures/weekly-review-setup.md`, `procedures/outside-ai-check.md` and
      `procedures/ai-subscription-review.md`.
- [ ] Chapter 28: Get Alerts When a Page or Product Changes. Kit:
      `procedures/watchdog-setup.md`.
- [ ] Chapter 29: Keep Researching a Question Over Time. Kit:
      `procedures/research-watch-setup.md` and `skills/research-watch/SKILL.md`.
- [ ] Chapter 30: Track Deadlines Until the Work Is Done. Kit: `tools/due.js`, installed
      as `mc-due`, and `procedures/what-runs-out-and-when.md`.

## Part VI: Add What You Need

- [ ] Chapter 31, optional: Give Your Mission Control Its Own Email Address. Kit:
      `mail/README.md`, `mail/mc-address.md` and `tools/mc-mail.js`, installed as `mc-mail`.
- [ ] Chapter 32, optional: Let Your Mission Control Read Your Mail. Kit: `mail/README.md`,
      `mc-mail` with `tools/mc-mail-imap.js`, and `starter-godspeed/skills/connect-email/`.
- [ ] Chapter 33, optional: Use Your Mission Control on Several Devices. Kit: the
      installer from Chapter 2.
- [ ] Chapter 34, optional: Look After Your Server. No kit file. `server/` shows how to
      build a server by hand, for the curious.
- [ ] Chapter 35, optional: Let Your Mission Control Make a Phone Call for You. Not in the
      kit: the `mc-phone` add-on at https://github.com/MichaelZelbel/mc-phone.
- [ ] Chapter 36, optional: Let Your Mission Control Finish Your Videos. Not in the kit:
      the `mc-video` add-on at https://github.com/MichaelZelbel/mc-video.
- [ ] Chapter 37, optional: Try Your Mission Control With Another AI Assistant. Kit:
      `swap/opencode.json`, `swap/three-questions.md` and `swap/openrouter-notes.md`.
- [ ] Chapter 38, optional: Reach and Share Your Saved Prompts Online. Kit:
      `living/saved-prompt-card.md` and the README files under `starter-godspeed/prompts/`.
- [ ] Chapter 39, optional: Coaching in Depth: Areas, Styles and Habits. No kit file:
      talks and habits are built in.
- [ ] Chapter 40, optional: Use Your Mission Control for Coding Projects. Kit:
      `coding/project-setup.md`, `starter-godspeed/dev/README.md` and
      `starter-godspeed/.gitignore`.

## Closing

- [ ] Chapter 41: Keep the Jobs That Move Your Life Forward. No new kit file: your mission
      control's `procedures.md` and `decisions.md`.
