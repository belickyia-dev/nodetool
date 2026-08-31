---
name: cinematography-presets
description: Enhance video/image prompts with professional cinematography direction. Use when user describes a video scene, image shot, or visual content that would benefit from camera, lighting, or film stock styling.
---

You have access to a cinematography presets RAG collection (`cinematography-presets`) with 60 professional camera, lighting, and effects presets. Use these to enhance visual prompts with specific technical cinematography language.

# When to Use

Query the collection when the user:
- Describes a video or image scene (mood, emotion, setting)
- Asks for cinematic or professional-looking visuals
- Mentions any film/video style (noir, documentary, action, romantic, etc.)
- Wants specific visual aesthetics (neon, golden hour, dramatic, etc.)

# How to Use

1. **Query the collection** with the scene description:
   ```
   query_collection(collection="cinematography-presets", query="<scene mood/style>", n_results=3)
   ```

2. **Extract prompt fragments** from the results — each preset contains a `prompt_fragment` in its document/metadata that you can incorporate into the final generation prompt.

3. **Combine** the user's content idea with the cinematography fragments to create a richer prompt.

# Collection Categories

| Category | Examples |
|----------|----------|
| **Camera** | Dramatic Close-Up (ARRI Alexa + Cooke 85mm), Action Tracking (RED V-Raptor), Dutch Angle, Crane Reveal, Steadicam Follow |
| **Lighting** | Three-Point Classic, Rembrandt, Film Noir Low-Key, Golden Hour, Neon Cyberpunk, Silhouette Backlit |
| **Effects** | Kodak Vision3 500T, CineStill 800T (neon halation), Bleach Bypass, Teal & Orange, Vintage 70s, Anime Cel-Shaded |

# Example Queries

| User intent | Query |
|-------------|-------|
| Romantic sunset scene | `"golden hour warm romantic"` |
| Thriller/suspense | `"noir shadows tension thriller"` |
| Music video neon | `"neon cyberpunk urban night"` |
| Documentary style | `"documentary handheld raw authentic"` |
| Product commercial | `"macro detail product sharp"` |
| Emotional portrait | `"dramatic closeup emotional intimate"` |
| Action sequence | `"action chase dynamic movement"` |

# Prompt Assembly

After querying, combine results into the generation prompt:

```
User: "a woman walking alone at night in the city"

Query: "urban night neon moody"

Results:
- Neon Cyberpunk (lighting): "neon-lit cyberpunk atmosphere with pink and cyan colored lighting, reflections on wet surfaces"
- CineStill 800T (effects): "CineStill 800T look with characteristic red halation around highlights, neon glow, urban night aesthetic"

Enhanced prompt:
"a woman walking alone at night in the city, neon-lit cyberpunk atmosphere with pink and cyan colored lighting, reflections on wet surfaces, CineStill 800T film look with red halation around highlights, urban night aesthetic"
```

# Rules

- Query with 2-4 descriptive keywords matching the mood/style, not the full user prompt
- Combine 2-3 presets max (camera + lighting + effect) to avoid over-specification
- The `prompt_fragment` field contains the ready-to-use text
- Don't force cinematography on non-visual tasks
