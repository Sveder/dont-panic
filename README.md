# Don't Panic AR: Route to Safety

A Lens for Snap Spectacles. During an alert, it shows a hands-free route to the nearest shelter.

The project is a Lens Studio 5.24.1 project. It has no 3D city model. The Lens draws only a HUD. In the demo, the HUD runs on top of a video of a real street walk, with the GPS and the compass that were recorded on that walk.

**State of the project:** the Lens runs in the Lens Studio preview. It never ran on Spectacles. See [Known limits](#known-limits).

## What the HUD shows

- At about 12 s, the siren detector raises the alarm. The red card says "ROCKET ALERT · 57 s", the view flashes red for 4 s, and the siren plays.
- An arrow stays in view. It points to the next corner of the street route, relative to where the camera looks. The HUD says "TURN AROUND" when the next corner is more than 120 degrees away.
- A one-line chip at the bottom shows the distance and the result, for example "53 m · you make it". The speed is 1.2 m/s.
- A green pin marks the shelter when the shelter is in the field of view (66 degrees).
- "GO INSIDE" shows within 5 m of the shelter.
- After the alert time, "STAY IN THE SHELTER" counts down 10 minutes. Then the HUD says "YOU CAN LEAVE THE SHELTER". A new alarm restarts the sequence.
- A Stop button at the lower right. A hold of 0.5 s turns off the HUD, the siren and the detector.

## Open and run

1. Open `dont_panic.esproj` in Lens Studio 5.24.1.
2. Set the Preview device to Horizontal (16:9).
3. Show the walk with one of these two ways:
   - Select `HUD Controller` and tick `Use Video Texture`. The Lens then plays the video itself. This way worked on a desktop PC. In a VM with software OpenGL, the video stayed on its first frame.
   - In the Preview panel, open the input menu, choose Video, and select `Assets/Video/walk884c.mp4`. Then press the Preview refresh button once, so the Lens clock and the video start together.

To see the Lens time, the heading and the pitch, tick `Show Debug` on `HUD Controller`.

## How it works

The scripts are in `Assets/Scripts`.

- `Lens2Hud.ts`: the scene script on `HUD Controller`. It moves the screen objects each frame.
- `HudLogic.ts`: pure logic, with no Lens globals. It decides what the HUD shows at time t.
- `ReplayTrack.ts`: the recorded walk. Smoothed GPS, heading and pitch, 10 samples per second.
- `Router.ts`, `GeoFrame.ts`, `Region.ts`, `WalkDataRG.ts`, `WalkDataTLV.ts`: a shortest-path router on OpenStreetMap walk graphs. The graphs and the shelter locations are stored in the Lens. Routing needs no network.
- `SirenMic.ts`, `SirenFeed.ts`, `SirenDetector.ts`: read the audio, resample it to 16 kHz, and look for the rising and falling sweep of a siren between 300 and 1200 Hz. The `source` input selects `mic` or `file`. The saved scene uses `file`, so the demo siren passes through the same detector.
- `LiveSensors.ts`, `LivePath.ts`: the live GPS and compass path.
- `AlertFeed.ts`: the official alert path.

The project was planned with the Devpost Learn skill pack (`devpost/design-brief.md`). It was built in Lens Studio with CLAD and the Lens Studio MCP. The Devpost text is in `devpost/submission.md`.

## Live sensors: built, not tested on a device

The input `source` on `HUD Controller` selects the data. `replay` is the default. `live` reads the Spectacles sensors.

- The Lens reads the position once a second, and the north-aligned heading.
- It runs the same route, shelter choice, distance, bearing and pin as the replay.
- No GPS, weak GPS, no compass or a position outside the map gives a plain line on the chip, and no arrow.
- A live position outside the active map selects the nearest stored area that holds it.

The live path was tested with fake sensor values. Lens Studio compiled it and ran the real API in the preview.

## Official alert path: built, not tested on a device

The path is off by default. With `Alert Url` empty, the Lens makes no network request.

The Home Front Command feed answers Israeli IP addresses only. So the Lens polls a small relay server every 2 s. The relay is not in this repo, and it has no public address. A real run needs a public HTTPS URL for the relay.

To turn the path on, set `Alert Url` and `Alert Area` on `HUD Controller`, add an Internet Module asset, and wire it to `Internet Module`.

Snap blocks internet access together with the microphone or GPS in a published Spectacles Lens. See https://developers.snap.com/spectacles/permission-privacy/overview. A build with this path on and the microphone or GPS on needs Extended Permissions, which are experimental and not publishable.

## Known limits

- No run on Spectacles. The route, the arrow and the pin in live mode have only fake-sensor proof.
- The project is a mobile-type project, so that the preview can show the walk video. It must become a Spectacles project before it can run on glasses.
- The dark plates draw nothing on the additive Spectacles display.
- The Stop button needs a mouse or a touch. The project has no pinch input.
- The map covers the walk area and a central Tel Aviv area with 31 municipal shelters. The walk area has one shelter, and its position comes from the end of the walk.
- The microphone path was not tested with a real siren or on a device. No power measurement exists.
- The demo video in the Devpost submission comes from an earlier build. It has larger labels and no Stop button, and a timer starts the alert.
- The walk video is 93 s long and loops in the preview.

## Credits and license

- Code and project files: MIT, see `LICENSE`.
- Street data: OpenStreetMap contributors, ODbL.
- Tel Aviv shelters: Tel Aviv municipal GIS open data.
- Siren audio: Wikimedia Commons, CC0 or public domain.

Made by Sveder, https://sveder.com
