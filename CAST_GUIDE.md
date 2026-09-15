# Cast Library

## Make a character story

1. Choose **Illustrated Story** or **AI Character Story**.
2. Under **Your cast**, choose **Add original horror cast** to save Elias, Mara and the Broadcast Hollow into your connected Media Library. Already installed IDs are skipped, so an interrupted import can be retried. This button uploads the included PNGs to your pipeline repository's release storage.
3. Select the characters for this video. Edit their names and appearance notes if needed. Choose a default character for first-person narration; choose no default for scenery when no character is named.
4. Import finished JSON or create a script. **Copy AI prompt** includes the selected cast automatically.
5. Under **Creative settings**, enable paid visuals and choose your budget. The pipeline requires `FAL_KEY` in its GitHub Actions secrets.
6. Review shots. The cast checkboxes let you override any shot. Uncheck all for an illustrated scenery shot. Locked uploaded artwork is preserved.
7. Render after reviewing the allowance.

No generation is charged by selecting characters, reviewing shots, or adding the bundled pack to the library. Rendering requires the existing explicit spending approval. Allowances in the interface are internal limits, not live provider price quotes. Appearance consistency is guided by references; generated images can still need review.

## Imported JSON

```json
{
  "title": "The Attic Recording",
  "hook": "THE TAPE SAID MY NAME",
  "production_mode": "illustrated",
  "cast": [{"id":"elias-vale-v1","name":"Elias Vale","aliases":["Elias"],"description":"Teal glasses, burgundy jacket, silver hair streak and cassette recorder."}],
  "cast_default_id": "elias-vale-v1",
  "scenes": [{
    "text": "Elias held the recorder against the attic door. Something inside pressed play.",
    "visual": "Elias outside a locked attic",
    "visual_beats": [{"duration":4,"cast_ids":["elias-vale-v1"],"image_prompt":"Elias holds his cassette recorder against an old attic door. Warm flashlight, deep teal shadows, inked graphic-novel illustration."},{"duration":3,"cast_ids":[],"image_prompt":"Close-up of a locked attic door handle slowly turning, graphic-novel horror illustration."}]
  }],
  "description": "An original fictional horror scene.",
  "hashtags": ["#HorrorStory"]
}
```

This is a short schema example, not a full-length production script. Imported scripts keep their own cast metadata. If cast metadata is absent, the selected creator defaults are used. Explicit per-shot `cast_ids` take priority over scene `cast_ids`, then names in the shot direction, then narration, then the default character.

## Combined scenes and manual artwork

Two characters in one generated shot require a combined reference image. Upload that image, select both characters for the shot and set its asset ID under **Shot direction → Reference asset ID**. Otherwise use separate shots. Automatic multi-reference composition is not included in this version.

Character sheets marked **Character reference only** are excluded from automatic footage selection. Upload finished scene artwork through a shot's Upload button and lock it to use artwork made elsewhere without image-generation charges.

## Verification

Frontend: `node tests/studio.test.cjs` and `node tests/cast.test.cjs`.
Pipeline: `python -m unittest discover -s tests -v`.
Provider tests are mocked and incur no charges. Deploy both repositories together.
