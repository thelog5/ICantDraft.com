# Media Assets

This folder contains media assets (videos, images, etc.) for the ICantDraft.com website.

## Folder Structure

```
media/
├── videos/           # Video files for demos and features
│   ├── main-demo.mp4            # Main hero video demo (1586x1284)
│   ├── trade-suggestions.mp4    # Trade suggestions feature demo (1586x1284)
│   ├── weekly-projections.mp4   # Weekly projections feature demo (1970x1284)
│   ├── streaming-assistant.mp4  # Streaming assistant feature demo (1970x1284)
│   └── team-analysis.mp4        # Team analysis feature demo (2006x1284)
│
└── images/           # Screenshots and images
    ├── screenshots/
    └── logos/
```

## Video Specifications

For best results, use videos with these specifications:
- **Format**: MP4 (H.264 codec)
- **Max File Size**: 15MB (recommended for web performance)
- **Duration**: 15-60 seconds per feature demo
- **Playback**: Videos will auto-play on loop without controls

### Video Resolutions (by section):
1. **main-demo.mp4**: 1586 x 1284 pixels
2. **trade-suggestions.mp4**: 1586 x 1284 pixels
3. **weekly-projections.mp4**: 1970 x 1284 pixels
4. **streaming-assistant.mp4**: 1970 x 1284 pixels
5. **team-analysis.mp4**: 2006 x 1284 pixels

## How to Add Videos

1. Place your video files in the appropriate folder
2. Name them according to the convention above (or update the component code)
3. The videos will be automatically accessible at `/media/videos/filename.mp4`

## Usage in Code

Videos are referenced in the Landing page component and will auto-play on loop:

```tsx
// Example:
<video 
  className="main-video" 
  autoPlay
  loop
  muted
  playsInline
>
  <source src="/media/videos/main-demo.mp4" type="video/mp4" />
</video>
```

**Note:** Videos auto-play without controls and loop continuously. The `muted` attribute is required for auto-play to work in browsers.

## Current Placeholders

The landing page currently has placeholders for:
1. **Main Hero Video** - Full platform walkthrough (1586x1284)
2. **Feature 1** - Trade Suggestions Demo (1586x1284)
3. **Feature 2** - Weekly Projections Demo (1970x1284)
4. **Feature 3** - Streaming Assistant Demo (1970x1284)
5. **Feature 4** - Team Analysis Demo (2006x1284)

Simply drop your video files into the `videos/` folder with the appropriate names and resolutions. The placeholders will remain visible until you uncomment the video tags in `Landing.tsx`.

## Tips

- Compress videos before uploading to improve load times
- Use a video editing tool to add captions/annotations if needed
- Test videos on different screen sizes to ensure they look good
- Consider adding a poster image (first frame) for better UX


