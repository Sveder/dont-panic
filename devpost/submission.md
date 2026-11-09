# Devpost submission: Don't Panic AR (Route to Safety)

Hackathon: Learn AR with SPECS, https://learn-specs.devpost.com/
Deadline: Nov 9, 2026, 5:00 pm EST (Nov 10, 00:00 Israel time).
Author: Michael Sverdlin (Sveder), https://sveder.com

## Requirements, copied from the hackathon page (read 2026-11-07)

What to build:
- A new Lens for SPECS. Plan it with the Devpost Learn skill pack. An AI coding agent builds it through CLAD in Lens Studio.
- New project. Started during the submission period. Old ideas are fine, old code is not.
- Planned with the skill pack. The repo should include the planning docs the skill pack writes to the devpost folder.
- Built with CLAD. The coding agent builds the Lens in Lens Studio through the CLAD plugin and the Lens Studio MCP.
- Runs in the Lens Studio preview. SPECS glasses are not necessary.

What to submit:
- A demo video, public on YouTube, that shows the Lens working. Under 3 minutes. A screen recording of the Lens Studio preview is fine. If you can, talk about the design process.
- A public repo on GitHub, GitLab, or Bitbucket, with the Lens Studio project files and the devpost folder.
- A short description: what the Lens does, who it is for, and what you learned.
- Reviewers do not clone or run the project. The video must show it working.

Judging criteria: Design (a complete, coherent product, not only a technical proof), Technical
Implementation (use of CLAD, Lens Studio and the Lens Studio MCP), Innovation/Idea, Presentation
(the video shows the project end to end; the pitch says the problem, the user and why it matters).

## Labels in this file

- **logic proven**: a node test or a Lens Studio preview check in our VM shows the feature working. The node tests are not in this repo.
- **feel unproven**: only real Spectacles on a real street can show it. We did not test on glasses.

---

## Project name

Don't Panic AR: Route to Safety

## Tagline

A rocket siren starts. Your hands hold two children. The glasses show the way to the shelter.

## Inspiration

In Israel a rocket alert gives a person 15 to 90 seconds to reach a shelter. A parent who walks
with two small children has no free hand for a phone. That parent must find the nearest shelter
and know if the family can reach it in time.

Two more people have the same problem in a different form:
- A person with hearing loss. That person does not hear the siren and sees only people who run.
- A tourist. That person hears the siren but does not know what it means or where to go.

A phone app needs hands and eyes on a small screen. Glasses can show the route in front of the
eyes, with zero touches from the alert to the shelter door.

## What it does

The Lens plays over a real walk: a video of one street walk (93 s, recorded on 2026-11-07, with GPS and compass). The video stands in for the street that the user sees through Spectacles. The Lens draws only a HUD. There is no 3D city model.

**About the demo video.** The video was recorded from an earlier build. It has larger labels and no Stop button, and a timer starts the alert. The project in this repo has the two-line HUD and the Stop button. In this project, the siren detector starts the alert.

1. **Alert.** At about 12 s the siren detector hears the siren and a red card says "ROCKET ALERT · 57 s", with the seconds counting down. The whole view flashes red for 4 s. A siren sound plays. Logic proven; screenshot `docs/t51-view-flash.png`.
2. **Visual siren.** The Lens listens to the microphone. A pitch detector finds the rising and falling sweep of a siren. A hit starts the alert, with the red card and the red flash. In the project the siren comes from an audio file read through the same detector path, not from a real microphone. A plain tone, noise and silence give no alert. Logic proven. Feel unproven: the microphone path on real Spectacles, and a real siren in a noisy street. Our VM has no microphone.
3. **Arrow to the next corner.** An arrow stays in view. It points to the next corner of the street route to the shelter, relative to where the user looks. The route comes from a shortest-path search on the OpenStreetMap walk graph of the area, inside the Lens, with no network. When the next corner is more than 120 degrees away, the HUD says "TURN AROUND". Logic proven; screenshot `docs/t52-arrow-turn-around.png`.
4. **Time to the shelter against the alert time.** The bottom line says, for example, "54 m · you make it". The walk speed is 1.2 m/s, a pace with two children. When the walk takes longer than the alert time left, the line says "Not in time · enter a building or lie down", the short form of the Home Front Command fallback. Logic proven; screenshot `docs/t50-time-cover.png`.
5. **Shelter pin.** A green pin marks the shelter on the video when the shelter is in the field of view. Within 5 m the bottom line says "GO INSIDE". Logic proven; sheet `docs/t53-demo-v2-sheet.png`.
6. **Stay countdown and a second alarm.** When the alert countdown ends, "STAY IN THE SHELTER" counts down 10 minutes. At 0 the HUD says "YOU CAN LEAVE THE SHELTER". A new alarm during the wait starts the full sequence again. Logic proven; screenshot `docs/t49-stay-leave-realarm.png`.
7. **Stop button.** A hold on the button turns off the HUD, the siren and the detector. It works with the mouse in the preview. This project has no pinch input yet.
8. **Readable HUD.** At most two label lines. Every line is bold and bright, with a black outline. Feel unproven: daylight on the additive Spectacles display.

