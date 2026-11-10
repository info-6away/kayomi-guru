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

## Decision (10 November 2026)

| Question | Answer |
| --- | --- |
| 1. Is Koyomi eligible for a public ChatGPT submission? | **Yes on the rule's text, but not certain.** Koyomi is its own product, with its own accounts and events, cross-provider normalization and cross-calendar free time. Its bounded read-only tools use authorized, official access, and comparable calendar aggregators are listed. "Unofficial connector" is undefined and the reviewer decides. There is no pre-ruling: ask support with a draft's plugin ID (section 3) |
| 2. Is the Google Calendar → AI model compliant? | **Not yet, but the gaps are fixable, and one question only Google can settle.** The consent model meets Google's transfer conditions. Three mandatory items are missing: the privacy policy's AI/ML affirmation (and its sentence leaving training to the assistant must go), accurate consent wording, and help documentation. The open question: ChatGPT's consumer plans train on app data by default, and no Google page settles whether that downstream use falls on Koyomi (section 2) |
| 3. Do we need Google's confirmation? | **Not required by Google's rules** (no scope or branding change). **Advisable before Google calendars are opened to the public through AI**, because a finding against Koyomi would end every Google connection. Route: reply to the last email from Google's verification team. Draft in section 2, not sent |
| 4. Can 6Away Auth support the reviewer account? | **Yes, with no change.** Email and password, no MFA (6Away has none), no magic link or code at sign-in, one email check at sign-up only. Normal flow, synthetic calendar links only (section 4) |
| 5. What must be implemented before submitting? | The submission PR (section 8): Privacy and consent wording, help page, domain-verification route, reviewer calendars. Then outside the code: OpenAI business verification, the reviewer account, the package, demo video and test cases |
| 6. The smallest safe implementation PR | Section 8, "PR A": wording, help page, one challenge route and two static files. No change to OAuth, tokens, limits, the allowlist or Google. **Built in Phase 8A** (`feature/mcp-public-readiness-a`, not merged); it also removes `event_id` from tool answers |
| 7. Launch sequence | Section 8 |

### Status by category

**Completed**

- Private acceptance in ChatGPT, Claude and Grok on Production (MCP.md, Part 4).
- OAuth for public clients:
  - CIMD and DCR, PKCE `S256`, `resource` audience, `iss`;
  - refresh rotation with reuse detection, RFC 7009 revocation.
- Four read-only tools with titles, annotations and `securitySchemes`.
- Answers capped at 500 items; partial reads stated; hostile titles returned as data.
- Allowlist at every step. Revocation in Koyomi. Logs hold outcomes only, and the AI tables hold
  no event content.
- Consent per assistant and per calendar, none preselected, affirmative Allow. Privacy's AI
  section lists what is shared.
- Google app verified (branding and data access), In production, existing scopes approved.
- Privacy and Terms name the operator, as OpenAI's same-publisher rule requires.
- 6Away Auth supports a reviewer account as it is. Vercel Security Review clean; PR checks
  green.

**Remaining requirements**

- **To submit, built in Phase 8A** (on its branch, not merged):
  - Privacy wording;
  - consent page;
  - help and support page;
  - `/.well-known/openai-apps-challenge`;
  - reviewer `.ics` calendars;
  - `event_id` removed.
