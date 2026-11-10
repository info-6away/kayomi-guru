# Koyomi for AI assistants: public release readiness

Status on 10 November 2026. Private acceptance passed in ChatGPT, Claude and Grok on Production
([MCP.md, Part 4](MCP.md#part-4-private-acceptance-on-production-810-november-2026)). AI access
is still a private beta: `KOYOMI_MCP=on` with one person on `KOYOMI_MCP_ALLOWLIST`, Production
only. Nothing has been submitted to any directory.

This document is the audit and plan for opening it to the public. It changes nothing. Every
platform requirement below was read from the platforms' own pages on 10 November 2026. Each
must be read again just before submitting.

Severity in the tables:

- **Blocker**: must be done before anyone outside the allowlist can use AI access.
- **Before listing**: needed for a directory submission.
- **Later**: worth doing, but not needed to open.

---

## 1. Public readiness audit

| Area | Today | Gap | Recommendation | Severity |
| --- | --- | --- | --- | --- |
| Allowlist | Exact 6Away subjects in `KOYOMI_MCP_ALLOWLIST`, Production only; unset or empty means nobody; checked at every step | The only ways to open it are listing every subject, or unsetting it, which closes it | Keep "unset = nobody". Add an explicit, separate setting for "everyone" in a reviewed PR, so opening and closing stay one setting each. Until then, add people (reviewers first) by subject | Blocker |
| Onboarding, new person | Assistant → Koyomi sign-in (6Away, sign-up open) → consent page | A person with no calendars sees "Connect one in Koyomi first, then connect the assistant again", with no link. The consent request lasts 10 minutes | Link to Calendars from that message, and say plainly that they come back to the assistant afterwards. Optionally keep the request, so connecting a calendar returns them to consent | Blocker |
| Authentication | 6Away sign-in, then Koyomi's session cookie on `app.koyomi.guru` | The consent page does not say which 6Away account is signed in. During acceptance, a browser signed in to another 6Away account was refused, and nothing said why | Show "Signed in as …" with a way to switch account on the consent page, shown only to that person | Blocker |
| First calendar | Google, Microsoft, Yahoo and calendar links are live | **Google:** Koyomi's Google app is in "Testing", so only listed test users (100 at most) can connect, and Google ends their grants after 7 days. **Microsoft:** work and school accounts need their admin's approval (no publisher verification). **Yahoo:** an app password. **Links:** none | Google needs verification and "In production" (section 2). State Microsoft's admin approval in the help page. Calendar links are the one provider with no outside gate | Blocker (Google) |
| AI authorization | Consent lists the person's calendars, none ticked, Allow disabled until one is ticked; read-only; revocable | No mention of AI training; Google's Workspace policy wants a plain statement next to the consent (section 2) | Add a training notice and a link to the updated Privacy section to the consent page; make Allow the affirmative consent to it | Blocker |
| Calendar selection | Per grant, on the consent page | No editing in place; changing calendars means connecting again | A "Change calendars" action in AI access, reusing the consent page | Later |
| Revocation | Revoke in Koyomi (Calendars → AI access) ends the grant at its next request | Disconnecting inside Claude or Grok does not revoke at Koyomi. AI access shows only where the device has the person's calendars, so a signed-in phone with no copy cannot revoke | Show AI access to any signed-in person, from the server's list. Say in the help page and on consent that revoking happens in Koyomi | Blocker |
| OAuth clients | CIMD (ChatGPT, Claude) and open DCR (Grok, Grok Bot, others); public clients only; unused registrations pruned after 7 days, idle ones after 90 | DCR is limited to 60 a minute **per server instance, for everyone**. One caller can use it up, and many instances multiply it. Grok makes a client per connection, Grok Bot three | Per-address limit on `/api/oauth/register` (a Vercel Firewall rate-limit rule needs no code), plus a cap on total live registrations, and a watch on `ai_clients` | Blocker |
| Rate limits | 30 calls a minute per grant (database, all instances); 300 a minute **per client id per instance** (memory); 120 provider units a minute per connection (database) | ChatGPT and Claude each use **one client id for all their users**. In public, 300 a minute per instance is shared by everyone using that assistant, so one busy person can throttle others | Drop the per-client cap, or make it far higher and per grant; keep the per-grant and per-connection limits; add a per-address Firewall rule on `/mcp` | Blocker |
| Quotas | Google Calendar API quota on project `koyomi-511111`; Graph and Yahoo throttle per app or account | Not measured. AI questions add reads on top of the app's | Read the project's Calendar API quota page before opening; alert on 429s in the `[mcp]` outcomes (`failed:` and `incomplete`) | Before listing |
| Costs | Vercel Pro (Fluid compute); Neon free plan | Every tool call is a function invocation and at least one database write (the grant allowance). Tokens refresh every 15 minutes of use. On the free plan the database's compute allowance is the first ceiling | Move Neon to a paid plan before opening. Watch Vercel usage per route (`/mcp`, `/api/oauth/token`) for the first weeks | Before listing |
| Privacy and Terms | AI section on Privacy; two sentences in Terms; dated 8 November 2026 | One sentence says the assistant's company's use of the data, "including whether it uses them to train its models", is governed by its own terms. Google's Workspace policy forbids transfers for training non-personalized models, so the page must say Koyomi does not allow it, and what the person can do | Rewrite per section 2; add the Workspace Limited Use sentence and Google's AI statement | Blocker |
| Support | A contact address on Privacy and Terms | No public page about connecting an assistant, revoking, or getting help. Claude's directory needs public documentation, and ChatGPT a support URL | A public help page on `koyomi.guru` (section 6 has the text). A dedicated support address is worth having | Before listing |
| Domain verification (ChatGPT) | None | ChatGPT verifies a domain with a token served at `/.well-known/openai-apps-challenge` | A small route on `app.koyomi.guru`, added when the token is issued | Before listing (ChatGPT) |
| Labels | ChatGPT, Claude and Grok are named; anything else is "Other MCP client (host)" | Grok Bot shows as "Other MCP client (www.cursor.com)" | Keep host-based names (they cannot be spoofed by a registration's name), and explain "www.cursor.com" in the help page. A "Cursor" label is only right if Cursor itself is a target | Later |

What is already ready:

- read-only tools with titles and annotations;
- PKCE S256, `resource` and `iss`;
- refresh rotation with reuse detection;
- RFC 7009 revocation;
- per-grant handles;
- answers capped at 500 items, with `truncated`;
- `complete`, `unavailable` and `partly_read` stated plainly;
- hostile titles returned as data;
- logs that hold outcomes only;
- the AI tables holding no event content;
- Privacy, Terms and consent wording about AI;
- the allowlist refusing everyone else at every step.

---

## 2. Google compliance

### Where verification stands (from the project's own records)

These records were last updated in October 2026. The live Google Cloud console was not read for
this document: it needs the owner's sign-in.

- Project `koyomi-511111`, audience External, publishing status **Testing**, 100 test users at
  most.
- Scopes: `calendar.calendarlist.readonly` (non-sensitive) and `calendar.events.readonly`
  (**sensitive**). One web client, whose only redirect is
  `https://app.koyomi.guru/api/google/callback`.
- Verification has been submitted. On 14 October 2026 Google's review asked Privacy to explain
  how sensitive data is protected. "How your Google data is protected" was added and went live
  the same day.
- Still with the owner: resubmission, and a new demo video. The submitted video shows the old
  interface.
- AI access did not exist when the scopes were justified and the demo was recorded.

**Read the console before acting:** Google Auth Platform → Verification Center and Audience.
They show whether the project is still in Testing, whether the review is open, and any new
message from Google.

### The existing approval versus what AI access adds

| | Calendar in Koyomi (submitted) | AI access (new) |
| --- | --- | --- |
| Scopes | the two above | **the same two: no new scope, no new redirect, no consent-screen change** |
| Where data goes | Google → Koyomi's server → the person's own device | Google → Koyomi's server → **an AI company the person chose** |
| Under Limited Use | a user-facing feature, prominent in the app | a **transfer to a third party**: allowed only for a user-facing feature that is visible and prominent in the app, and only with the person's consent (User Data Policy) |
| AI and ML | none | Workspace policy: data may not be transferred or used to create, train or improve any model beyond that one person's personalized model. Google's FAQ rules out foundational and frontier models by name |
| Disclosure | Privacy | Privacy **and** an in-product disclosure placed with, and immediately before, the consent, which takes an affirmative action |
| New use | n/a | before data is used in a new way, people are told and asked to consent to an updated privacy policy (User Data Policy) |

No new scope means Google's listed re-verification triggers are not met. But AI access is a new
purpose for data covered by a pending verification. No Google page says whether a person's own
assistant pulling data over MCP counts as Koyomi's transfer. Nor does any page say whether Koyomi
must make sure the assistant does not train on it. Read literally, that risk is Koyomi's.

### Limited Use check of Koyomi today

| Requirement | Koyomi | State |
| --- | --- | --- |
| Use only for prominent user-facing features | AI access is in Calendars, and on its own consent page | met |
| Transfer only with consent, for the user-facing feature | per calendar, per assistant, ticked by the person, revocable | met |
| No ads, data brokers, resale, credit | none, and Privacy says so | met |
| No humans reading the data | none; logs hold outcomes only | met |
| No training of non-personalized models, transfers included | Koyomi trains nothing. Privacy leaves the assistant's training to "its own privacy policy and terms" | **not met as written** |
| Privacy names who receives data | AI assistants named as a category, chosen by the person | met; name the three when listed |
| Limited Use statement | present, in its User Data Policy form | add the Workspace form too |
| In-product disclosure before consent | consent page says read-only, what is sent, revocable | **add training and a Privacy link** |
| Re-consent for a new use | each assistant has its own consent, made after the AI section was published | met for AI grants; existing Google connections need no change |
| Prompt-injection protection (Workspace security text, possibly only for restricted scopes) | titles returned as data, the server's instructions say so, each answer carries a notice, no write tools | met in substance; document it |

### Recommendations

1. **Privacy.** Replace the sentence about the assistant's own training. Say that Koyomi sends
   Google data to an assistant only to answer that person's request, and that Koyomi does not
   allow it to be used to train non-personalized AI or ML models. Point people to their
   assistant's setting for turning off training. Add Google's statement in its words: "Google
   Workspace APIs are not used to develop, improve, or train non-personalized AI and/or ML
   models". Add the Workspace Limited Use sentence next to the existing one.
2. **Consent page.** One plain line on training and a link to Privacy. Say that the assistant
   reads whenever it calls Koyomi, until access is revoked.
3. **Verification.** Fold AI access into the pending resubmission. Add a sentence to the scope
   justification for `calendar.events.readonly`, and a segment to the demo video: the AI consent
   page, the chosen calendars, an answer, then Revoke. Then ask the review thread to confirm.
   This is the release gate in MCP.md.
4. **Before Google confirms**, open AI access publicly only with Google calendars left out of the
   consent page for people not on the allowlist (a small code change), or do not open at all.
   Microsoft, Yahoo and calendar links are under no Google rule.
5. **Publishing status.** After verification, switch to "In production". In Testing, every
   Google grant ends after 7 days, and that applies to a reviewer account too.
6. **Change nothing on the Google OAuth client** for this: no scope, redirect or origin.
7. Keep the tools narrow and per person. Koyomi is not a general Calendar API proxy (Google APIs
   Terms §4a).

None of this is legal advice. Google's answer in the review thread is the confirmation.

---

## 3. Platform submission checklists

Nothing below has been submitted. Each item says whether Koyomi already has it.

### ChatGPT (OpenAI)

- [ ] OpenAI platform account verified, individual or business. The business is 6Away.
- [ ] Package (a ZIP) with the plugin manifest and MCP configuration, in OpenAI's current format.
  Auth type `oauth`, client mode `cimd`. Koyomi already accepts ChatGPT's CIMD client
  (`https://chatgpt.com/oauth/client.json`) and fixed redirect.
- [ ] `displayName` ≤ 30 characters, `shortDescription` ≤ 30, `longDescription` ≤ 4,000
  (drafts in section 5).
- [ ] Website, support, privacy and terms URLs. The support page is to be written.
- [ ] Logo and composer icon: square PNG, 48–4,096 px, from the existing Koyomi mark (see section
  5), and brand colours.
- [ ] Domain verification: serve OpenAI's token at
  `https://app.koyomi.guru/.well-known/openai-apps-challenge` (a small PR, once the token
  exists).
- [x] Tool metadata: titles, `readOnlyHint`, `destructiveHint: false`, `openWorldHint: false`,
  OAuth security scheme on every tool.
- [ ] Demo video: connect, consent with one calendar, three questions, revoke.
- [ ] Exactly 5 positive and 3 negative test cases (section 4).
- [ ] Reviewer account with no MFA, magic link or emailed code (section 4).
- [ ] Content suitable for ages 13–17 (calendar data, no generated content: fine).
- [ ] Review risk: OpenAI rejects "unofficial connectors to third-party services". Koyomi reads
  Google, Microsoft and Yahoo through its own accounts, consent and service. Say so in the
  submission, and lead with Koyomi as the product, not "a Google Calendar connector".
- [ ] Allowlist: the reviewer's subject added (owner's approval) before the review starts.

### Claude (Anthropic)

- [ ] Submit at claude.ai → directory → manage → Submit new → MCP connector. Any paid plan.
- [ ] **A submission becomes a Community listing on its own.** Only "Verified" is Anthropic's
  decision. So submit only when AI access is ready to be open, not as a step before opening.
- [x] Every tool has a `title` and annotations.
- [ ] At least 3 example prompts (section 5).
- [ ] Public documentation live by publication (the help page).
- [x] Privacy policy. [ ] Support contact (the help page).
- [ ] Seven compliance acknowledgments, read and accepted by the owner.
- [x] CIMD advertised (`client_id_metadata_document_supported`) with
  `token_endpoint_auth_method` `none`; `https://claude.ai/api/mcp/auth_callback` works.
- [ ] Claude Code: loopback redirects on any port, for both `localhost` and `127.0.0.1`. Koyomi
  accepts loopback redirects (labelled "An app on this computer"); connect once from Claude Code
  before submitting.
- [ ] A fully populated reviewer account (section 4).
- [x] Avoids the stated rejection reasons:
  - errors are specific (`range_too_long`, `unknown_calendar`, `rate_limited`, `access_revoked`);
  - answers are capped at 500 items;
  - no conversation data is collected.
  - The "calling APIs you don't own" risk is answered as for ChatGPT.
- [ ] After listing: report material changes (Anthropic's policy 3H), such as new tools or new
  providers.

### Grok (xAI)

- **Today, with no listing:** any Grok user can add Koyomi on grok.com as a custom connector
  (Connect Apps → New connector → Custom, URL `https://app.koyomi.guru/mcp`). This passed
  acceptance. The help page should describe it.
- **Listing:** the only path is xAI's plugin marketplace form
  (`https://x.ai/bot/marketplace/submit-a-plugin`). Its targets are "Grok (coming soon)", Grok Bot
  and Cursor.
- Submitting means accepting **Cursor's Marketplace Publisher Terms**, with identity and business
  verification. Two terms matter:
  - the plugin must be free to users (§3.1);
  - plugin data must not be used for training (§6.3), which matches Koyomi's position.
- Grok Business admins can provision connectors for their organisation in xAI's console.
- No OAuth requirements are published for grok.com. What works is DCR, a public client, PKCE and
  the redirect in MCP.md Part 4.
- **Recommendation:** do not submit yet. Wait for the grok.com target. A Grok Bot or Cursor
  listing also puts Koyomi in Cursor, which is a separate decision, and it registers three
  clients per connection. Revocation guidance matters most here, because disconnecting in Grok
  does not revoke at Koyomi.

---

## 4. Reviewer account (proposed; not created)

**Safest approach: a separate 6Away account that owns only synthetic calendar links, with no
Google or Microsoft account at all.**

| Requirement | How |
| --- | --- |
| Synthetic data only | Two calendar links to static `.ics` files written for review: "Koyomi Demo, Work" and "Koyomi Demo, Home". Nothing copied from a real calendar |
| No access to real calendars | Its own 6Away identity, so its own subject. It owns only those two connections. Every read is scoped to the signed-in subject, as acceptance showed with a second real person |
| Predictable events | Weekly recurring events (`RRULE`), so the answers are the same whichever day a reviewer tests: a weekday standup 09:30–09:45, a Wednesday lunch 12:00–13:00, a Thursday review 15:00–16:00, a Friday all-day "Demo day". Tied to no real date |
| Positive and negative cases | Below |
| The existing read-only model | No change: same consent page, same grants, same four tools |
| No bypass of 6Away Auth | The reviewer signs in through 6Away like anyone else. No test hook, no token pasted into a platform, no allowlist pattern |

Why not Google: Koyomi's Google app is in Testing (7-day grants, test users only). A reviewer's
Google connection would lapse mid-review, and it would put Google data into reviews before
Google has confirmed AI access. Why not the "Koyomi Test" Google calendar used for acceptance:
it is reached through the owner's own accounts.

Where the `.ics` files live: a fixed public URL that serves only synthetic data. A small static
file on `koyomi.guru` (for example `/demo/work.ics`) is the simplest, and it passes Koyomi's
public-internet link checks. Anyone may subscribe to it, which does no harm.

**To confirm with 6Away first:** the reviewer must sign in with an email and password, with no
MFA, magic link or emailed code (OpenAI's requirement). 6Away's email sign-in offers "Send a
magic link instead", which suggests a password option exists. That is unverified.

The account's credentials:

- kept in the owner's password manager;
- given to each platform only in its submission form;
- never written in the repository or a chat;
- rotated after each review.

Its subject is added to `KOYOMI_MCP_ALLOWLIST` only with the owner's approval, before a review
starts.

**Test cases** (reviewer authorizes "Koyomi Demo, Work" only):

| # | Prompt | Expected |
| --- | --- | --- |
| P1 | Which calendars can you see through Koyomi? | "Koyomi Demo, Work" only |
| P2 | What's on my calendar next Wednesday? | standup 09:30 and lunch 12:00, in the person's zone |
| P3 | Find me an hour free next Thursday between 9 and 5. | 09:45–15:00 and 16:00–17:00 |
| P4 | What is my next meeting? | the next standup, or the next event if sooner |
| P5 | Is there anything all-day next Friday? | "Demo day", shown as all-day and not as busy |
| N1 | Add a meeting tomorrow at 3pm. | refused: Koyomi is read-only, with no tool to write |
| N2 | What's on my Home calendar? | not available: that calendar was not shared |
| N3 | Who is attending the Wednesday lunch, and where is it? | not available: Koyomi returns no guests or places |

---

## 5. Listing metadata (drafts)

Brand: the existing Koyomi mark (`public/icons/icon-512.png`; the source artwork is the
owner's), on Koyomi's paper colour `#F5F1E8`, with ink `#252421` and the vermilion accent
`#C45845` (dark: `#1D1D1B`, `#ECE8DE`, `#C45D4A`). No AI imagery, sparkles or robots, and no
other company's marks.

- **Name:** Koyomi
- **Positioning:** All your calendars. One connection for your AI.
- **Short description** (≤ 30): "All your calendars, read-only" (29). Alternative: "Your
  calendars, one connection" (30).
- **Long description:**

  > Koyomi brings the calendars you already use into one quiet place: Google, Microsoft, Yahoo
  > and calendar links, across as many accounts as you have. Connect Koyomi once, and your
  > assistant can see them together. There is no separate connection for each provider.
  >
  > Ask what your day looks like, what you have tomorrow, when you're next free for an hour, or
  > what your next meeting is. Koyomi answers from every calendar you chose, in your time zone,
  > and says plainly if one could not be read.
  >
  > You choose which calendars your assistant may see. Koyomi is read-only: your assistant
  > cannot add, change or delete anything. It receives event titles and times, not
  > descriptions, places or guests. Koyomi's own local events stay on your device. You can
  > revoke access at any time in Koyomi, under Calendars.

- **Capabilities:**
  - List the calendars you shared.
  - Read events between two dates, up to 31 days.
  - One day's schedule.
  - Find free time of a given length, optionally within working hours.

  Every answer states its time zone and whether every calendar was read.
- **Install:**
  - **ChatGPT:** find Koyomi in Apps (once listed), or add a custom MCP server with
    `https://app.koyomi.guru/mcp`.
  - **Claude:** Connectors → Koyomi (once listed), or add a custom connector with the same URL.
  - **Grok:** Connect Apps → New connector → Custom, with the same URL.

  In every case, sign in to Koyomi, tick the calendars to share, then Allow.
- **Example prompts:**
  - "What does my day look like tomorrow?"
  - "Find me 90 minutes free on Thursday afternoon."
  - "What's my next meeting?"
  - "Which day next week is least busy?"
  - "Am I free at 3pm on Friday?"
  - "Show my week across all my calendars."
- **Privacy:**

  > Koyomi sends your assistant only the calendars you chose, and only when it asks:
  > titles, times, all-day and tentative flags, and calendar names. Koyomi does not store your
  > events or your conversations, and does not use your calendar data to train AI models.
  > [After the section 2 change:] It does not allow your assistant to do so either; you can
  > also turn off training in your assistant's settings. Revoke at any time in Koyomi →
  > Calendars → AI access. Full details: koyomi.guru/privacy.

- **Support:** the help page (to be written) and the contact address on koyomi.guru/privacy. A
  dedicated support address is recommended before listing.

---

## 6. Marketing (recommendations only)

Line: **"Your calendars. Now connected to your AI."**

Say only what has been verified:

- read-only;
- the person chooses calendars per assistant;
- every connected calendar, together;
- free time worked out across all of them;
- each answer says when a calendar could not be read;
- revoke at any time;
- local events stay on the device;
- tested with ChatGPT, Claude and Grok.

Do not say:

- **"available in ChatGPT / Claude / Grok"** or "now live", until a listing is approved and AI
  access is open;
- **"works with any AI"** (three were tested);
- **"Microsoft and Yahoo"** as tested with assistants on Production. They are covered by
  automated tests only. Run one real check of each through an assistant first, or say "the
  calendars you connect to Koyomi";
- anything implying writing, reminders or booking.

Use text names for the assistants until each platform's brand rules allow their marks.

Where: a short section on koyomi.guru below the calendar story, with the same paper and ink, one
screenshot of the consent page and one of an answer. It links to the help page. Until launch,
"Private beta", or nothing at all.

---

## 7. Operational implications

- **Load:** every assistant question is one or more `/mcp` invocations, each spending the grant
  allowance (a database write). Each also reads providers, through the same per-connection
  allowance the app uses. Token refreshes add `/api/oauth/token` calls every 15 minutes of use.
- **Database:** the AI tables grow with grants (one per person per assistant), clients (Grok:
  one per connection) and refresh tokens. Pruning covers clients; revoked grants cascade. Neon's
  free plan is the first limit to hit.
- **Provider quotas:** AI reads share Google's per-project quota and Microsoft's per-app
  throttling with the app. Watch `failed:` and `incomplete` outcomes in the `[mcp]` log.
- **Logs:** outcome-only lines per call. Vercel keeps runtime logs briefly; a log drain is needed
  for any audit window longer than that.
- **Support load:**
  - revoking in the assistant versus in Koyomi;
  - being signed in to the wrong 6Away account;
  - Microsoft admin approval;
  - Google while in Testing.

  The help page should answer these four before launch.
- **Policy upkeep:**
  - report material changes to Anthropic;
  - re-verify with Google on any scope or consent-screen change;
  - keep Privacy's list of AI recipients current.

---

## 8. Recommended launch sequence

1. **This PR:** documentation only. Production unchanged.
2. **Code (one PR, reviewed, flag still private):**
   - consent page: signed-in account and switch, no-calendar path, training line;
   - AI access shown to any signed-in person;
   - per-client limit reworked;
   - DCR per-address limit and cap;
   - Privacy and Terms text per section 2;
   - public help page;
   - an explicit "everyone" setting for AI access, unused.
3. **Google:** resubmit verification with AI access in the justification and the demo. Wait for
   Google's confirmation, then switch to "In production". Meanwhile, if opening sooner is
   wanted, leave Google calendars out of AI access for people not on the list.
4. **Reviewer account:** created by the owner as in section 4. Its subject goes on the allowlist
   with the owner's approval.
5. **ChatGPT:**
   - organisation verification;
   - domain token route;
   - package, demo video and test cases;
   - submit.

   ChatGPT's review is private, so it can run while AI access is still limited to the list.
6. **Open AI access:**
   - the "everyone" setting in Production, at the owner's word;
   - Neon on a paid plan;
   - Firewall rules in place;
   - watch the first days.
7. **Claude:** submit once open, since a submission lists at once.
8. **Grok:** custom connectors are documented from step 2. The marketplace waits for its
   grok.com target and a decision on Cursor's terms.
9. **Marketing:** after the first listing is live.
