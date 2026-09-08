# Credential storage and expiry (Chapter 30)

## Optional: carry encrypted credentials

For credentials, you can keep using a password manager and enter them separately in each application's settings. The kit also offers an encrypted store in `secrets/` if you want protected values to travel with the private hub.

Encryption makes those stored values unreadable without the correct phrase. Keep the phrase in your password manager, outside the hub. The separation matters: someone with both the store and the phrase can recover the credentials.

Use the installer's dedicated credential prompt on the first machine and its local phrase prompt on the other one. Keep the keys and phrase out of AI conversations.

Then test the application that needs the key. Getting a value into the encrypted file is one step. Getting it into a newly started program is another, and I once managed to do only the first.

## Check that a program receives the current key

I had stored a new key, saved the file and pushed it. Everything looked carefully arranged. In the next session, the service still had no usable key.

The store was correct. The final step had failed: handing its contents to programs on that computer. The error even claimed the encryption program was missing when it was installed in a location the process could not see.


Run the kit's check:

```
hub-check-keys
```

The check examines local storage, whether the store can be read with the phrase, and whether a fresh program receives the current values. It reports names, counts and dates rather than secrets. Read any failure carefully; seeing a variable's name doesn't tell you its value is correct.

That local check doesn't sign in to every service. Follow it with a read-only connection test for the service you need. A revoked key can travel perfectly between computers and still be refused at the other end.

## Record expiry accurately

API keys aren't the same as account sessions. Some keys work on several machines; some sessions refresh themselves and need a separate sign-in. Follow the provider's instructions for the credential you have. Don't assign everything a one-year life because that sounds orderly.

The kit reads known expiry dates from `secrets/expires.txt`. For a fictional service, a dated row has this shape:

```
EXAMPLE_API_KEY  2027-03-14  https://example.com/account/keys  # example service access; fictional date
```

Use a name, expiry date and renewal page you've verified. There is no secret value in this line. Write `never` only when you've checked that no expiry is set. An unknown date needs a different description.

When expiry is unknown, retain that uncertainty as a comment, for example:

```
# EXAMPLE_API_KEY: expiry unknown; check the service account page before assigning a renewal date.
```

The comment preserves what you don't know, without creating a deadline. Leave it uncertain until you can check; an invented date would only make the reminder confidently wrong.

A credential kept only in another local file can be identified with `NAME@/path/to/file`. The `@` tells the check where it belongs; it does not copy or validate the account session itself. Record only a verified expiry date for it.

## Renew the existing entry

The service may require you to sign in to create or approve a replacement. Let the assistant prepare the local steps and checks, then use the service's secure input flow.

```
I have replaced the credential for the service I name. Inspect the existing record and update its one entry in secrets/expires.txt. Do not append a duplicate. Record the verified expiry and renewal page, or preserve an explicit unknown state if the service does not establish a date. Keep credential values out of this file and out of chat.

Help me load the replacement through a masked local input or the existing encrypted store. Run hub-check-keys, then the service's read-only connection test without printing any credential. Update the existing tracked renewal after checking the evidence. Do not treat a newer file timestamp as successful renewal.
```


The deadline check from Chapter 27 reads those dated entries. Let it provide the reminder instead of adding another countdown to the brief. When you renew the credential, you'll have one date to keep consistent.
