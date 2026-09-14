# Reference library and image-generation handoff

The library belongs to a film/project and is available across its scenes and frames. A named character can hold multiple views, with labels and continuity notes. Each panel independently selects the characters and other artwork it needs. Selecting a character includes its current views for that panel. Adding a view later updates that selection without copying artwork into each frame. Existing individually selected references remain supported.

The app remembers the reference selection. It cannot promise that an external generator will reproduce a character perfectly, and adding reference art does not change already imported panels.

Each panel can also select **Previous panels** from earlier shots or panels in the same scene. This attaches their artwork as continuity references alongside the library images. The selection pins the exact image version you chose; changing the source panel's active version later does not replace it. Your new frame direction describes what changes while the prompt asks the generator to preserve the established appearance. New panels start without these selections.

Previous-panel selections survive saving and project backups without duplicating image data. If a source image is deleted or its panel moves after the target, remove or replace that unavailable selection before generating. API requests allow ten total input images, including library views, previous panels, and the current image when revising. Downloaded generation packs include the same pinned images and attachment instructions.

## Manual generation

Download a generation pack for the selected panel. Unzip it, paste its prompt into your image generator, and attach the included image files. The attachment manifest identifies which images belong to each character or location. For a revision, the pack also includes the selected current panel image when requested. Import the generated result into the storyboard afterward.

Copying prompt text alone does not copy or upload images. A provider must support image inputs to use the artwork as a visual reference.

## Optional OpenAI API generation

The **Generate** tab sends the actual selected character/location/style image data alongside the frame prompt and returns the image directly to the originating panel's version history. Revisions additionally send the current image as the first image input. The app explicitly provides references with every request; it does not rely on permanent provider memory. Character groups remain shared across the whole project, while each panel chooses which groups to send.

With references, the local server uses OpenAI's image editing endpoint with multipart image files. Without references, it uses the image generation endpoint. The model is GPT Image 2.5 Flare, with medium quality as the starting setting and Low/High alternatives. There is no additional orchestration model. GIF and AVIF references are converted to PNG copies before sending; originals stay in the library. Requests that exceed the app's upload limits are rejected before contacting OpenAI.

Reference inputs contribute to API usage costs. The app displays verified token rates and calculates an estimate from returned usage, separating unknown charges from measured totals. A small measured scene trial with your own artwork is still needed to judge quality, consistency, and practical cost per usable panel. Generation is explicit, one frame at a time.

Source checked 10 September 2026: [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

Connecting a key does not generate an image. Only the explicit Generate action sends a paid request. API billing is separate from your ChatGPT subscription; manual generation packs remain available for use with your subscription.
