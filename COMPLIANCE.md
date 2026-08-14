# Compliance checklist — OpenFront Chat relay

Scope: you operate a WebSocket relay carrying user-to-user text messages, with
users in the EU (you are established in Germany), the UK, and the US.

**Not legal advice.** This is a working checklist built from regulator guidance,
not an opinion from a lawyer. The Impressum and age items in particular are
worth 30 minutes with a German lawyer before you publish.

Status key: `[ ]` todo · `[~]` partially done · `[x]` done

---

## Part 0 — Two decisions that change everything else

Make these first. They determine how much of the rest of this file you have to do.

### 0.1 The global lobby room is your single biggest lever

`__global__` (200 seats, open to anyone with the extension, no sender-defined
audience) is what would push you from *interpersonal communications service*
into *online platform* under the DSA. Recital 14 excludes interpersonal
communication; the dividing line is "dissemination to the public." A 200-person
open room is on the wrong side of that line. Team chat — closed, small,
membership fixed by the game — is comfortably on the right side.

- [ ] **Decide: keep or drop `__global__`.**
  - Drop it → you are plausibly an interpersonal comms service + mere conduit.
    Parts 2 and 4 shrink to a fraction of their size.
  - Keep it → assume online-platform status and do Part 2 in full.

This matters *more* than the FFA question. FFA is an OpenFront ToS problem;
global chat is a regulatory one. They're independent — solve both.

### 0.2 Are minors on the service?

