# Snap

Snap your fingers and vanish from your own video in Google Meet. You stay in the call, your picture just dissolves (6 effects to choose from) and leaves an empty room behind, until you snap again.

A Chrome extension. Everything runs locally in your browser: no video or audio is ever sent anywhere, and it works fine offline (aside from the call itself).

## Install (3 minutes, no terminal needed)

1. At the top of this page, click the green **`Code`** button → **`Download ZIP`**.
2. Unzip the downloaded file (just double-click it). You'll get a folder, something like `snap-main`.
3. Move that folder somewhere it won't get lost, for example your `Documents` folder. Don't delete or rename the files inside it.
4. Open Chrome and go to: `chrome://extensions`.
5. Turn on **`Developer mode`** (toggle in the top right of the page).
6. Click the **`Load unpacked`** button that appears on the left, and select the folder from step 3.
7. The extension now shows up in the list. Done — open Google Meet (reload the tab if it was already open).

It's normal that Chrome doesn't offer a one-click install like it does for the Chrome Web Store. This is a personal extension, not published in the store, so it needs `Developer mode` to load. That's not dangerous, it's just Chrome's standard way of loading extensions from outside the store.

## How to use it

1. Join a Meet call and allow camera and microphone access when the browser asks.
2. Click the **Snap icon** in the Chrome toolbar (pin it from the puzzle-piece menu so it's always visible). Everything is controlled from there:
   - **On / off switch** — off means your camera goes to Meet untouched and the mic is released. You can also flip it with `Alt`/`Option` `+ Shift + S`.
   - **Background** — Snap needs to know what's behind you. Either:
     - **Capture room**: press it, step out of frame, and wait for the beep (countdown is adjustable, 5 s by default).
     - **Upload image**: if you use a macOS camera background (Control Center → Video Effects → Background), upload the same picture. The camera then already shows you on top of a known image, so the cut-out is clean and you never need to leave the frame. Snap figures out on its own if the picture needs to be mirrored.
     The background is saved, so it survives reloads.
   - **Effect** — pick one of 6.
   - **Duration** — how long the vanish takes.
3. Snap your fingers (a normal, sharp snap) to vanish. Snap again to come back. You can snap as many times as you like, and snapping mid-way turns the effect around.

Other ways to trigger it: the **Vanish** button in the popup, `Alt`/`Option` `+ Shift + X` from anywhere in Chrome, or `Cmd`/`Ctrl` `+ Shift + X` inside the Meet tab. Shortcuts can be changed at `chrome://extensions/shortcuts`.

There is also a small pill in the top left of Meet with the same basics. `Cmd`/`Ctrl` `+ Shift + H` hides it (or untick it in the popup).

## Effects

| Effect | What happens |
| --- | --- |
| Dust | The original: you crumble into grains that drift away |
| Burn | A glowing edge eats through you like burning paper, embers float up |
| Ghost | You go soft and see-through and drift upwards |
| Melt | You drip down like wax |
| Portal | You spin and shrink into a purple vortex that closes behind you |
| Hedge | The Homer Simpson ("Homer Loves Flanders", 1994): a hedge rises behind you, you back slowly into it, the leaves swallow you from the outline in, face last, it rustles and sinks away. Coming back is Homer stepping out of the hedge |

## Troubleshooting

- **Not reacting to snaps** — open the popup and snap: the mic meter shows how loud it was, and the snap has to cross the white line. If it doesn't, move `Snap sensitivity` to the right. If the popup says the mic is asleep, click once anywhere on the Meet page (Chrome keeps audio paused until you do). Snapping close to the laptop works best.
- **Triggers on its own** — move it to the left. Snap ignores clicks that come right before or after other sounds (talking, typing), but a single loud isolated key press can still count.
- **The disappearing looks messy / leaves a trace** — the lighting changed since you captured the room. Capture again, or use a macOS camera background and upload the same image.
- **The popup says "Reload the Meet tab"** — the extension was installed or updated after Meet was opened. Reload the tab.
- **The button never shows up at all** — check that `Developer mode` is on and the extension is enabled (toggle is blue) on `chrome://extensions`.
- Keep the camera still and the lighting steady, otherwise the saved room stops matching reality.

## Privacy

Everything happens locally, inside your browser: no camera frame and no microphone audio is ever sent anywhere, there's no server this extension talks to. The microphone is only used to listen for the finger snap itself, the audio is never stored or recorded, and it is released when Snap is switched off or the finger snap trigger is disabled. The saved background image stays in Chrome's local extension storage on your computer.
