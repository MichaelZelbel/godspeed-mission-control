# 3. Import your number into ElevenLabs

ElevenLabs has to know which line to call from. You give it the Twilio account and your
verified number once; from then on the agent dials through it.

Checked in September 2026.

1. In ElevenLabs, open **Agents**, then **Phone numbers** (or
   https://elevenlabs.io/app/agents/phone-numbers).
2. **Import number** and choose **Twilio**.
3. Fill in:
   - **Label**: anything, for example `My mobile`.
   - **Phone number**: your verified mobile number in international form, exactly as it
     appears under Twilio's Verified Caller IDs.
   - **Twilio Account SID** and **Auth Token** from the Twilio console home page.
4. If the dialog offers inbound SMS or inbound calls, leave them off. This add-on only makes
   outgoing calls; your phone keeps receiving its own calls as before.
5. Save. The number appears in the list with an id that starts with `phnum_`.

That is what the installer looks for. When exactly one number is imported, it uses that one
without asking. With several, it shows the list and asks for the `phnum_` id.

You do not need to attach the number to the agent by hand; each call names both.
