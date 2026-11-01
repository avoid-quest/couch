# Look after the Couch

Status: preview · Scenes: admin

I'm the admin. I see who's paired, give admin to someone else, forget a lost
phone, and get back in if no admin is left.

## Journey

1. **Settings → Devices & network**: every paired device, **Pair a device**.
2. A device's menu: **Make admin**, **Remove admin**, **Forget**
   (**Forget all** for older duplicates).
3. Network: **Share on network**, **Allow HTTP connections**, **Network
   address**; for sharing across networks, **Run relay on <Couch>** and **Check
   relay**.
4. With no admin left, the Couch computer shows **Make a device the admin**; a
   paired device enters the **Admin code** → **Become admin**.

## Done when

- Only admins see pairing codes, change roles, forget devices or change the
  Couch's settings; others see **Only an admin can change this.**
- A forgotten device loses access at once.
- Turning sharing off and on keeps every pairing.

## Demo

Needs: the Couch computer and two phones.

## Known issues

- Recovering admin access without the Couch computer's screen needs a restart
  with `COUCH_ADMIN_RECOVERY_CODE`.