## How we built it

- **Planning.** The Devpost Learn skill pack (plan-lens) wrote the design
  brief, `devpost/design-brief.md`.
- **Building.** An AI coding agent (Claude Code) built the Lens in Lens Studio 5.24.1 through the CLAD
  plugin and the Lens Studio MCP. Lens Studio runs in a Windows VM. The agent made
  the scene objects through MCP calls and wrote the TypeScript scripts.
- **Pure logic, tested outside Lens Studio.** All HUD decisions are in `HudLogic.ts`, with no Lens
  globals. Node tests load the same TypeScript and check it frame by frame on the recorded walk.
  The Lens scene script `Lens2Hud.ts` only moves the screen objects.
- **Real data.** The walk graph comes from OpenStreetMap. A phone app (walkrec) recorded the walk:
  video, GPS and compass. A script smooths the track and writes it as
  `ReplayTrack.ts`, 10 samples per second.
- **Siren detector.** First a Python prototype (FFT pitch from 300 to 1200 Hz, a one-way sweep test).
  Then a step-by-step port to TypeScript that gives the same hits as the Python version.
- **Demo video.** A screen recording of the Lens Studio preview at 60 fps on a desktop PC, with a voice-over.

## Challenges we ran into

- The first version modeled the streets in 3D. Michael said the real world is the source, so we
  dropped the city model and kept only the HUD over the walk video.
- The VM has software OpenGL. A video texture stays on its first frame, so the demo uses the
  camera-input video of the preview.
- The Lens Studio Record button used 3.5 GB and stopped Lens Studio after about 4.5 minutes.
  We changed to host screenshots.
- The first arrow had no shaft. At 120 to 180 degrees its wide base looked like the tip, so it seemed
  to point forward while the HUD said "TURN AROUND".
- Thin text was almost unreadable over a white facade. We added bold text, outlines and dark plates.
- The Lens clock had to stay in step with the walk video. We measured it with a timecode video:
  the gap stayed between 0.1 and 0.2 s and did not grow.

## What we learned

- On glasses, one word per glance is the limit. A person who runs with two children reads
  "TURN AROUND", not a sentence.
- Pure logic with node tests lets an agent check a design without the slow editor. The editor then
  only confirms the picture.
- The real world is the best background for an AR demo. A modeled city looks like a game.
- Design for the person who cannot hear the alert. A red flash in the view helps everyone.

## Live sensors

The code reads the Spectacles sensors, not tested on a device. An input on the HUD controller selects the recorded walk (default) or
the GPS and the compass. The live path uses the same router, shelter choice, distance, bearing and pin as the replay. With no GPS fix, poor accuracy or
a position outside the map, the HUD shows a plain line and no arrow. Logic proven with fake sensor values. Feel unproven.

## What's next

- A test on real Spectacles: the microphone, the compass, real GPS and daylight. All "feel unproven" items.
- Live alerts: a public address for the Home Front Command relay. The relay and the Lens code are built, and the code path is off by default. It is not tested on a device. Then the JMA feed for tsunami
  warnings (Japan, only real alerts, not exercises or tests), and air-raid alerts in Ukraine.
- More shelter data, from municipal open data and OpenStreetMap. Today the Lens holds the walk area and a central Tel Aviv area with 31 municipal shelters. The live path picks the area from the GPS position.
- Text in Hebrew, English, Japanese and Ukrainian, for tourists and residents.
- Spoken turns, and the voice word "next" for the next shelter.
- Platform settings for Spectacles. The current project is a mobile-type project for the demo video.

## Built with

Lens Studio 5.24.1, TypeScript, CLAD, Lens Studio MCP, Claude Code, Devpost Learn skill pack
(plan-lens), OpenStreetMap walk graph, walkrec (GPS and compass walk recording), Python (numpy, siren
prototype), Node.js (tests), ffmpeg, ElevenLabs (voice-over).

## Links

- Repo: https://github.com/Sveder/dont-panic
- Lens Studio project: `dont_panic.esproj`, how to open it: `README.md`

Made by Sveder, https://sveder.com
