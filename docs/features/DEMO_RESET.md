# Demo reset and playbook (D061)

For the team running the live demo: Adam, Rishi, Nimisha and Sumedh, each with the app on their phone, and the backstage open on Adam's laptop.

Before each new judge, tap **Reset demo** on the backstage. All four accounts go back to the same starting board, and every scenario below works live: real Claude, Droid agents, Cartesia, Apify and Maincloud. Nothing is scripted or faked.

## The starting board

| Person | Linked with | Their windowsill shows | Main roles |
|---|---|---|---|
| **Adam** | Rishi | Nimisha (nearby), **Sumedh** ("someone Rishi knows") | Sends nudges; friend-of-friend request |
| **Rishi** | Adam, Sumedh | Nimisha (nearby) | Receives nudges; accepts the introduction; recipient controls |
| **Nimisha** | nobody (new in town) | Adam, Rishi, Sumedh (all nearby) | Says hello to someone nearby; live events refresh |
| **Sumedh** | Rishi | Nimisha (nearby), **Adam** ("someone Rishi knows") | Voice journaling; accepts the friend-of-friend request |

- Every link is nudge-ready both ways: friend preset assigned, standard support styles, notes on, no quiet hours.
- Everyone is published on UC Berkeley campus, with overlapping interests:
  - Adam: coffee, climbing, live music, hiking
  - Rishi: coffee, live music, board games, film
  - Nimisha: coffee, live music, books, hiking
  - Sumedh: climbing, coffee, running, photography
- **Cleared on reset:**
  - On the server: every signal, held nudge, delivered nudge, introduction, friend-of-friend request, plan, event interest, pause, block and reasoning decision involving the four of you.
  - On each phone: the notebook, dor's device memory, sent marks and open sheets. This happens as soon as the phone syncs; nobody signs out.
- **Kept:** the accounts, sign-ins, profile text and the event and place catalogue.

## One judge, start to finish

1. **Before they walk up:** on the laptop, tap **↺ Reset demo** and then **Tap again to reset**. Check that every playbook card says **ready** (green). Each phone briefly shows "Fresh demo".
2. **Opening, about 30 s:** Adam shows his room on his phone. The laptop shows the backstage.
3. **Default path, about 3 min:** scenarios 1 → 2 → 3. Together these show an instant nudge, a held nudge and the help line, and every tool lights up on the backstage.
4. **"What would you like to see?"** Point at the playbook. The person named on the card runs it.
5. **When they leave:** reset again. It takes about 2 seconds.

## Scenarios

"Once" means the scenario changes the board, so it needs a reset before it can be shown again. Everything else repeats.

| # | Scenario | Who | Do this | Judges see | Once? |
|---|---|---|---|---|---|
| 1 | Instant nudge | Adam → Rishi | Write good news that names Rishi, e.g. "Rishi helped me prep and I got the internship!", then **Send** | A note in Rishi's tray within seconds, with a generic starter. Backstage: Claude, then the agents, then delivery. | no |
| 2 | Held nudge | Adam → Rishi | Write bad news, e.g. "I didn't get the job. I want to talk to Rishi about it." | The phone says dor will nudge Rishi later. Backstage: a **held signal** with its delivery time. It does not arrive during the demo. | no |
| 3 | Help line | anyone | An entry with real distress ("I feel hopeless, I don't feel safe") | The 988 card. Nothing appears on the backstage, because nothing was sent. | no |
| 4 | Holding back | Adam | "I need some space from Rishi" or "I owe Rishi an apology" | No note goes out. For the apology, Rishi's book on Adam's shelf says it's his to say himself. | no |
| 5 | Voice + keep talking | Sumedh | Tap the mic, talk about the week with Rishi, tap again, then **Keep talking**, then **Send** | Cartesia dictation and read-aloud, a Claude follow-up question, then a nudge to Rishi | no |
| 6 | Friend of a friend | Adam → Sumedh | Adam opens "someone Rishi knows" on his sill and sends. Sumedh opens the envelope on his mat and accepts. | No name until Sumedh accepts; then each gets the other's book | **yes** |
| 7 | Meet someone nearby | Nimisha → Rishi | Nimisha opens Rishi's postcard and says hello. Rishi accepts on his mat. | Discovery from shared interests with no model call; a loose page for both | **yes** |
| 8 | Live events | Nimisha | Window → **↻ Refresh nearby** | Live Apify runs on the backstage; new flyers and "for you" picks | no |
| 9 | Plan together | Adam + Rishi (any time), or Rishi + Nimisha (after 7) | Both tap "show my interest" on the same flyer | The worker proposes a plan; each accepts; it shows on both calendars | **yes** |
| 10 | Recipient in control | Rishi | Turn off notes from Adam in Adam's book. Adam then writes good news about Rishi. | Reasoning still runs but nothing is delivered. The backstage nudge path turns red and says why. | **yes** |

Order tips:
- Run 6 or 7 before 1 if you want the new book or page to appear during the visit.
- Run 10 last, because it blocks 1 and 2 until the next reset.
- 9 needs events in the window. If the window is empty, run 8 first.

## One-time setup (module owner)

This setup needs the D061 module, which Nimisha republishes once. Then the module owner adds the four accounts to the roster:

```sh
spacetime call -s maincloud dor set_demo_member '{"__identity__":"0x<adam>"}' adam true true
spacetime call -s maincloud dor set_demo_member '{"__identity__":"0x<rishi>"}' rishi false true
spacetime call -s maincloud dor set_demo_member '{"__identity__":"0x<nimisha>"}' nimisha false true
spacetime call -s maincloud dor set_demo_member '{"__identity__":"0x<sumedh>"}' sumedh false true
```

- The arguments are: identity, slot, operator, enabled.
- Only Adam is the operator, because the backstage runs as Adam's account.
- Each account must have signed in to the live app once.
- Adam's account must also be an observer (`set_observer_identity`, D053).

## If something looks wrong

- **The Reset button is greyed out:** the signed-in backstage account isn't the demo operator. Check the roster.
- **"demo roster incomplete":** one slot has no account. Add it with `set_demo_member`.
- **A card says blocked:** the note on the card says why. Reset fixes anything the last demo changed.
- **A phone still shows the last judge's notebook:** pull to refresh or reopen the app. The phone clears itself when it reconnects.
