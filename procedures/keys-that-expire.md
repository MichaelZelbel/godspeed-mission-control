# Credential storage and expiry (Chapter 30)

## Optional: carry encrypted credentials

A credential can live in your password manager, entered separately into each application's settings. The kit also supports an encrypted store in `secrets/`, allowing protected values to travel with the private hub.

Encryption turns the stored values into unreadable data until the correct unlock phrase is supplied. Keep that phrase in your password manager, outside the hub. Anyone who obtains both the encrypted store and the phrase can obtain the credentials.

On the first machine, follow the installer's dedicated credential prompt. On another machine, unlock through its local prompt. Do not paste keys or the phrase into an AI conversation.

Then test the receiving application. A key being present in the encrypted file does not mean a newly started program received it.

## Check that a program receives the current key

This distinction once cost me a careful but useless setup. I stored a new key, saved the file and pushed it. In the next session, the service still had no usable key.

The store was correct. The final step had failed: handing its contents to programs on that computer. The error even claimed the encryption program was missing when it was installed in a location the process could not see.


Run the kit's check:

```
hub-check-keys
```

It checks local storage, unlocking and whether a fresh program receives the current values. Its report uses names, counts and dates, not the credential values. Read failures rather than treating a named variable as proof of the right value.

This local check is not a login attempt to every service. Follow it with a read-only connection test for the service you need. A revoked key can be correctly loaded and still be refused.

## Record expiry accurately

API keys and account sessions are different. Some keys can be used on several machines. Some account sessions refresh themselves and should be signed in separately. Follow the provider's actual instructions; there is no universal one-year lifetime.

The kit reads known expiry dates from `secrets/expires.txt`. For a fictional service, a dated row has this shape:

```
EXAMPLE_API_KEY  2027-03-14  https://example.com/account/keys  # example service access; fictional date
```

Replace the name, date and renewal page with verified values. The line contains no secret value. `never` means you checked that the credential has no set expiry. It must not mean “I do not know.”

When expiry is unknown, retain that uncertainty as a comment, for example:

```
# EXAMPLE_API_KEY: expiry unknown; check the service account page before assigning a renewal date.
```

That comment does not create a deadline. Do not invent a date merely to make the tool quiet.

A credential kept only in another local file can be identified with `NAME@/path/to/file`. The `@` tells the check where it belongs; it does not copy or validate the account session itself. Record only a verified expiry date for it.

## Renew the existing entry

The service may require you to sign in to create or approve a replacement. Let the assistant prepare the local steps and checks, then use the service's secure input flow.

```
I have replaced the credential for the service I name. Inspect the existing record and update its one entry in secrets/expires.txt. Do not append a duplicate. Record the verified expiry and renewal page, or preserve an explicit unknown state if the service does not establish a date. Keep credential values out of this file and out of chat.

Help me load the replacement through a masked local input or the existing encrypted store. Run hub-check-keys, then the service's read-only connection test without printing any credential. Update the existing tracked renewal after checking the evidence. Do not treat a newer file timestamp as successful renewal.
```


Chapter 27's deadline cycle reads the dated source. Do not add another countdown to the brief. One changed credential should not produce two inconsistent reminders.
