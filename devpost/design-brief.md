---
status: draft
---

# Design brief: Route to Safety

<!-- Filled in by plan-lens from the written brief and the agreed points. Open values are marked (assumption). Values from design rules are marked (default). -->

## The one spatial moment
A rocket siren goes off in Tel Aviv. A parent picks up two children and runs. With zero touches between the alert and the shelter door, the parent sees arrows drawn on the ground in the world leading to the nearest shelter, with the meters and the seconds left floating just above the next arrow, and he hears the turns spoken. In the words of the brief: "The whole point is hands-free showing route to safety, when you need to take two kids on your hands and run it is hard to open google maps on phone to find a route."

## Why it belongs on glasses
- Uses: leaves your body free (both arms carry kids, eyes stay on the street) and draws in the world (the route is drawn on the real ground, and the shelter is marked on its real spot).
- Why it's better than the phone version: with a phone he has to free a hand, unlock it, open a map and look down at it while running. Here the route is already computed before the alert and appears the moment it fires, on the ground in front of him.

## Product or overlay
- Type: overlay. It responds to a real alert and guides him to a real place.
- What the real version would sense: the alert, from GPS plus official alert APIs (Home Front Command in Israel, JMA in Japan), a phone push, or the sound of the siren. It also senses his location, to find and route to the nearest shelter.
- Stand-in for the preview:
  - **Alert trigger:** two big, clearly labeled trigger buttons in the scene: "Israel siren" and "Japan tsunami alert". The Japan trigger has a choice of alert file: Actual or Exercise. (assumption)
  - **Location and route:** shelters are markers placed across the preview room, and the route is a pre-computed path on the virtual floor. The shelter names and the "nearest / second-nearest / tsunami-flag" selection come from the real data files (see Build notes).
  - **Alert content:** the real sample files (HFC alert JSON, JMA Actual and Exercise XML) are parsed to decide what happens. The Lens does not fetch live feeds.

**Two triggers, one flow (assumption).** The core flow is the Israeli siren and the run to the shelter. The Japan tsunami alert is a second trigger into the same flow, with one extra step. First it checks the alert status, and it ignores the alert if it's a test or an exercise. For a tsunami the target is the evacuation site with the tsunami flag (high ground), not simply the nearest site.

## Where things live
- Where the user is looking during the main task: at the ground a few meters ahead, along the path he's running.
- **Ground arrows:** a chain of arrows lying on the floor along the path, starting about 1 to 2 m ahead of him (assumption). Big and bright, about 40 cm long (default), spaced about 1 m apart (default).
- **Meters and seconds readout:** a small readout floating just above the next arrow, about 30 cm above the floor (default), so his eyes stay on the path (assumption). Example: "42 m · 61 s".
- **Spoken-turn text line:** each spoken turn also shows as one short text line next to the readout (assumption). Example: "Turn left".
- **Official-app note:** one line, "Follow your official alert app first. This lens only helps with the route.", shown at the start of the alert, about 1 m ahead and a little below eye level. It fades after about 4 seconds (assumption).
- **Shelter marker:** a tall marker on the shelter's spot, a glowing column or door frame about 2.5 m tall (default) with the shelter name on it, visible from across the room (assumption).
- **Turn-around hint:** a small arrow at the edge of the view pointing the way to turn (assumption).
- **Trigger buttons (stand-in only):** off to the side at the start position, at hand height, clearly labeled as demo triggers.

## Hands and input
- Alert to shelter door: **zero touches.** Nothing on the route needs a hand.
- Switch to the second-nearest shelter: the voice word **"next"** (project decision), plus a big **Next** button for the preview, since voice may not work there (assumption). The button floats beside the readout. Pressing it is a pinch.
- Demo triggers: pinch the "Israel siren" or "Japan tsunami alert" button (stand-in).
- Targets are big and highlight when aimed at.
- Voice and the button that does the same job: "next" ↔ the Next button.

