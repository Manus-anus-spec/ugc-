# Model Onboarding SOP — required assets (from the Jul 30 check-in w/ Niko)

Why this exists: Kira's content generation stalled for weeks because her character
sheet had **no neutral facial expression** (every ref was smiley — Seedream/Speed
Dance drifted her face on every pass) and **no defined wardrobe**. Rosalia's bland,
head-on face sheet is exactly why her content came out so clean. New models never
skip these requirements.

## Required before any content is generated

### 1. Face refs — 4–6 NEUTRAL shots (the non-negotiable)
- Passport-style: **neutral/bland expression, mouth closed, no smile** — smiley or
  expressive refs cause face drift in the body pass and video models.
- Coverage: front dead-on, left ¾, right ¾ (add up-tilt/down-tilt if available).
- Head-on, even flat lighting, no filters, no beauty smoothing.
- Store on the profile as the face sheet (`refs.faceSheetId` / single-ref strategy).

### 2. Defined wardrobe (the second Kira blocker)
- Every `looks.wardrobeDefaults` key gets a **concrete garment description**
  (fabric, cut, exact colors) — "TEMPLATE" placeholders block generation quality.
- Preferably a real garment closet: one photo per wardrobe key, mapped in
  `looks.wardrobeImages` (key → image path, e.g. Keira's
  `Aruna Talent - files/Keira/Assets/Outfits/_closet/<key>.jpg`).
  The app surfaces the chosen look's image in every brief so the operator attaches
  it to the WaveSpeed/Seedream call alongside the face ref — text describes the
  garment, the image locks it.

### 3. World + realism constraints
- `world.locationWhitelist` / `locationBanlist` filled from the model's actual lore
  (region-accurate details matter — e.g. Kira's Australian wall plugs).
- Persona, audience ICP, voice examples.

## Workflow
1. Onboard the model (this SOP) → create the profile via the profile manager.
2. Niko produces content with the app's prompts (Seedance 2.0 primary).
3. Feedback loops back into the profile/app — not into manual prompt rewriting.