Every heavy obligation in this document (OSA children's duties, JMStV, COPPA)
keys off this. Right now you have **no age gate at all**, and OpenFront's own
floor is 13 (16 in the EEA). A browser extension for a free browser game must
assume the answer is yes unless you actively prevent it.

- [ ] **Decide: age-gate or assume-children.**
  - Self-declared 16+ on first run, stored locally, refuse to connect below it.
    Cheap, weak, but it is a documented measure and changes your risk
    assessment. It does **not** discharge COPPA if you have actual knowledge.
  - No gate → you must complete the children's access assessment as "likely to
    be accessed by children" and take Part 4.3 seriously.

---

## Part 1 — Universal baseline

Do these regardless of the decisions above. Most obligations in all four
jurisdictions collapse into this short list.

### 1.1 A named accountable person
- [ ] Write down that you are the individual accountable for online-safety
      compliance. Name + email, in your terms and in the repo.
      *(Required by UK OSA for all services regardless of size.)*

### 1.2 A published contact point
- [ ] One email address, published in the extension popup, the store listings,
      and the terms. Must be monitored.
      *(DSA Art. 11/12 point of contact; OSA compliance contact; Impressum.)*

### 1.3 Terms of service for **your** relay
Separate from OpenFront's. Currently you have none.
- [ ] What the service is, who may use it, minimum age.
- [ ] What is not allowed (mirror your filter categories).
- [ ] What you will do about it — remove, ban nickname, ban IP hash.
- [ ] How to report something, and what happens after a report.
- [ ] Hosted at a stable https URL.

### 1.4 A working report route
This is the duty you are furthest from, and ephemerality makes it harder, not
easier — if you store nothing, you cannot review a reported message.
- [ ] **Report button in the overlay.** The client already has the last 50
      messages in `logEl`. On report, POST the offending message + nickname +
      room + timestamp to the relay. The *user* supplies the evidence; you
      still store nothing by default.
- [ ] Relay endpoint that queues reports for you (email is fine).
- [ ] Ability to act: block a nickname, block an IP hash, kill a room.
      You have none of this today.
- [ ] Tell the reporter what you did. *(DSA Art. 16 notice-and-action.)*

### 1.5 Written retention policy
- [ ] State plainly: chat messages are relayed and not persisted.
- [ ] **Check your metrics.** `oftc_active_ips_5m` derives from salted-hashed
      IPs — confirm the salt rotates and set an OpenObserve retention period.
      Hashed IPs are still personal data if the salt is stable.
- [ ] State retention for reports (e.g. 90 days, then delete).

### 1.6 Removal capability
- [ ] Be able to take content down "swiftly" once you know about it. With
      ephemeral chat this mostly means killing the session/room and banning the
      sender. Document that this is how removal works on your service.

---

## Part 2 — EU (DSA)

You are established in Germany, so no Art. 13 legal representative needed.
Micro/small enterprise exemption (Art. 19) drops most of Section 3 — but not
the items below.

- [ ] **Art. 11/12 point of contact** — electronic contact for authorities and
      for users, published. (→ 1.2)
- [ ] **Art. 14 terms** — clear, plain language, including your content
      restriction policy and how you enforce it. (→ 1.3)
- [ ] **Art. 16 notice-and-action** — an easy electronic route to flag illegal
      content, with confirmation of receipt and notice of your decision. (→ 1.4)
- [ ] **Art. 17 statement of reasons** — when you remove content or ban a user,
      tell them why, with the legal or contractual ground.
- [x] Art. 15 transparency reports — **exempt** as a micro/small enterprise.
- [ ] *If you keep `__global__`*: assume online-platform status. Add internal
      complaint handling (Art. 20), and read Art. 21 (out-of-court dispute
      settlement) and Art. 28 (protection of minors) before you ship.

Mere-conduit note: your relay filters content, enforces room membership and
verifies game IDs against OpenFront's API. That activity weakens a pure
Art. 4 conduit defence. Filtering is still the right call — just don't rely on
"I'm only a pipe" as your position.

---

## Part 3 — Germany specifically

### 3.1 Impressum — mandatory, § 5 DDG
This applies to your relay and any website you publish for it. Non-compliance
is an Abmahnung risk, and it is the most commonly enforced item on this list.
- [ ] Full name, **postal address** (no PO box), email, phone or equivalent
      fast contact route.
- [ ] Reachable in max two clicks from anywhere on the site, and from the
      extension popup.
- [ ] If you don't want your home address public, this is the practical reason
      to form a **UG (haftungsbeschränkt)** — roughly €1 share capital plus
      notary and registration costs — or use a Ladungsfähige Anschrift service.
      Also caps personal liability, which matters more here than the address.

### 3.2 JMStV (youth media protection)
- [ ] A **Jugendschutzbeauftragter** under § 7 JMStV is required for commercial
      providers of general-access telemedia carrying development-impairing
      content. A moderated text chat is probably below that bar — but user
      chat is exactly where such content arrives.
- [ ] If you do appoint one, their name and email must be
      *leicht erkennbar, unmittelbar erreichbar und ständig verfügbar* —
      in practice, in the Impressum.
- [ ] Cheaper alternative: document in your risk assessment why you concluded
      § 7 doesn't apply. A written, reasoned "no" is a defence; silence isn't.

### 3.3 TTDSG / ePrivacy
- [ ] Confidentiality of communications constrains how much you may inspect
      message content. Your filter is automated and applied in transit, which
      is defensible — but document that no human reads messages, and that
      nothing is retained.

---

## Part 4 — UK (Online Safety Act)

In scope if you have "links with the UK" — a significant number of UK users, or
UK users are a target market. An English-language extension for a globally
popular browser game: assume yes. Ofcom is explicit that size does not exempt
you; over 100,000 services are in scope, "from the largest social media
platforms to the smallest community forum."

### 4.1 Illegal content risk assessment — **written**
- [ ] Complete one within **three months** of launch, using Ofcom's template.
- [ ] Cover the 17 kinds of priority illegal content; for each, your risk
      rating and the measures that address it.
- [ ] Keep the written record. Review **annually** and before any significant
      change to the service.

### 4.2 Children's access assessment — **written, separate**
- [ ] Determine whether the service is "likely to be accessed by children."
- [ ] If yes → children's risk assessment within three months, plus protective
      measures and records.
- [ ] If no → you must be able to justify it, and re-assess annually.
- [ ] Age assurance is only *mandatory* for primary priority content
      (porn, suicide/self-harm, eating disorders). You don't carry that, so
      you almost certainly don't need hard age verification.

### 4.3 Safety measures (low-risk baseline)
Ofcom's floor for a genuinely low-risk service is close to Part 1:
- [x] Content moderation capability — your server-side filter.
- [ ] Swift takedown once aware. (→ 1.6)
- [ ] Easy user reporting + complaints procedure. (→ 1.4)
- [ ] Clear terms explaining how you protect users from illegal content. (→ 1.3)
- [ ] Named accountable individual. (→ 1.1)

**No proactive monitoring duty.** You are not required to read messages.

Enforcement reality: Ofcom engages before it investigates, and fees only apply
to businesses over £250m revenue. But **failing to respond to an information
notice is a criminal offence** — so if Ofcom ever writes, answer.

---

## Part 5 — USA

### 5.1 COPPA — the sharp one
Amended rule in force since **22 April 2026**.
- [ ] COPPA bites if the service is child-directed *or* you have **actual
      knowledge** you're collecting from an under-13. An open text chat is a
      classic actual-knowledge trap: the moment someone types "I'm 11" in a
      room and you see it, you're on notice.
- [ ] State 13+ (16+ in EEA) in the terms and the store listings. Neutral
      age-screen, not "are you over 13? [Yes]".
- [ ] Written **data retention policy** — now mandatory. Retain only as long as
      necessary for a documented purpose, then delete. Your "nothing is stored"
      design satisfies this cheaply; write it down.
- [ ] Privacy notice must list data categories, purposes, retention periods and
      any third-party recipients **by name**.
- [ ] If you ever get actual knowledge of an under-13: delete their data and
      terminate access. Do not attempt parental consent — verifiable parental
      consent for a hobby project is not realistic.

### 5.2 Section 230
- [x] Generally protects you from liability for what users say, and moderating
      does not forfeit it. This is why filtering is safe to do.

### 5.3 State laws
- [ ] Mostly threshold-based (revenue / user counts) and you're far below.
      Revisit if the service ever grows or takes money.

---

## Part 6 — GDPR (cross-cutting, applies regardless)

Ephemerality does not exempt you: transmission is processing.

- [ ] **Legal basis** — legitimate interest for operating the chat; document the
      balancing test. Consent is the wrong basis here.
- [~] **Privacy policy** — you have `PRIVACY.md`. Host it at a stable https URL
      and make sure it covers the relay, the metrics pipeline (hashed IPs,
      OpenObserve, retention) and any subprocessors (GCP).
- [ ] **Art. 30 records of processing** — the <250-employee exemption falls away
      for non-occasional processing or special-category data. Chat content can
      contain anything. Keep a one-page record; it's cheap.
- [ ] **Data subject rights** — with no storage, most requests resolve to
      "nothing retained." Say so in the policy and be able to prove it.
- [ ] **Art. 28 processor agreement** with GCP (their standard DPA covers this).
- [ ] **DPIA** — arguably triggered by processing communications of a
      possibly-minor user base. If you keep `__global__`, do one.

---

## Part 7 — Store-level gates (blocking, and sooner than any regulator)

Your Firefox manifest declares `personallyIdentifyingInfo` and
`personalCommunications`. Both stores act on this before any regulator will.

- [ ] Privacy policy at a public https URL — **required** by both stores.
- [ ] Chrome Web Store data-use disclosures matching what you actually collect.
- [ ] Mozilla data-collection consent flow for the declared categories.
- [ ] Trademark: rename away from "OpenFront Chat" and add a
      "not affiliated with OpenFront Inc." disclaimer. Store trademark
      complaints are actioned fast.

---

## Part 8 — What you already have

Genuine credit — several of these exceed the regulatory floor:

- Server-side content filter with reason categories (`oftc_filter_hits_total`)
- Rate limiting: 1 msg/s, burst 3, 10/min; 20 connections/min/IP
- Room caps: 12 per match, 200 global
- No message persistence
- Salted-hashed IPs and nicknames in telemetry
- Identity inherited from the in-game username — no separate anonymous handle
  to hide behind, which is a real accountability property most chat services
  don't have
- Origin allowlist + shared secret

One caveat on the last: `config.prod.js` ships inside the extension, so the
shared secret is publicly extractable. Treat the relay as open to anyone who
unzips the package, and say so in the risk assessment rather than claiming
access control you don't have.

---

## Part 9 — Suggested order

1. Decide 0.1 and 0.2. Everything downstream depends on them.
2. Impressum + hosted privacy policy + terms. (Part 3.1, 1.3, 6) — blocks store
   submission anyway.
3. Report button + relay report endpoint + ban capability. (1.4, 1.6) — the
   biggest real gap, and the thing a regulator or a moderator would ask about
   first.
4. Write the two UK assessments. (4.1, 4.2) — a few hours with Ofcom's template.
5. Retention policy + metrics retention. (1.5)
6. Rename and add the affiliation disclaimer. (Part 7)
7. Revisit if you ever take money, add persistence, or add images/links/files —
   any of those three changes the analysis materially.
