# Shorts Hub

The phone-friendly control panel for the **ai-shorts-pipeline** repo. It's one self-contained page (`index.html`) hosted free on GitHub Pages.

- **Write a script**: calls Gemini from your browser using your key
- **Approve & make video**: starts the `render.yml` GitHub Action in the private pipeline repo
- Finished videos are read from that repo's `media` branch, with **Share**, **Download**, **Upload to YouTube**, **Posted** tracking and **Delete**

Your GitHub token and Gemini key are stored only in the browser on each device (localStorage). The page itself contains no keys or videos.

Setup: see `CLOUD_SETUP.md` in the pipeline folder.