- **To submit, still to do:**
  - merge Phase 8A;
  - the reviewer account;
  - OpenAI business verification, and the domain token set (a setting);
  - package, icons, demo video, 5 + 3 test cases;
  - reviewer on the allowlist (owner's approval).
- **Claude:** 3+ example prompts, public docs, seven acknowledgments.
- **To open to the public:**
  - per-client limit;
  - DCR per-address limit and cap;
  - AI access (Revoke) shown on any signed-in device;
  - an explicit "everyone" setting;
  - a separate gate for Google calendars;
  - Neon on a paid plan;
  - Firewall rules.

**Compliance risks**

| Risk | Likelihood | Impact | Handling |
| --- | --- | --- | --- |
| Google: downstream training by an assistant (ChatGPT consumer trains on app data by default; Grok unstated; Claude excludes connector content) | unknown: no Google ruling | **high**: every Google connection | ask Google; a training notice for Google calendars (a notice, not a box to tick, and no substitute for Google's answer); Google gated until answered |
| Google: the feature is "prominent" in Koyomi, but its answers appear in the assistant | low | high | in the inquiry |
| OpenAI: judged an "unofficial connector" | low to medium | rejection only | product-first description, support question with a draft |
| OpenAI terms: Koyomi warrants it has the rights and consents (§1.4(b)), and licenses its responses to OpenAI under each user's terms (§1.3) | tied to the Google risk | as above | as above |
| Claude: a submission is listed at once | certain | premature listing | submit only after opening |
| Microsoft and Yahoo API terms for AI use | not reviewed | unknown | review before naming them in marketing |

**Public-launch blockers**

1. Privacy AI/ML affirmation, the training sentence, consent accuracy, help page (Google
   mandatory).
2. Google's answer, or Google calendars kept out of AI access for the public until it comes.
3. Per-client limit and DCR limit.
4. Revoke reachable from any signed-in device.
5. An explicit "everyone" setting (unset still meaning nobody).

**Recommended improvements**

- Show the signed-in 6Away account on consent, with a way to switch (**done in Phase 8A**).
- A link to Calendars when a person has no calendars (**done in Phase 8A**).
- Change calendars without reconnecting.
- Drop `event_id` from answers (**done in Phase 8A**).
- Explain the Grok Bot ("www.cursor.com") label.
- A log drain; watch provider quotas.
- A dedicated support address.
- Check Microsoft and Yahoo through an assistant on Production before naming them in marketing.

---

## 1. Public readiness audit

| Area | Today | Gap | Recommendation | Severity |
| --- | --- | --- | --- | --- |
| Allowlist | Exact 6Away subjects in `KOYOMI_MCP_ALLOWLIST`, Production only; unset or empty means nobody; checked at every step | The only ways to open it are listing every subject, or unsetting it, which closes it | Keep "unset = nobody". Add an explicit, separate setting for "everyone" in a reviewed PR, so opening and closing stay one setting each. Until then, add people (reviewers first) by subject | Blocker |
| Onboarding, new person | Assistant → Koyomi sign-in (6Away, sign-up open) → consent page | A person with no calendars sees "Connect one in Koyomi first, then connect the assistant again", with no link. The consent request lasts 10 minutes | Link to Calendars from that message, and say plainly that they come back to the assistant afterwards. Optionally keep the request, so connecting a calendar returns them to consent | Blocker |
| Authentication | 6Away sign-in, then Koyomi's session cookie on `app.koyomi.guru` | The consent page does not say which 6Away account is signed in. During acceptance, a browser signed in to another 6Away account was refused, and nothing said why | Show "Signed in as …" with a way to switch account on the consent page, shown only to that person | Blocker |
| First calendar | Google, Microsoft, Yahoo and calendar links are live | **Google:** none for connecting; the app is verified and in production (section 2). **Microsoft:** work and school accounts need their admin's approval (no publisher verification). **Yahoo:** an app password. **Links:** none | State Microsoft's admin approval and Yahoo's app password in the help page | Before listing |
| AI authorization | Consent lists the person's calendars, none ticked, Allow disabled until one is ticked; read-only; revocable | Says data goes to the assistant "when you ask it calendar-related questions", but the assistant calls whenever it chooses (Google requires accuracy). No mention of AI training | Accurate wording; for Google calendars, a training notice; a link to Privacy beside Allow (section 2). **Done in Phase 8A** | Blocker |
| Calendar selection | Per grant, on the consent page | No editing in place; changing calendars means connecting again | A "Change calendars" action in AI access, reusing the consent page | Later |
| Revocation | Revoke in Koyomi (Calendars → AI access) ends the grant at its next request | Disconnecting inside Claude or Grok does not revoke at Koyomi. AI access shows only where the device has the person's calendars, so a signed-in phone with no copy cannot revoke | Show AI access to any signed-in person, from the server's list. Say in the help page and on consent that revoking happens in Koyomi | Blocker |
| OAuth clients | CIMD (ChatGPT, Claude) and open DCR (Grok, Grok Bot, others); public clients only; unused registrations pruned after 7 days, idle ones after 90 | DCR is limited to 60 a minute **per server instance, for everyone**. One caller can use it up, and many instances multiply it. Grok makes a client per connection, Grok Bot three | Per-address limit on `/api/oauth/register` (a Vercel Firewall rate-limit rule needs no code), plus a cap on total live registrations, and a watch on `ai_clients` | Blocker |
| Rate limits | 30 calls a minute per grant (database, all instances); 300 a minute **per client id per instance** (memory); 120 provider units a minute per connection (database) | ChatGPT and Claude each use **one client id for all their users**. In public, 300 a minute per instance is shared by everyone using that assistant, so one busy person can throttle others | Drop the per-client cap, or make it far higher and per grant; keep the per-grant and per-connection limits; add a per-address Firewall rule on `/mcp` | Blocker |
| Quotas | Google Calendar API quota on project `koyomi-511111`; Graph and Yahoo throttle per app or account | Not measured. AI questions add reads on top of the app's | Read the project's Calendar API quota page before opening; alert on 429s in the `[mcp]` outcomes (`failed:` and `incomplete`) | Before listing |
| Costs | Vercel Pro (Fluid compute); Neon free plan | Every tool call is a function invocation and at least one database write (the grant allowance). Tokens refresh every 15 minutes of use. On the free plan the database's compute allowance is the first ceiling | Move Neon to a paid plan before opening. Watch Vercel usage per route (`/mcp`, `/api/oauth/token`) for the first weeks | Before listing |
| Privacy and Terms | AI section on Privacy; two sentences in Terms; dated 8 November 2026 | One sentence says the assistant's company's use of the data, "including whether it uses them to train its models", is governed by its own terms. Google's Workspace policy forbids transfers for training non-personalized models, so the page must say Koyomi does not allow it, and what the person can do | Rewrite per section 2; add the Workspace Limited Use sentence and Google's AI statement | Blocker |
| Support | A contact address on Privacy and Terms | No public page about connecting an assistant, revoking, or getting help. Google requires help documentation on managing and deleting data; Claude's directory needs public documentation; ChatGPT a support URL | A public help page on `koyomi.guru` (section 5 has the text; PR A in section 8). A dedicated support address is worth having | Blocker |
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

### Where verification stands (Google Cloud console, read on 10 November 2026)

| | Status |
| --- | --- |
| Verification Center: branding | **Verified**, "being shown to users" |
| Verification Center: data access | **Verified** |
| Audience | **In production**, External. The 100-user cap counter is shown, but it does not apply while only approved scopes are requested |
| Scopes | `calendar.calendarlist.readonly` (non-sensitive), `calendar.events.readonly` (sensitive). No restricted scope |
| Branding | App name Koyomi; home `https://koyomi.guru`; privacy `https://koyomi.guru/privacy`; terms `https://koyomi.guru/terms`; authorized domain `koyomi.guru` |

So anyone can connect a Google account to Koyomi, with no "unverified app" screen and no 7-day
expiry.

The history, from the project's records:

- Google's review asked on 14 October 2026 for Privacy to explain how sensitive data is
  protected, and that section went live the same day.
- Verification was granted after that.
- **AI access did not exist when the scopes were justified and the demo was recorded.** What
  Google verified is Koyomi showing a person their own calendars.

The Data Access page still shows its edit form, with an empty justification box and "Approval
required" beside the sensitive scope. That is the form for requesting a *change*. Saving
anything there, or changing the logo, name or links on Branding, sends the app back into review.
Leave both pages alone.

### The policies that apply

All pages were read on 10 November 2026:

- **UDP:** [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
  "Limited Use" under "Additional Requirements for Specific API Scopes". Last updated 15 February
  2024.
- **WSP:** [Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).
  It applies to Calendar data and names "MCPs" among what it covers. It contains "Limited use of
  user data", "Transparent and accurate notice and control" and "Maintain a secure operating
  environment".
- **FAQ:** [OAuth verification FAQ](https://support.google.com/cloud/answer/13463817), "Limited
  Use", including how it applies to machine learning and AI, and personalized versus generalized
  models.
- **ToS:** [Google APIs Terms of Service](https://developers.google.com/terms), §5c (explicit
  opt-in before exposing content to third parties) and §4a (no clone of the API).
- **Privacy policy findings:** [Google's guidance on privacy policy findings](https://support.google.com/cloud/answer/13806988),
  including the AI/ML statement and naming who receives data.
- **Changes after approval:** [what makes an approved app need review again](https://support.google.com/cloud/answer/13464018).

### Is verification an approval of AI access?

**No.** Verification covered Koyomi showing a person their own calendars, as submitted. AI
access needs no new scope, redirect or branding change, so Google's listed triggers for review
again are not met, and nothing has to be filed. But:

- the UDP's rules for transfers and new uses apply on their own terms;
- Google can audit, restrict or revoke an app found out of policy (UDP, "Enforcement"; WSP);
- revoking would end **every** Google connection in Koyomi, not only AI access.

### How the policies apply to each intended transfer

| Question | Finding | Basis |
| --- | --- | --- |
| Does the consent model meet the transfer conditions? | **Very likely yes.** A transfer is allowed for a user-facing feature that is visible and prominent in the app, and only with consent. Koyomi asks per assistant and per calendar: none ticked, an affirmative Allow, revocable, explained on a page of its own. That is also ToS §5c's explicit opt-in. No contract with the recipient is required, and no "necessary" test applies to transfers | UDP, WSP, ToS §5c |
| Is there an open point in it? | The feature is set up in Koyomi's interface, but its answers appear in the assistant's. No Google page addresses that case | none found |
| Does the training ban apply? | **Yes, to Koyomi's transfer.** WSP forbids transferring or using the data to create, train or improve any model beyond that person's personalized model. Koyomi's purpose (answering the person) is allowed: WSP itself approves general generative-AI summaries as a user feature. Whether the ban also reaches **what the assistant's company does afterwards** is not settled. WSP speaks of the developer's transfer. The FAQ says, without naming who, that the data may not be used to train foundational or frontier models, nor be stored with them | WSP, FAQ |
| Must Koyomi get an assurance from the AI company? | No Google page requires one | absence, all of the above |
| Does user consent cure a prohibited use? | **No.** Consent is a condition for transfers, not an exemption from the prohibited uses. The only consent path to training Google describes is explicit consent to *personalized* model training (verification video guidance) | UDP, WSP, [video guidance](https://support.google.com/cloud/answer/13464321) |

### What each assistant does with what Koyomi sends

Read from each provider's own pages on 10 November 2026:

| Assistant and plan | Trains on Koyomi's answers? | Person's control | Business guarantee |
| --- | --- | --- | --- |
| **ChatGPT** Free, Go, Plus, Pro | **Yes, by default.** Data from connected apps is trainable while "Improve the model for everyone" is on ([connected apps FAQ](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt), [data controls](https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt)). OpenAI's own Google app is excluded from training, but nothing extends that to third-party apps ([Google app FAQ](https://help.openai.com/en/articles/10408842-google-app-data-controls-faq)) | Settings → Data controls → "Improve the model for everyone", or the Privacy Portal. Thumbs feedback still allows training on that conversation | none |
| **ChatGPT** Business, Enterprise, Edu | No, by default | admin | [Services Agreement](https://openai.com/policies/services-agreement/) §4.2, [DPA](https://openai.com/policies/data-processing-addendum/), [enterprise privacy](https://openai.com/enterprise-privacy/) |
| **Claude** Free, Pro, Max | **Raw content from connectors and MCP servers is not used for training**, unless the person copies it into the chat ([Privacy Center](https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training)). This is help-center text, not a contract. The [Privacy Policy](https://www.anthropic.com/legal/privacy) is broader, and Claude's own replies repeating event data are not addressed | Settings → Privacy, model improvement setting; incognito chats | none |
| **Claude** Team, Enterprise, API | No | owner | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms), [DPA](https://www.anthropic.com/legal/data-processing-addendum) |
| **Grok** free, SuperGrok | **Unstated for custom connectors; trainable by inference.** xAI promises no training only for its own Google connectors ([privacy policy](https://x.ai/legal/privacy-policy), [Gmail & Calendar connector](https://docs.x.ai/grok/connectors/gmail-google-calendar)) | Settings → Data controls → "Improve the model"; Private Chat | none |
| **Grok** Business, Enterprise | No (with a qualifier for customer settings) | admin | [Enterprise Terms](https://x.ai/legal/terms-of-service-enterprise), [DPA](https://x.ai/legal/data-processing-addendum) |

**No provider gives the MCP developer any assurance, or a way to mark tool output as
not-for-training.** OpenAI's [App Developer Terms](https://openai.com/policies/developer-apps-terms/)
(§1.3) expressly leave the use of an app's responses to OpenAI's terms with each user. Cursor's
Marketplace terms (§6.3) forbid the *publisher* from training, not the platform.

**Consumer versus business accounts matters most.** On every business plan, training is off by
contract. On consumer plans:

- **ChatGPT:** trains on Koyomi's answers by default.
- **Grok:** probably does the same.
- **Claude:** says it does not.

Koyomi cannot tell which plan a person uses: ChatGPT and Claude each use one client for all of
their plans.

### Requirements: mandatory and recommended

**Mandatory** (the policy says "must"):

| Requirement | Koyomi today | To do |
| --- | --- | --- |
| Transfer only for a prominent user-facing feature, with consent | met | none |
| Explicit opt-in before third parties see content (ToS §5c) | met | none |
| No transfer or use for training beyond a personalized model | Koyomi's own use: met. Downstream: unsettled (above) | ask Google; precautions below |
| In-product disclosure: accurate, in normal use, says what data and how it is shared, immediately before consent, affirmative action, not only in the privacy policy | met, except **accuracy**: it says the assistant receives data "when you ask it calendar-related questions", but the assistant may call Koyomi whenever it chooses | say "whenever it asks Koyomi, until you revoke access" |
| Privacy policy discloses how Google data is shared | met (AI assistants named as a category, and the three by name) | none |
| The privacy policy's affirmation that Google Workspace data is not used to develop, improve or train non-personalized AI/ML models (verification guidance) | **missing**, and one sentence leaves training to the assistant's company | rewrite (wording below) |
| Limited Use statement | present (UDP form) | add the Workspace form beside it |
| Help documentation on how people manage and delete their data | Privacy only | a public help page |
| Tell people about a new use and ask them to consent to the updated policy | each AI grant has its own consent, after the AI section was published | make Allow refer to the policy explicitly |
| Follow the MCP security best practices (WSP, secure operating environment) | met: PKCE, `resource`-bound tokens, no token passthrough, per-grant handles, read-only | none |

**Recommended precautions** (no Google text requires them):

1. **Training notice on the consent page whenever a Google calendar is ticked.** Done in Phase
   8A. It says what Koyomi does and what the assistant's company decides, and it is a notice,
   never a box to tick.
2. **No acknowledgement checkbox.** An earlier draft proposed a second tick, "training is off in
   the assistant". It is dropped. Koyomi cannot verify it. A tick would read as the person
   vouching for another company's handling. And a notice or a checkbox does not resolve a use
   that may be prohibited. That is Google's to answer (below), and until it does, Google
   calendars are not opened to the public through AI.
3. **Ask Google first** (below), and until Google answers, keep Google calendars out of AI access
   for anyone not on the allowlist. Microsoft, Yahoo and calendar links fall under no Google rule.
   Microsoft's own API terms were not reviewed here.
4. Prompt-injection handling is in place (titles returned as data, a notice in every answer, no
   write tools). WSP's prompt-injection list most likely binds restricted scopes only, and
   Koyomi has none.
5. The help page names the three assistants and where to add Koyomi. Privacy does not claim
   anything for them: their terms differ by plan, and change.

### Wording, as implemented in Phase 8A (feature branch, not merged)

**Privacy** (`app/privacy/page.tsx`): the sentence that left training to the assistant's company
"not by Koyomi" is gone. In its place:

- **Koyomi's own commitments:**
  - Sending Google data to an assistant is bound by Limited Use: only the calendars chosen, only
    the details listed, only for the feature chosen, only while allowed.
  - Koyomi does not use Google Calendar data to develop, improve or train AI or ML models, and
    does not send it to anyone for that purpose.
  - Google's own sentence, word for word: "Google Workspace APIs are not used to develop,
    improve, or train non-personalized AI and/or ML models."
- **What Koyomi cannot control:**
  - what an assistant's company does with what it has received;
  - some assistants' personal plans use conversations, app data included, to improve their
    models unless the person turns that off. People are told to check before choosing a Google
    calendar.
  - Nothing is claimed for any named company.
- **The Workspace Limited Use sentence**, beside the existing one, linked to Google's Workspace
  policy.
- **The AI section** also says:
  - calendars are chosen per assistant;
  - an assistant may ask whenever it chooses while access lasts;
  - no event identifier is sent;
  - Koyomi keeps none of the events it sends;
  - the assistant's company processes them under its own policies;
  - Koyomi controls access from then on: only the chosen calendars, checked on every request,
    until revoked;
  - revoking cannot retrieve what was sent;
  - Google's Limited Use requirements keep applying;
  - the assistant's company may keep them with the conversation.

**Consent page:** see `docs/MCP.md`, Part 2, "Consent".

### Should Koyomi ask Google? Yes, before Google calendars are opened to the public

The downstream-training question is not settled by any Google page. The cost of being wrong is
every Google connection. The official route is to **reply to the last email from Google's
verification team** (the FAQ's instruction). There is no standalone form, and the legacy contact
page now redirects to the console.

**Final draft, not sent.** It is to be sent only with the owner's approval, from the account
that holds that thread:

> Subject: Koyomi (project koyomi-511111): is anything more required for a user-authorized AI
> assistant feature?
>
> Hello,
>
> Koyomi (https://koyomi.guru) is verified for calendar.calendarlist.readonly and
> calendar.events.readonly. It shows a person their Google calendars together with the other
> calendars they connect to it: further Google accounts, Microsoft, Yahoo and published calendar
> links. Before offering an optional feature publicly, we would like to confirm whether any
> additional requirements apply to it. It needs no new scope, OAuth client, redirect or
> consent-screen change.
>
> **The feature.** A person may explicitly authorize an AI assistant they already use (ChatGPT,
> Claude or Grok) to read calendars through Koyomi, using the Model Context Protocol.
> - **The user authorizes the assistant explicitly.** The person adds Koyomi to their assistant,
>   signs in to Koyomi, and approves that assistant on Koyomi's own consent page. Each assistant
>   is authorized separately. The page names the assistant, says what will be shared and that
>   the assistant is a third party. For Google calendars, it adds that Koyomi sends them only so
>   the assistant can answer the person, and does not use them to train AI models.
> - **Only the calendars the user selects.** The person ticks each calendar the assistant may
>   read; none is pre-selected. The permission covers those calendars and no others: a calendar
>   connected later is not included unless the person authorizes it.
> - **Reads the assistant initiates.** While the authorization is active, the assistant may
>   start a read on its own, usually when the person asks about their schedule, but not only
>   then.
> - **Every read authenticated and checked.** Each read carries a short-lived token issued to
>   that assistant for Koyomi alone. On every request Koyomi checks that the authorization still
>   exists and covers the calendars asked about. It then reads only those calendars from Google
>   at that moment. It returns each event's title, start and end, whether it is all-day or
>   tentative, and its calendar's name: no descriptions, locations, attendees or identifiers.
>   Koyomi stores no event data.
> - **Read-only, and revocable at any time.** The assistant can only list those calendars, read
>   their events and look for free time. It cannot create, change or delete anything. The person
>   can revoke the authorization in Koyomi at any time. The next request is refused, and so is
>   any attempt to renew the token.
> - **No training by Koyomi.** Koyomi does not use Google user data to develop, improve or train
>   AI or ML models, and says so in its privacy policy.
>
> **What we cannot control.** The receiving assistant platforms have their own data-handling
> policies. Their business plans exclude training by contract. Some of their consumer plans may
> use conversation content, including data from connected apps, to improve their models unless
> the person turns that off in the assistant's settings. Our consent page and privacy policy say
> so.
>
> **Our questions:**
> 1. Does this explicitly authorized, per-calendar transfer, at the person's request, meet the
>    Limited Use condition for transfers that provide a user-facing feature with the user's
>    consent? The person sets it up in Koyomi, but reads the answers in the assistant.
> 2. Where the person's consumer AI settings may permit model training, do additional
>    requirements apply to Koyomi? For example, must Koyomi limit Google calendars to assistant
>    plans that exclude training, require the person to turn training off first, or not offer
>    Google calendars to AI assistants at all? Or are the disclosure and the person's explicit
>    consent sufficient?
> 3. Is anything further expected in our privacy policy (https://koyomi.guru/privacy) or our
>    in-product disclosure for this feature?
>
> Until we hear from you, Google calendars will not be offered to AI assistants for the public.
> We are happy to send a short recording of the consent flow.
>
> Thank you,
> 6Away AI FZE LLC, for Koyomi

None of this is legal advice. Only Google's answer is a confirmation.

---

## 3. Platform submission checklists

Nothing below has been submitted. Each item says whether Koyomi already has it.

### ChatGPT (OpenAI)

OpenAI now calls apps "plugins". The pages below were read on 10 November 2026:

- [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
- [Submission](https://developers.openai.com/plugins/deploy/submission)
- [App review](https://developers.openai.com/plugins/deploy/app-review)
- [Auth](https://developers.openai.com/plugins/build/auth)
- [App Developer Terms](https://openai.com/policies/developer-apps-terms/)

#### Eligibility: the "unofficial connectors" rule

Under "Third-party content and integrations", OpenAI says it cannot approve plugins that
*primarily* function as unofficial connectors to third-party services, including pass-through
layers. Two bullets beside it require authorized access under each third party's terms, and
forbid getting around their limits. "Unofficial", "primarily" and "aggregator" are defined
nowhere. No staff ruling or FAQ addresses them, and the reviewer decides.

**Koyomi against the rule.** Koyomi is the publisher's own service, not a connector to someone
else's:

- **Its own product:** a calendar app with its own accounts and its own day, week and month
  views. Its own local events never leave the device.
- **More than any one provider offers:**
  - several Google accounts, Microsoft, Yahoo (CalDAV) and `.ics` links, normalized into one
    event model, with recurrence and time zones handled per provider;
  - free time worked out across all of them;
  - per-calendar authorization for each assistant, on Koyomi's own consent page.
- **Bounded tools, not a pass-through:** four read-only tools with validated inputs, capped and
  shaped answers, and no provider request built from the assistant's text.
- **Authorized access:** each provider through its official API and the person's own consent
  (Google verified; Microsoft Graph; Yahoo's documented CalDAV with an app password; public
  `.ics`), within each provider's limits.

**Comparable plugins are listed today**, seen in the ChatGPT directory on 10 November 2026:

- CalendarBridge (Google, Outlook and Apple calendars in one), the closest match to Koyomi;
- alfred_;
- Slashy;
- Reclaim.ai.

A listing does not say which version of the rules it was reviewed under.

**Where it is genuinely uncertain:**

- OpenAI ships its own Google, Outlook and iCloud Calendar plugins. A reviewer could see Koyomi
  as overlapping them. The case rests on what those do not do: several providers and accounts
  together, Yahoo and `.ics`, free time across all of them, and per-calendar choice.
- "Authorized access" makes Koyomi answerable for Google's terms. The Google training question
  (section 2) is the weak point: OpenAI may train on app data for consumer plans with the
  setting on.

**Assessment:** eligible on the rule's text and on comparable listings, but not certain. The
final word is the reviewer's.

**No marketing workaround:**

- lead with Koyomi as a product;
- keep provider names out of the name and the short description;
- describe exactly what the tools do.

**Asking OpenAI first.** There is no channel for an eligibility ruling. The
[app review page](https://developers.openai.com/plugins/deploy/app-review) says to contact
support (the chat at [help.openai.com](https://help.openai.com/en/articles/6614161-how-can-i-contact-support))
with questions before submitting, quoting the plugin ID. So a draft must exist in the portal
first. Expect guidance, not a binding answer. A rejection can be appealed by replying to the
rejection email.

#### Submission requirements

- [ ] **Who submits:** the OpenAI organisation owner, or a member with the apps-management
  permission. **Business verification** is needed for 6Away at
  platform.openai.com → Settings → Organization. The directory shows the verified name, and the
  website, support, privacy and terms pages must name the same publisher. Privacy and Terms
  already name the operator.
- [ ] **Where:** platform.openai.com → Plugins → upload → "With MCP".
- [ ] **Package:** a ZIP with `plugin.json` and `mcp.json`, one MCP server, and these fields:

  | Field | Limit |
  | --- | --- |
  | `name` | 64 characters, lowercase and hyphens |
  | `displayName` | 30 characters |
  | `shortDescription` | 30 characters |
  | `longDescription` | 4,000 characters |
  | `developerName` | 80 characters |
  | `capabilities` | up to 20 labels |
  | `defaultPrompt` | up to 3, 128 characters each |
  | Listing URLs | website, support, privacy, terms; HTTPS |

  Drafts are in section 5. The **support URL is still to be written**.
- [ ] **Icons:** square PNG, JPEG, WebP or SVG, at least 48 px, at most 4,096 px and 5 MiB.
  A primary icon is required and a dark variant is optional. Use the existing Koyomi mark.
- [ ] **Domain verification:** the portal's token as **plain text** at
  `https://app.koyomi.guru/.well-known/openai-apps-challenge`, the MCP host. This is code: a
  route that serves a value from a setting.
- [x] **OAuth:**
  - OAuth 2.1 per the MCP spec, PKCE `S256`;
  - protected-resource metadata;
  - CIMD (`https://chatgpt.com/oauth/client.json`, since Koyomi supports RFC 9207 `iss`) and the
    stable redirect;
  - `resource` checked into the token's audience;
  - `securitySchemes` on every tool.

  All of this was proven in private acceptance.
- [x] **Annotations:** every tool sets `readOnlyHint`, `destructiveHint: false` and
  `openWorldHint: false`. False is allowed for a tool bounded to the person's own account.
- [ ] **Answers:** only data relevant to the request, with no telemetry or internal IDs. Each
  event carries `event_id`, an opaque per-grant handle that no tool takes as input. Drop it, or
  be ready to justify it. The calendar handles are needed (they are tool inputs).
- [ ] **Privacy policy:** categories of data, purposes, recipients, retention and user controls,
  and every category of personal data the app returns. Koyomi's AI section covers these. Add
  the section 2 changes.
- [ ] **Demo video** showing the test cases. **Exactly 5 positive and 3 negative test cases**
  (section 4), plus release notes.
- [ ] **Reviewer account:**
  - no MFA, emailed or SMS codes, magic links or private network;
  - sample data;
  - kept for later reviews;
  - credentials entered in the portal's secure review form.

  6Away supports this (section 4).
- [x] Ages 13–17 suitable; no 18+ content.
- [ ] **After approval:**
  - the owner chooses when to publish;
  - OpenAI scans the server daily, and new tools are held until checked;
  - metadata changes need a new ZIP and a new review;
  - changing the MCP origin needs a new plugin;
  - contact press@openai.com before any announcement.
- [ ] **Timeline:** none is published. The forum reports weeks to months.
- [ ] **Allowlist:** the reviewer's subject is added, with the owner's approval, before the review
  starts.

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

## 4. Reviewer account (calendars prepared in Phase 8A; account not created)

**Safest approach: a separate 6Away account that owns only synthetic calendar links, with no
Google or Microsoft account at all.**

| Requirement | How |
| --- | --- |
| Synthetic data only | Two calendar links to static `.ics` files written for review, "Koyomi Demo — Work" and "Koyomi Demo — Personal" (`public/demo/`). Every event is made up, with a `@demo.koyomi.guru` UID. Nothing is copied from a real calendar |
| No access to real calendars | Its own 6Away identity, so its own subject. It owns only those two connections. Every read is scoped to the signed-in subject, as acceptance showed with a second real person |
| Predictable events | Weekly rules from January 2026 with no end, so the answers are the same whichever week a reviewer tests (below) |
| Positive and negative cases | Below |
| The existing read-only model | No change: same consent page, same grants, same four tools |
| No bypass of 6Away Auth | The reviewer signs in through 6Away like anyone else. No test hook, no token pasted into a platform, no allowlist pattern |

**The two calendars**, served at `https://koyomi.guru/demo/koyomi-demo-work.ics` and
`https://koyomi.guru/demo/koyomi-demo-personal.ics`. The site's host is the one to use: Koyomi
never fetches a link from its own app host.

| Calendar | Weekly events (London time unless stated) |
| --- | --- |
| Work | Daily standup Mon–Fri 09:30–09:45 · Weekly planning Mon 10:00–11:00 · Design review Tue 14:00–15:00 · Optional training Tue 16:00–17:00 (**tentative**) · Team lunch Wed 12:00–13:00 (has notes and a place, **never sent**) · Call with the New York office Wed 10:00–10:30 **New York time** (15:00 London; 14:00 in the weeks when the two change clocks on different dates) · Client call Thu 10:00–11:00 and Team sync Thu 10:30–11:30 (**overlap**) · Demo day Fri, **all day** |
| Personal | Gym Mon and Wed 07:00–08:00 · School pickup Tue and Thu 14:30–15:15 (**overlaps** Tuesday's design review across calendars) · Dinner with friends Fri 19:00–21:00 · Piano lesson Sat 10:00–11:00 · Call with family in Tokyo Sun 20:00–20:30 **Tokyo time** · Family day Sun, **all day** |

They are tested as Koyomi reads them (`tests/unit/demo-calendars.test.ts`, and end to end in
`tests/e2e/ai.spec.ts`).

Why not Google: since Koyomi's Google app is verified and in production, a dedicated synthetic
Google account would now work and would not lapse. But it would send Google user data into
other companies' reviews before Google has answered (section 2). It also needs a Google account
kept just for this. Calendar links avoid both. A Google account can be added to the reviewer
later, if a platform wants to see Google specifically.

Why not the "Koyomi Test" Google calendar used for acceptance: it is reached through the owner's
own accounts.

**6Away Auth supports this today, with no change** (its source, read on 10 November 2026):

| Need | 6Away Auth |
| --- | --- |
| Email and password | Email-first sign-in: enter the address. An account with a password goes to the password step (argon2id). "Send a magic link instead" and "Continue with Google" are offered, never required |
| No MFA | 6Away has no second factor of any kind: no TOTP, passkey, step-up or new-device check |
| No magic link, no emailed code at sign-in | The password step completes sign-in by itself |
| Email verification | **Once, at sign-up only.** The account is created without a password or session. The chosen password is applied only when the emailed code or link is used. After that, sign-in never sends mail |
| Normal authentication, no bypass | The same 6Away client (`koyomi-guru`, sign-up open) and the same flow as everyone else. Nothing is seeded in the database, and no test hook is used |
| Limits | 10 password attempts a minute per IP and per address, and 10 look-ups a minute per IP. A reviewer will not meet them |

So the reviewer account is made through Koyomi's own sign-in, like any person's. It uses a
mailbox the owner controls (an alias kept for reviews), and that mailbox's one sign-up code is
read once. Reviewers then use only the email and password.

**Not to do:**

- no database seed of a password user, which would skip verification;
- no flag to turn MFA or verification off, since there is nothing to turn off;
- no change to 6Away for existing users.

Note that a 6Away identity can also sign up to other 6Away apps that allow sign-up. The
reviewer account holds nothing of value there.

**Setting it up (the owner, later, not in Phase 8A):**

1. Create the account through Koyomi's sign-in, with the review mailbox.
2. In Calendars, add a Calendar link for each of the two addresses above.
3. Its subject goes on `KOYOMI_MCP_ALLOWLIST`, with the owner's approval, before a review starts.

The account's credentials:

- kept in the owner's password manager;
- given to each platform only in its submission form;
- never written in the repository or a chat;
- rotated after each review.

**Test cases.** The reviewer authorizes "Koyomi Demo — Work" only. Prompts name London time, so
the answers do not depend on where the reviewer is.

| # | Prompt | Expected |
| --- | --- | --- |
| P1 | Which calendars can you see through Koyomi? | "Koyomi Demo — Work" only |
| P2 | What's on my calendar next Wednesday, in London time? | standup 09:30, team lunch 12:00, New York call 15:00 (14:00 in the clock-change weeks) |
| P3 | Find me an hour free next Thursday between 9am and 5pm London time. | 11:30–17:00 only: the client call and the team sync overlap from 10:00 to 11:30 |
| P4 | What's my first meeting next Monday, London time? | Daily standup at 09:30, then Weekly planning at 10:00 |
| P5 | Is there anything all day next Friday? | "Demo day", all day, and the day is not counted as busy |
| N1 | Add a meeting tomorrow at 3pm. | refused: Koyomi is read-only, with no tool to write |
| N2 | When is my gym session this week? | not available: the Personal calendar was not shared |
| N3 | Who is coming to Wednesday's team lunch, and where is it? | not available: Koyomi returns no guests or places |

---

## 5. Listing metadata (drafts)

Brand: the existing Koyomi mark (`public/icons/icon-512.png`; the source artwork is the
owner's), on Koyomi's paper colour `#F5F1E8`, with ink `#252421` and the vermilion accent
`#C45845` (dark: `#1D1D1B`, `#ECE8DE`, `#C45D4A`). No AI imagery, sparkles or robots, and no
other company's marks.

- **Name:** Koyomi. ChatGPT's guidelines ask to avoid generic single-word dictionary names not
  clearly tied to a brand. "Koyomi" is the product's own name and domain, not an English word:
  keep it, and never add "MCP", "Plugin" or a provider's name to it.
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
- **Example prompts** (ChatGPT's `defaultPrompt` takes the first three, ≤ 128 characters each;
  Claude needs at least three):
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
  > What your assistant does with what it receives is up to its own terms and your settings
  > there: check them before you share a Google calendar. Revoke at any time in Koyomi →
  > Calendars → AI access. Full details: koyomi.guru/privacy and koyomi.guru/help.

- **Support:** the help page (`https://koyomi.guru/help`, from Phase 8A) and the contact address on it. A
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
  - Yahoo app passwords.

  The help page should answer these four before launch.
- **Policy upkeep:**
  - report material changes to Anthropic;
  - re-verify with Google on any scope or consent-screen change;
  - keep Privacy's list of AI recipients current.

---

## 8. Implementation and launch sequence

### PR A: the smallest safe PR, for submission (built in Phase 8A; not merged)

Branch `feature/mcp-public-readiness-a`. The feature stays private: the allowlist is unchanged.
There is no change to OAuth, grants, tokens, limits or anything at Google.

| Change | Why | Where |
| --- | --- | --- |
| Privacy: per assistant; "whenever it chooses"; Koyomi keeps nothing it sends, the assistant's company processes it under its own policies, Koyomi controls access until revoked, revoking cannot retrieve what was sent; Limited Use for the sending; Google's AI/ML sentence; the Workspace Limited Use sentence; nothing promised for another company; the date | Google, mandatory | `app/privacy/page.tsx`; `tests/e2e/site.spec.ts` |
| Consent page: the asker and its host; the signed-in account, with "Not you? Sign out"; "whenever it chooses, not only when you ask it"; the calendars chosen, by name; a Google notice when a Google calendar is ticked (no box to tick); a way on for someone with nothing connected | Google: accuracy (mandatory); the rest recommended | `components/AiConsent.tsx`, `app/ai/consent/page.tsx`, `app/api/oauth/decision/route.ts`; `tests/e2e/ai.spec.ts` |
| A public help page, `koyomi.guru/help`, linked from the site's footer, Privacy and the consent page | Google (help documentation), OpenAI (support URL), Claude (public docs) | `app/help/page.tsx`; site tests |
| `/.well-known/openai-apps-challenge`: plain text from the setting `OPENAI_APPS_CHALLENGE`, 404 when unset | OpenAI domain verification | `lib/server/openai-challenge.ts`, `app/api/openai-apps-challenge/route.ts`, `next.config.ts`; unit and site tests |
| Two static `.ics` files of synthetic weekly events (`koyomi.guru/demo/…`) | reviewer data | `public/demo/`; unit and e2e tests |
| `event_id` removed from tool answers | OpenAI: no internal ids | `lib/server/ai/tools.ts`, `mcp.ts`, `read.ts`, `config.ts`; tests |

Merging PR A deploys it, and that is the only Production change it makes. The challenge route
answers 404 until the token is set.

### PR B: before opening to the public

- **Limits:** the per-client cap made per grant (or removed); DCR per-address limit and a cap on
  live registrations.
- **Revoke anywhere:** AI access shown to any signed-in person, from the server's list.
- **New settings, both inert until the owner sets them:**
  - "everyone" for AI access;
  - a separate gate for Google calendars, allowlist-only until Google answers.

Outside the code: Vercel Firewall rules on `/mcp` and `/api/oauth/register`, and Neon on a paid
plan.

### Sequence

1. **PR #37** (these documents): merged 10 November 2026 (`946ddce`).
2. **PR A (Phase 8A):** reviewed, merged at the owner's word. Production gets the wording, the
   consent page, the help page, the demo calendars and the 404-until-set challenge route; AI
   access is still the owner only.
3. **Google:** the owner approves and sends the inquiry, on the verification thread.
4. **Reviewer:**
   - the owner creates the 6Away account through Koyomi's sign-in, with a review mailbox;
   - subscribe it to the two demo calendars;
   - its subject goes on the allowlist with the owner's approval.
5. **ChatGPT:**
   - 6Away business verification;
   - a draft plugin in the portal;
   - optionally ask support about eligibility, quoting its ID;
   - the domain token set in Production (a setting, at the owner's word);
   - package, demo video and test cases;
   - submit.

   The review is private, and the reviewer sees synthetic calendars only. **Publishing after
   approval waits for steps 6 and 7.**
6. **PR B:** merged, Firewall rules added, Neon upgraded.
7. **Open AI access:**
   - the "everyone" setting at the owner's word;
   - Google calendars included only once Google has answered favourably;
   - until then, Microsoft, Yahoo and calendar links only for people not on the list;
   - watch the first days.
8. **Publish on ChatGPT** (press@openai.com before any announcement).
9. **Claude:** submit (it lists at once).
10. **Grok:** custom connector documented on the help page; the marketplace later.
11. **Marketing** (section 6), after the first listing is live.
