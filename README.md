# Snap

Snap your fingers and vanish from your own video in Google Meet. You stay in the call, your picture just dissolves into particles and leaves an empty room behind, until you snap again.

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
2. A small dark pill button appears in the top left. Click it, then click `capture empty room`.
3. Step out of frame for about 3 seconds, the extension takes a photo of the empty room.
4. Sit back down. The status will change to `armed`, meaning it's ready.
5. Snap your fingers (a normal, sharp snap). You'll dissolve into particles and disappear from the video. Snap again to come back.

Backup options if the snap isn't heard: the `vanish / return` button in the panel, or the shortcut `Cmd` (on Windows, `Ctrl`) `+ Shift + X`.
To quickly hide the pill button itself while recording: `Cmd`/`Ctrl` `+ Shift + H`.

## Troubleshooting

- **Not reacting to snaps** — open the panel (click the status text) and move the `snap sensitivity` slider to the right (more sensitive).
- **Triggers on its own**, for example from talking or knocking sounds — move the same slider to the left (less sensitive).
- **The disappearing looks messy / leaves a trace** — the lighting in the room has changed since you last clicked `capture empty room`. Click it again right before the call.
- **The button never shows up at all** — reload the Meet tab after installing the extension, and check that `Developer mode` is on and the extension is enabled (toggle is blue) on `chrome://extensions`.
- Keep the camera still and the lighting steady while the extension is running, otherwise the saved "empty room" stops matching reality.

## Privacy

Everything happens locally, inside your browser: no camera frame and no microphone audio is ever sent anywhere, there's no server this extension talks to. The microphone is only used to listen for the finger snap itself, the audio is never stored or recorded.
