# Snap

Snap your fingers and vanish from your own video in Google Meet. You stay in the call, your picture just dissolves (8 effects to choose from) and leaves an empty room behind, until you snap again.

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
   - **Effect** — pick one of 8, or Random.
   - **Duration** — how long the vanish takes.
3. Snap your fingers (a normal, sharp snap) to vanish. Snap again to come back. You can snap as many times as you like, and snapping mid-way turns the effect around.

Other ways to trigger it: the **Vanish** button in the popup, `Alt`/`Option` `+ Shift + X` from anywhere in Chrome, or `Cmd`/`Ctrl` `+ Shift + X` inside the Meet tab. Shortcuts can be changed at `chrome://extensions/shortcuts`.

There is also a small pill in the top left of Meet with the same basics. `Cmd`/`Ctrl` `+ Shift + H` hides it (or untick it in the popup).

## Effects

| Effect | What happens |
| --- | --- |
| Dust | The original: you crumble into grains that drift away |
| Burn | A glowing edge eats through you like burning paper, embers float up |
| Teleport | Beamed up from the feet to the head, with cyan sparks |
| Ghost | You go soft and see-through and drift upwards |
| Glitch | The signal breaks: slices jump, colours split, then cut |
| Pixelate | You turn into big blocks that fall out one by one |
| Melt | You drip down like wax |
| Portal | You spin and shrink into a purple vortex that closes behind you |

## Troubleshooting

- **Not reacting to snaps** — move the `Snap sensitivity` slider to the right (more sensitive).
- **Triggers on its own**, for example from talking or knocking sounds — move it to the left.
- **The disappearing looks messy / leaves a trace** — the lighting changed since you captured the room. Capture again, or use a macOS camera background and upload the same image.
- **The popup says "Reload the Meet tab"** — the extension was installed or updated after Meet was opened. Reload the tab.
- **The button never shows up at all** — check that `Developer mode` is on and the extension is enabled (toggle is blue) on `chrome://extensions`.
- Keep the camera still and the lighting steady, otherwise the saved room stops matching reality.

## Privacy

Everything happens locally, inside your browser: no camera frame and no microphone audio is ever sent anywhere, there's no server this extension talks to. The microphone is only used to listen for the finger snap itself, the audio is never stored or recorded, and it is released when Snap is switched off or the finger snap trigger is disabled. The saved background image stays in Chrome's local extension storage on your computer.