## When things show
- Before the alert: nothing but the demo trigger buttons. The route to the nearest shelter is already computed, so it can show at once.
- Siren sound: plays when the Israel trigger fires. Use the plain siren recording (assumption).
- Official-app note: shows when the alert fires, fades after about 4 s.
- Ground arrows, readout, shelter marker: show within 1 second of an Actual alert. They hide on arrival.
- Spoken turns: spoken at each turn, each also shown as a text line with a chime (assumption), so the demo still works if speech is silent in the preview.
- Countdown: counts down from the alert time using the official time to shelter for the alert area. Tel Aviv is 90 s. For the Japan tsunami alert, use the estimated arrival time from the alert if it has one; otherwise show meters only (assumption).
- Countdown reaches zero before arrival: the guidance does **not** stop. The readout shows "0 s, keep going" and the arrows stay (assumption).
- Arrival: within about 3 m of the shelter marker, a chime plays, one line shows ("You are at the shelter"), and the arrows clear (assumption).
- Japan Exercise or test alert: nothing shows and the Lens stays quiet (assumption).
- Japan Actual alert: the route to the tsunami-flag site appears at once.
- If something needs attention out of view: if the first arrow is behind him when the alert fires, an edge arrow points the way to turn and a spatial sound plays from the direction of the first arrow. Both stop once the path is in view (assumption).

## Done criteria
Each one can be checked in Lens Studio's preview. (All five are assumptions drawn from the agreed points.)
1. Pressing the Israel siren trigger draws the ground arrows to Shelter A within 1 second, with the meters and a 90 s countdown above the next arrow. No other click is needed until arrival.
2. Walking (WASD) along the arrows lowers the meters. Within about 3 m of Shelter A the chime plays, "You are at the shelter" shows, and the arrows clear.
3. Pressing the Next button (or saying "next") redraws the path to Shelter B, the second-nearest.
4. Pressing the Japan trigger with the Exercise alert file shows nothing. Pressing it with the Actual alert file draws the path to the high-ground site with the tsunami flag, not to the nearer site without the flag.
5. Facing away from the path when the alert fires shows the edge arrow and plays the spatial sound. Turning toward the path removes them.

## Out of scope
- Real alert detection: live HFC or JMA feeds, phone push, recognizing a real siren sound, real GPS.
- Real street routing or real maps. The route is a pre-computed path in the preview room.
- Other disasters beyond the rocket siren and the tsunami warning (earthquake-only alerts, eruptions), and other countries or cities beyond Tel Aviv and Zushi.
- Replacing the official alert app. The Lens says so up front.
- Anything that tracks or identifies other people.

## Risks and open questions
- **To check: alert file type.** `jma_VXSE53_*` is JMA's earthquake bulletin; the real tsunami warning type is **VTSE41**. The Actual/Exercise status check works the same, but a real tsunami build should parse VTSE41 (and its arrival-time field).
- **Voice and speech in the preview:** "next" and the spoken turns may not work in the preview. The Next button and the text-plus-chime lines carry the demo.
- **Feel unproven:** whether ground arrows are visible and readable while running with kids, in sunlight, through the narrow view of the glasses; whether glancing at the ground near the feet is comfortable.
- **Real-world only:** GPS accuracy indoors and between buildings, how fast a route can be computed offline, and whether the "route already computed before the alert" approach keeps the battery alive. None of this can be tested in the preview.
- **Safety:** an evacuation aid that is wrong or slow could cause harm. The "official app first" note and "keep going" at zero are there for this reason. A real release would need official data and testing far beyond this demo.
- The `0 s` countdown and Tel Aviv's 90 s are from the alert-area table; other areas have other times (source to confirm).

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.
- **Data files** live outside the project in `../data/` (see `../data/README.md`). Copy what you need into `Assets/Data/`:
  - `tlv_shelters_municipal.geojson`: pick the two shelters used in the demo (Shelter A nearest, Shelter B second-nearest) and show their real names.
  - `zushi_evac_sites_gsi.geojson`: pick one site with `tsunami: true` (the target) and one nearer site without it (the decoy), and show their real names.
  - `alerts/hfc_alert_sample.json`: parsed when the Israel trigger fires (cat 1 = rockets and missiles).
  - `alerts/jma_VXSE53_actual_20261021.xml` and `alerts/jma_VXSE53_exercise_DERIVED.xml`: the Japan trigger reads Control/Status. 通常 (Actual) shows the route; 訓練 (Exercise) stays quiet.
  - `audio/Civil_defense_siren_waver.ogg`: the siren sound (assumption: the plain siren, not the recording with explosions). Convert to WAV or MP3 if Lens Studio won't import OGG.
- **Room layout (assumption):** map the demo shelters to fixed positions in the preview room, using real-world scale. Shelter A about 8 m from the start, Shelter B about 12 m in another direction. For Japan, the decoy site is nearer than the tsunami-flag site. Each route is a pre-computed path with at least one turn, so there's a spoken turn to show. Put the start position so that criterion 5 can be tested by turning the user away from the first arrow.
- **Trigger buttons:** keep them labeled as demo stand-ins. After a trigger fires, nothing else needs a click until arrival.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
